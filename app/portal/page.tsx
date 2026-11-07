import type { Metadata } from "next";
import Link from "next/link";
import { requireBuyer } from "../../lib/buyer-portal";
import { listBuyerAssignments } from "../../lib/footage";
import { day, duration, fileSize } from "../../lib/format";

export const metadata: Metadata = {
  title: "Assignments",
  robots: { index: false },
};

/* Footage arrives while the page is open, so nothing here is cached. */
export const dynamic = "force-dynamic";

/**
 * Every assignment collecting for this buyer, and what has landed against
 * each. The list is the page: a site, a task, and how much footage there is
 * so far, with the recordings themselves one click in.
 */
export default async function BuyerPortalPage() {
  const buyer = await requireBuyer("/portal");
  const assignments = await listBuyerAssignments(buyer.buyerId);

  const episodes = assignments.reduce((sum, a) => sum + a.episodes, 0);
  const seconds = assignments.reduce((sum, a) => sum + a.durationSeconds, 0);
  const open = assignments.filter((a) => a.status === "open").length;

  return (
    <main className="wbSection">
      <div className="wbHeader">
        <div>
          <div className="wbEyebrow">{buyer.name}</div>
          <h1 className="wbH1">Assignments</h1>
        </div>
        <Link href="/" className="wbGhostBtn">
          Browse listings
        </Link>
      </div>

      {assignments.length === 0 ? (
        <p className="wbEmpty">
          Nothing is being collected for you yet. Your Butter contact sets up an
          assignment, and the footage shows here as it is recorded.
        </p>
      ) : (
        <>
          <div className="progressStats">
            <div className="statTile">
              <div className="statTileValue">{assignments.length}</div>
              <div className="statTileLabel">Assignments</div>
            </div>
            <div className="statTile">
              <div className="statTileValue">{open}</div>
              <div className="statTileLabel">Open</div>
            </div>
            <div className="statTile">
              <div className="statTileValue">{episodes}</div>
              <div className="statTileLabel">Recordings</div>
            </div>
            <div className="statTile">
              <div className="statTileValue">{duration(seconds) ?? "—"}</div>
              <div className="statTileLabel">Footage</div>
            </div>
          </div>

          <div className="wbPanel portalAssignments">
            <table className="wbTable">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Site</th>
                  <th scope="col">Recordings</th>
                  <th scope="col">Footage</th>
                  <th scope="col">Size</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/portal/assignments/${a.id}`} className="portalRowLink">
                        {a.task}
                      </Link>
                      <div className="portalRowMeta">Set up {day(a.createdAt)}</div>
                    </td>
                    <td>
                      {a.site ? (
                        <>
                          <span className="wbMono">{a.site.siteCode}</span>
                          <div className="portalRowMeta">
                            {a.site.category ?? (a.site.description || "—")}
                          </div>
                        </>
                      ) : (
                        <span className="portalRowMeta">{a.location ?? "—"}</span>
                      )}
                    </td>
                    <td className="wbNum">{a.episodes}</td>
                    <td className="wbNum">{duration(a.durationSeconds) ?? "—"}</td>
                    <td className="wbNum">{a.sizeBytes > 0 ? fileSize(a.sizeBytes) : "—"}</td>
                    <td>
                      <span className={`portalStatus portalStatus-${a.status}`}>{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
