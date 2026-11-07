"use client";

import { useActionState } from "react";
import { logInBuyer, type BuyerLoginFormState } from "../actions/buyer-auth";

const initialState: BuyerLoginFormState = { status: "idle" };

export default function BuyerLoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(logInBuyer, initialState);

  return (
    <form action={formAction} className="formGrid" aria-label="Buyer log in">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {/* One field for either credential: an account set up for a team holds
          a user id, one that signed up itself holds a work email, and nobody
          should have to say which of the two they have. `username` is the
          autocomplete token that covers both in a password manager. */}
      <label className="formField formFieldWide">
        <span className="formLabel">
          User id or work email <span className="formReq">*</span>
        </span>
        <input
          name="login"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="formInput"
          aria-invalid={state.status === "error" || undefined}
        />
      </label>

      <label className="formField formFieldWide">
        <span className="formLabel">
          Password <span className="formReq">*</span>
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="formInput"
          aria-invalid={state.status === "error" || undefined}
        />
      </label>

      <div className="formFooter">
        <button type="submit" className="formBtn" disabled={pending} aria-disabled={pending}>
          {pending ? "Signing in…" : "Log in"}
          <span className="formArr" aria-hidden>
            →
          </span>
        </button>
        <p className={`formMsg formMsg-${state.status}`} aria-live="polite">
          {state.status === "error" && state.message}
        </p>
      </div>
    </form>
  );
}
