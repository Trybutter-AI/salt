import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "./db";
import { hashToken } from "./auth/tokens";
import { PROVIDER_COOKIE } from "./auth/cookies";

export { PROVIDER_COOKIE };

export type ProviderSession = {
  providerId: number;
  email: string;
};

/**
 * Read-only session check. This app never creates or destroys a seller
 * session — that only happens on app.trybutter.ai — it just needs to
 * know whether the visitor is currently a signed-in seller, to point the
 * nav's "Sell on Butter" link at the workbench instead of signup.
 */
export const verifyProviderSession = cache(async (): Promise<ProviderSession | null> => {
  if (!sql) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(PROVIDER_COOKIE)?.value;
  if (!token) return null;

  const rows = await sql<{ providerId: number; email: string }[]>`
    SELECT p.id AS "providerId", p.email
    FROM provider_sessions s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
    LIMIT 1
  `;

  return rows[0] ?? null;
});
