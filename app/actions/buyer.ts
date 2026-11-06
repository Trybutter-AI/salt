"use server";

import { sql } from "../../lib/db";
import { emailDomain, isWorkEmail } from "../../lib/auth/kyb";
import { hashPassword } from "../../lib/auth/passwords";
import { passwordProblem } from "../../lib/auth/password-rules";
import { captureServerEvent } from "../../lib/posthog-server";

type FieldKey = "name" | "email" | "password" | "confirmPassword";

export type BuyerInterestFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<FieldKey, string>>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Postgres unique-violation, i.e. someone signed up with this email first. */
const UNIQUE_VIOLATION = "23505";

export async function submitBuyerInterest(
  _prev: BuyerInterestFormState,
  formData: FormData
): Promise<BuyerInterestFormState> {
  const name = (formData.get("name")?.toString() ?? "").trim();
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const useCase = (formData.get("useCase")?.toString() ?? "").trim();
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";

  const fieldErrors: BuyerInterestFormState["fieldErrors"] = {};
  if (!name) fieldErrors.name = "Please add your name.";
  if (!email || !EMAIL_RE.test(email)) {
    fieldErrors.email = "Enter a valid email.";
  } else if (!isWorkEmail(email)) {
    fieldErrors.email = "Use your work email — personal/free email domains aren't accepted.";
  }

  const pwProblem = passwordProblem(password);
  if (pwProblem) fieldErrors.password = pwProblem;
  else if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "Passwords don't match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "Some required fields need attention.", fieldErrors };
  }

  if (!sql) {
    return { status: "error", message: "Submission is unavailable right now." };
  }

  const passwordHash = await hashPassword(password);

  /* The interest record and the account it creates are written together — an
     account with no request behind it has nothing for review to act on, and a
     request with no account can't be turned into a login.

     Company and buyer type go in unset: the work email domain identifies the
     company well enough that asking twice is friction, so they get filled in
     from it rather than typed. Until that detection exists they stay null,
     which is honest about not knowing rather than storing a guess. */
  try {
    await sql.begin(async (tx) => {
      const [interest] = await tx<{ id: number }[]>`
        INSERT INTO buyer_interest (name, email, use_case)
        VALUES (${name}, ${email}, ${useCase || null})
        RETURNING id
      `;
      await tx`
        INSERT INTO buyers (email, password_hash, name, interest_id)
        VALUES (${email}, ${passwordHash}, ${name}, ${interest.id})
      `;
    });
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      return {
        status: "error",
        message: "An account already exists for that email — log in instead.",
        fieldErrors: { email: "This email is already registered." },
      };
    }
    throw err;
  }

  await captureServerEvent(`buyer:${email}`, "buyer_interest_submitted", {
    email_domain: emailDomain(email),
    $set: { email, name },
  });

  return {
    status: "success",
    message:
      "Request received. We'll review and follow up within two business days — you can log in with this password once you're approved.",
  };
}
