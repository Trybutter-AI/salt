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
import { localPath } from "../../lib/urls";
import { clientAddress, loginAllowed, loginFailed, loginSucceeded } from "../../lib/auth/login-limit.mjs";
import { headers } from "next/headers";

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

/** Signup takes no more than this, so nothing longer can be a real password. */
const MAX_PASSWORD_LENGTH = 200;

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
  /* Only a path on this origin, so a `?next=` somebody else put in a link
     cannot turn the sign-in form into a redirect to their own site. */
  const next = localPath(formData.get("next")?.toString(), "/portal");

  if (!login || !password) {
    return { status: "error", message: "Enter your user id or email, and your password." };
  }
  if (!sql) {
    return { status: "error", message: "Sign-in is unavailable right now." };
  }

  /* Before any hashing: a long run of guesses, or one enormous "password",
     would otherwise cost a scrypt each. */
  const from = clientAddress(await headers());
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { status: "error", message: "That login and password don't match an account." };
  }
  const wait = loginAllowed(login, from);
  if (wait !== null) {
    const minutes = Math.max(1, Math.ceil(wait / 60));
    return {
      status: "error",
      message: `Too many tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
    };
  }

  const buyer = await findBuyerByLogin(login);

  /* Same message — and the same amount of work — for "no such account",
     "wrong password", and a company row the seller app created that has
     never been given a login, so the form can't be used to find out which
     of the three it was. */
  const ok = await verifyPassword(password, buyer?.passwordHash ?? (await decoyHash()));
  if (!buyer || !ok) {
    loginFailed(login, from);
    return { status: "error", message: "That login and password don't match an account." };
  }
  loginSucceeded(login);

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
