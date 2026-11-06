import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBuyer } from "../../../../lib/buyer-portal";
import { getBuyerAssignment, type FootageFile } from "../../../../lib/footage";
import { day, duration, fileSize, moment } from "../../../../lib/format";

export const metadata: Metadata = {
  title: "Assignment",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** What the sweep has said, for a file whose bytes are not being offered. */
const SCAN_NOTE: Record<string, string> = {
  pending: "Being checked",
  infected: "Failed the malware check",
  skipped: "Not checked",
  failed: "Check did not finish",
};

const CONSENT_NOTE: Record<string, string> = {
  complete: "Consent complete",
  awaiting_signatures: "Awaiting signatures",
  draft: "Consent in draft",
  blocked: "Consent blocked",
};

function Player({ file }: { file: FootageFile }) {
  const src = `/portal/footage/${file.id}`;
  const isAudio = (file.contentType ?? "").startsWith("audio/");

  return isAudio ? (
    <audio className="portalAudio" controls preload="metadata" src={src} />
  ) : (
    <video className="portalVideo" controls preload="metadata" src={src} />
  );
}

export default async function BuyerAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const assignmentId = Number(id);
  const buyer = await requireBuyer(`/portal/assignments/${id}`);

  if (!Number.isInteger(assignmentId)) notFound();
  const assignment = await getBuyerAssignment(buyer.buyerId, assignmentId);
  if (!assignment) notFound();

  const { site } = assignment;
  const asked = [assignment.video ? "Video" : null, assignment.sound ? "Sound" : null]
    .filter(Boolean)
    .join(" and ");

  return (
    <main className="wbSection">
      <div className="wbHeader">
        <div>
          <div className="wbEyebrow">{buyer.name}</div>
          <h1 className="wbH1">{assignment.task}</h1>
        </div>
        <Link href="/portal" className="wbGhostBtn">
          Back
        </Link>
      </div>

      {assignment.spec ? <p className="wbLede">{assignment.spec}</p> : null}

      <div className="portalSplit">
        <section className="wbPanel">
          <h2 className="wbPanelH2">Site</h2>
          {site ? (
            <dl className="wbDetailList">
              <div className="wbDetailRow">
                <dt>Site id</dt>
                <dd className="wbMono">{site.siteCode}</dd>
              </div>
              {site.description ? (
                <div className="wbDetailRow">
                  <dt>Description</dt>
                  <dd>{site.description}</dd>
                </div>
              ) : null}
              {site.category ? (
                <div className="wbDetailRow">
                  <dt>Category</dt>
                  <dd>{site.category}</dd>
                </div>
              ) : null}
              {site.businessLegalName ? (
                <div className="wbDetailRow">
                  <dt>Business</dt>
                  <dd>{site.businessLegalName}</dd>
                </div>
              ) : null}
              {site.address ? (
                <div className="wbDetailRow">
                  <dt>Address</dt>
                  <dd>{site.address}</dd>
                </div>
              ) : null}
              {site.city || site.stateOrProvince || site.country ? (
                <div className="wbDetailRow">
                  <dt>Place</dt>
                  <dd>
                    {[site.city, site.stateOrProvince, site.country].filter(Boolean).join(", ")}
                  </dd>
                </div>
              ) : null}
              {site.headcount !== null ? (
                <div className="wbDetailRow">
                  <dt>Headcount</dt>
                  <dd>{site.headcount}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="wbEmpty">
              {assignment.location ?? "No site recorded against this assignment."}
            </p>
          )}
        </section>

        <section className="wbPanel">
          <h2 className="wbPanelH2">Assignment</h2>
          <dl className="wbDetailList">
            <div className="wbDetailRow">
              <dt>Status</dt>
              <dd className="wbDetailEnum">{assignment.status}</dd>
            </div>
            <div className="wbDetailRow">
              <dt>Asked for</dt>
              <dd>{asked || "—"}</dd>
            </div>
            {assignment.durationMinutes > 0 ? (
              <div className="wbDetailRow">
                <dt>Per recording</dt>
                <dd>{assignment.durationMinutes} min</dd>
              </div>
            ) : null}
            <div className="wbDetailRow">
              <dt>Set up</dt>
              <dd>{day(assignment.createdAt)}</dd>
            </div>
            {assignment.dueAt ? (
              <div className="wbDetailRow">
                <dt>Due</dt>
                <dd>{day(assignment.dueAt)}</dd>
              </div>
            ) : null}
            <div className="wbDetailRow">
              <dt>Delivered</dt>
              <dd>
                {assignment.episodes} recordings
                {assignment.durationSeconds > 0
                  ? `, ${duration(assignment.durationSeconds)}`
                  : ""}
                {assignment.sizeBytes > 0 ? `, ${fileSize(assignment.sizeBytes)}` : ""}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <h2 className="wbPanelH2 portalFootageH2">Footage</h2>

      {assignment.episodeList.length === 0 ? (
        <p className="wbEmpty">Nothing has been recorded against this assignment yet.</p>
      ) : (
        assignment.episodeList.map((episode) => (
          <section className="wbPanel" key={`${episode.id}-${episode.captureId}`}>
            <div className="portalEpisodeTop">
              <h3 className="wbPanelH2 portalEpisodeId">
                <span className="wbMono">{episode.captureId}</span>
              </h3>
              <div className="portalEpisodeMeta">
                {moment(episode.recordedAt) ?? "No recording time"}
                {episode.consentStatus ? (
                  <>
                    {" · "}
                    <span className={`portalConsent portalConsent-${episode.consentStatus}`}>
                      {CONSENT_NOTE[episode.consentStatus]}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            {episode.files.some((f) => f.playable) ? (
              <div className="portalPlayers">
                {episode.files
                  .filter((f) => f.playable)
                  .map((file) => (
                    <figure className="portalPlayerFig" key={file.id}>
                      <Player file={file} />
                      <figcaption className="portalRowMeta">
                        {file.filename}
                        {duration(file.durationSeconds) ? ` · ${duration(file.durationSeconds)}` : ""}
                      </figcaption>
                    </figure>
                  ))}
              </div>
            ) : null}

            <table className="wbTable portalFiles">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Signals</th>
                  <th scope="col">Length</th>
                  <th scope="col">Size</th>
                  <th scope="col">
                    <span className="wbSrOnly">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {episode.files.map((file) => (
                  <tr key={file.id}>
                    <td>{file.filename}</td>
                    <td className="portalRowMeta">
                      {file.modalities.length ? file.modalities.join(", ") : "—"}
                    </td>
                    <td className="wbNum">{duration(file.durationSeconds) ?? "—"}</td>
                    <td className="wbNum">{fileSize(file.sizeBytes)}</td>
                    <td className="wbNum">
                      {file.scanStatus === "clean" ? (
                        <a className="portalRowLink" href={`/portal/footage/${file.id}?download=1`}>
                          Download
                        </a>
                      ) : (
                        <span className="portalRowMeta">
                          {SCAN_NOTE[file.scanStatus] ?? file.scanStatus}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}
