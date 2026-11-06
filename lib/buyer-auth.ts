import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "./db";
import { generateSessionToken, hashToken } from "./auth/tokens";
import { BUYER_COOKIE } from "./auth/cookies";
import type { BuyerType } from "./auth/kyb";

export { BUYER_COOKIE };

export type BuyerStatus = "pending" | "approved" | "rejected" | "suspended";

export type BuyerSession = {
  buyerId: number;
  /* Null on an account that signs in with a user id instead. A lab's account
     is held by whoever is on the data team that week, so the id is handed
     over with the role and there is no one person's address behind it. */
  email: string | null;
  username: string | null;
  name: string;
  /* Null until it is derived from the work email domain — signup no longer
     asks for either of these. */
  companyName: string | null;
  status: BuyerStatus;
};

export type BuyerRecord = BuyerSession & {
  /* Null on a company row the seller app created that has never been given a
     login. `verifyPassword` refuses a null, so such a row cannot be signed
     in to — it is a buyer Butter sells to, not yet an account. */
  passwordHash: string | null;
  buyerType: BuyerType | null;
};

const SESSION_DAYS = 30;

/**
 * Unlike the seller session — which this app only ever reads, because it is
 * minted on app.trybutter.ai — the buyer session is created, read and
 * destroyed here. This is the only origin buyers sign in on.
 */
export const verifyBuyerSession = cache(async (): Promise<BuyerSession | null> => {
  if (!sql) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(BUYER_COOKIE)?.value;
  if (!token) return null;

  const rows = await sql<(Omit<BuyerSession, "buyerId"> & { buyerId: string })[]>`
    SELECT b.id AS "buyerId", b.email, b.username, b.name,
           b.company_name AS "companyName", b.status
    FROM buyer_sessions s
    JOIN buyers b ON b.id = s.buyer_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
    LIMIT 1
  `;

  const row = rows[0];
  return row ? { ...row, buyerId: Number(row.buyerId) } : null;
});

/**
 * The account behind what was typed in the one sign-in field, which is either
 * a user id or an email. Both are matched case-insensitively and both have a
 * unique index on `lower(...)`, so this can return at most one row either way.
 *
 * One field rather than two, because asking which kind of credential someone
 * holds is a question they should not have to answer about their own login.
 */
export async function findBuyerByLogin(identifier: string): Promise<BuyerRecord | null> {
  if (!sql) return null;

  const typed = identifier.trim().toLowerCase();
  if (!typed) return null;

  /* `id` is a BIGINT, which this driver hands back as a string. The type says
     number and callers do arithmetic on it, so it is converted here rather
     than left to whichever caller notices. */
  const rows = await sql<(Omit<BuyerRecord, "buyerId"> & { buyerId: string })[]>`
    SELECT id AS "buyerId", email, username, name, company_name AS "companyName",
           status, password_hash AS "passwordHash", buyer_type AS "buyerType"
    FROM buyers
    WHERE lower(email) = ${typed} OR lower(username) = ${typed}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...row, buyerId: Number(row.buyerId) } : null;
}

/** Mints a session row and sets the cookie. Caller must have authenticated. */
export async function startBuyerSession(buyerId: number): Promise<void> {
  if (!sql) throw new Error("startBuyerSession called without a database");

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO buyer_sessions (buyer_id, token_hash, expires_at)
    VALUES (${buyerId}, ${hashToken(token)}, ${expiresAt})
  `;
  await sql`UPDATE buyers SET last_login_at = now() WHERE id = ${buyerId}`;

  const cookieStore = await cookies();
  cookieStore.set(BUYER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Deletes the session row as well as the cookie, so the token dies server-side. */
export async function endBuyerSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(BUYER_COOKIE)?.value;

  if (token && sql) {
    await sql`DELETE FROM buyer_sessions WHERE token_hash = ${hashToken(token)}`;
  }
  cookieStore.delete(BUYER_COOKIE);
}
