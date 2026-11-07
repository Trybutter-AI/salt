"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "../../lib/db";
import { hashPassword, verifyPassword } from "../../lib/auth/passwords";
import {
  endBuyerSession,
  findBuyerByLogin,
  startBuyerSession,
  type BuyerStatus,
} from "../../lib/buyer-auth";
import { emailDomain } from "../../lib/auth/kyb";
import { captureServerEvent } from "../../lib/posthog-server";

/**
 * A hash of a random string, verified against when what was typed matches no
 * account. Without it, an unknown login answers in a fraction of the time a
 * known one takes — which would hand back the account-existence answer the
 * shared error message is there to withhold.
 */
let unknownLoginHash: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  unknownLoginHash ??= hashPassword(randomBytes(32).toString("hex"));
  return unknownLoginHash;
}

/**
 * Where to go after signing in. Only a path on this origin is honoured, so a
 * `?next=` somebody else put in a link cannot turn the sign-in form into a
 * redirect to their own site. A protocol-relative `//host` is a URL to the
 * browser, which is why the second character is checked too.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/portal";
  if (/[\u0000-\u001f\s]/.test(raw)) return "/portal";
  return raw;
}

export type BuyerLoginFormState = {
  status: "idle" | "error";
  message?: string;
};

/** Why a real, correctly-authenticated account still can't sign in. */
const STATUS_BLOCKED: Record<Exclude<BuyerStatus, "approved">, string> = {
  pending:
    "Your access request is still under review — we'll email your sign-in details once it's approved.",
  rejected:
    "This account isn't approved for marketplace access. Reply to our email if you think that's wrong.",
  suspended: "This account is suspended. Get in touch and we'll sort it out.",
};

export async function logInBuyer(
  _prev: BuyerLoginFormState,
  formData: FormData
): Promise<BuyerLoginFormState> {
  const login = (formData.get("login")?.toString() ?? "").trim();
  const password = formData.get("password")?.toString() ?? "";
  const next = safeNext(formData.get("next")?.toString() ?? null);

  if (!login || !password) {
    return { status: "error", message: "Enter your user id or email, and your password." };
  }
  if (!sql) {
    return { status: "error", message: "Sign-in is unavailable right now." };
  }

  const buyer = await findBuyerByLogin(login);

  /* Same message — and the same amount of work — for "no such account",
     "wrong password", and a company row the seller app created that has
     never been given a login, so the form can't be used to find out which
     of the three it was. */
  const ok = await verifyPassword(password, buyer?.passwordHash ?? (await decoyHash()));
  if (!buyer || !ok) {
    return { status: "error", message: "That login and password don't match an account." };
  }

  if (buyer.status !== "approved") {
    return { status: "error", message: STATUS_BLOCKED[buyer.status] };
  }

  await startBuyerSession(buyer.buyerId);
  await captureServerEvent(`buyer:${buyer.email ?? buyer.username}`, "buyer_logged_in", {
    email_domain: buyer.email ? emailDomain(buyer.email) : null,
  });

  revalidatePath("/", "layout");
  redirect(next);
}

export async function logOutBuyer(): Promise<void> {
  await endBuyerSession();
  revalidatePath("/", "layout");
  redirect("/");
}
