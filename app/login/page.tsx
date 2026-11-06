import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BuyerLoginForm from "../components/BuyerLoginForm";
import { verifyBuyerSession } from "../../lib/buyer-auth";
import { loginUrl } from "../../lib/urls";

export const metadata: Metadata = {
  title: "Buyer log in",
  description:
    "Log in to your Butter buyer account. Buyer accounts are issued once an access request is approved.",
  alternates: { canonical: "/login" },
  robots: { index: false },
};

/**
 * Buyer sign-in: a user id or a work email, plus a password. No Google —
 * buyers arrive through a reviewed access request rather than self-serve
 * social sign-up, so there is nothing for an OAuth provider to shortcut.
 */
export default async function MarketplaceLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/portal";

  if (await verifyBuyerSession()) redirect(safeNext);

  return (
    <main className="formSection">
      <div className="formEyebrow">Embodied Data Marketplace</div>
      <h1 className="formH1">Buyer log in.</h1>
      <p className="formIntro">
        Sign in for the footage collected against your assignments, and for
        pricing and licensing terms across every listing.
      </p>

      <BuyerLoginForm next={safeNext} />

      <p className="formSwitch">
        Don&apos;t have an account yet?{" "}
        <Link href="/signup">Request buyer access</Link>
      </p>
      <p className="formSwitch">
        Selling data instead? <a href={loginUrl("/login")}>Provider log in</a>
      </p>
      <p className="formSwitch">
        <Link href="/">← Back to the marketplace</Link>
      </p>
    </main>
  );
}
