import "server-only";
import { redirect } from "next/navigation";
import { verifyBuyerSession, type BuyerSession } from "./buyer-auth";

/**
 * The session every portal route starts from, or a trip to the sign-in form.
 *
 * `next` carries the page that was asked for, so a bookmarked assignment
 * still opens after signing in rather than landing on the index.
 *
 * A session whose account is no longer approved is sent back too. The status
 * is checked at sign-in, but a session lasts thirty days and an account can
 * be suspended inside one, and it would otherwise keep working until it ran
 * out.
 */
export async function requireBuyer(path: string): Promise<BuyerSession> {
  const buyer = await verifyBuyerSession();
  if (!buyer || buyer.status !== "approved") {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return buyer;
}
