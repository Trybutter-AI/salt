import "server-only";
import { sql } from "./db";
import { siteCategoryLabel } from "./site-categories";

/**
 * What a buyer collected, read back for them.
 *
 * The chain is one link long at each step, and `assignments.buyer_id` is the
 * only thing that makes any of it theirs:
 *
 *   buyers → assignments → data_episodes → data_files
 *
 * An assignment names a task, the site it is done at, and the buyer it
 * collects for. An episode is one recording session answering it. A file is
 * one of the several a session produces — the video, its motion and pose
 * logs, the manifest.
 *
 * Every one of these tables belongs to the seller app, which creates and
 * migrates them; `test/fixtures/external-tables.sql` writes down the subset
 * read here. Nothing in this file writes.
 *
 * Two rules hold everywhere below, and both are enforced in SQL rather than
 * in the pages, so a page that forgets cannot leak:
 *
 *   - `a.buyer_id = ${buyerId}` is in every WHERE. A null `buyer_id` means
 *     the workspace recorded it on its own account to list later, so it
 *     belongs to no buyer and must never appear here.
 *   - a recording answers an assignment through its episode, and older files
 *     carry the assignment themselves, so the join takes
 *     `COALESCE(e.assignment_id, f.assignment_id)` and matches either.
 */

/** The malware sweep's verdict. Only 'clean' bytes are ever handed out. */
export type ScanStatus = "pending" | "clean" | "infected" | "skipped" | "failed";

/** Where the recording's consent record stands, per the seller app. */
export type ConsentStatus = "draft" | "awaiting_signatures" | "complete" | "blocked";

export type FootageFile = {
  id: number;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  durationSeconds: number | null;
  modalities: string[];
  scanStatus: ScanStatus;
  /** True when the file is video or sound, so the page offers a player. */
  playable: boolean;
};

export type FootageEpisode = {
  id: number;
  captureId: string;
  recordedAt: string | null;
  consentStatus: ConsentStatus | null;
  files: FootageFile[];
};

export type AssignmentSite = {
  siteCode: string;
  description: string;
  category: string | null;
  address: string | null;
  city: string | null;
  stateOrProvince: string | null;
  country: string | null;
  businessLegalName: string | null;
  headcount: number | null;
};

export type AssignmentSummary = {
  id: number;
  task: string;
  spec: string;
  status: "open" | "closed";
  durationMinutes: number;
  video: boolean;
  sound: boolean;
  location: string | null;
  dueAt: string | null;
  createdAt: string;
  site: AssignmentSite | null;
  /** Recording sessions delivered against this assignment. */
  episodes: number;
  /** Files across those sessions, whatever the sweep has said about them. */
  files: number;
  /** Summed duration of the files that carry one, in seconds. */
  durationSeconds: number;
  sizeBytes: number;
};

export type AssignmentDetail = AssignmentSummary & {
  episodeList: FootageEpisode[];
};

const PLAYABLE = /^(video|audio)\//;

function playableType(contentType: string | null): boolean {
  return PLAYABLE.test(contentType ?? "");
}

type SiteRow = {
  siteCode: string | null;
  siteDescription: string | null;
  siteCategory: string | null;
  address: string | null;
  city: string | null;
  stateOrProvince: string | null;
  country: string | null;
  businessLegalName: string | null;
  headcount: number | null;
};

type AssignmentRow = SiteRow & {
  id: string;
  task: string;
  spec: string;
  status: "open" | "closed";
  durationMinutes: number;
  video: boolean;
  sound: boolean;
  location: string | null;
  dueAt: Date | null;
  createdAt: Date;
  episodes: number;
  files: number;
  durationSeconds: number;
  sizeBytes: string;
};

function siteOf(row: SiteRow): AssignmentSite | null {
  if (!row.siteCode) return null;
  return {
    siteCode: row.siteCode,
    description: row.siteDescription ?? "",
    category: siteCategoryLabel(row.siteCategory),
    address: row.address,
    city: row.city,
    stateOrProvince: row.stateOrProvince,
    country: row.country,
    businessLegalName: row.businessLegalName,
    headcount: row.headcount,
  };
}

function summaryOf(row: AssignmentRow): AssignmentSummary {
  return {
    id: Number(row.id),
    task: row.task,
    spec: row.spec,
    status: row.status,
    durationMinutes: row.durationMinutes,
    video: row.video,
    sound: row.sound,
    location: row.location,
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    site: siteOf(row),
    episodes: Number(row.episodes),
    files: Number(row.files),
    durationSeconds: Number(row.durationSeconds),
    sizeBytes: Number(row.sizeBytes),
  };
}

/**
 * Every assignment collecting for this buyer, newest first, each with what
 * has landed against it.
 *
 * The counts are a lateral subquery rather than a join with GROUP BY: an
 * assignment with no footage yet still has to appear, and aggregating over a
 * left join would have to be taught the difference between no files and one
 * null row.
 */
export async function listBuyerAssignments(buyerId: number): Promise<AssignmentSummary[]> {
  if (!sql || !Number.isInteger(buyerId)) return [];

  const rows = await sql<AssignmentRow[]>`
    SELECT
      a.id, a.task, a.spec, a.status,
      a.duration_minutes AS "durationMinutes",
      a.video, a.sound, a.location,
      a.due_at AS "dueAt", a.created_at AS "createdAt",
      s.site_code AS "siteCode", s.description AS "siteDescription",
      s.site_category AS "siteCategory", s.address, s.city,
      s.state_or_province AS "stateOrProvince", s.country,
      s.business_legal_name AS "businessLegalName", s.headcount,
      totals.episodes, totals.files, totals."durationSeconds", totals."sizeBytes"
    FROM assignments a
    LEFT JOIN sites s ON s.id = a.site_id
    CROSS JOIN LATERAL (
      SELECT
        count(DISTINCT f.episode_id)::int AS episodes,
        count(f.id)::int AS files,
        COALESCE(sum(f.duration_seconds), 0)::int AS "durationSeconds",
        COALESCE(sum(f.size_bytes), 0) AS "sizeBytes"
      FROM data_files f
      LEFT JOIN data_episodes e ON e.id = f.episode_id
      WHERE COALESCE(e.assignment_id, f.assignment_id) = a.id
    ) totals
    WHERE a.buyer_id = ${buyerId}
    ORDER BY a.created_at DESC, a.id DESC
  `;

  return rows.map(summaryOf);
}

type EpisodeRow = {
  id: string;
  captureId: string;
  recordedAt: Date | null;
  consentStatus: ConsentStatus | null;
};

type FileRow = {
  id: string;
  episodeId: string | null;
  filename: string;
  contentType: string | null;
  sizeBytes: string;
  durationSeconds: number | null;
  modalities: string[] | null;
  scanStatus: ScanStatus;
};

/**
 * One assignment and its recordings, or null when it is not this buyer's.
 *
 * Null for "someone else's" as well as "no such assignment", so an id that
 * belongs to another buyer cannot be told apart from one that does not exist.
 */
export async function getBuyerAssignment(
  buyerId: number,
  assignmentId: number
): Promise<AssignmentDetail | null> {
  if (!sql || !Number.isInteger(buyerId) || !Number.isInteger(assignmentId)) return null;

  const rows = await sql<AssignmentRow[]>`
    SELECT
      a.id, a.task, a.spec, a.status,
      a.duration_minutes AS "durationMinutes",
      a.video, a.sound, a.location,
      a.due_at AS "dueAt", a.created_at AS "createdAt",
      s.site_code AS "siteCode", s.description AS "siteDescription",
      s.site_category AS "siteCategory", s.address, s.city,
      s.state_or_province AS "stateOrProvince", s.country,
      s.business_legal_name AS "businessLegalName", s.headcount,
      totals.episodes, totals.files, totals."durationSeconds", totals."sizeBytes"
    FROM assignments a
    LEFT JOIN sites s ON s.id = a.site_id
    CROSS JOIN LATERAL (
      SELECT
        count(DISTINCT f.episode_id)::int AS episodes,
        count(f.id)::int AS files,
        COALESCE(sum(f.duration_seconds), 0)::int AS "durationSeconds",
        COALESCE(sum(f.size_bytes), 0) AS "sizeBytes"
      FROM data_files f
      LEFT JOIN data_episodes e ON e.id = f.episode_id
      WHERE COALESCE(e.assignment_id, f.assignment_id) = a.id
    ) totals
    WHERE a.id = ${assignmentId} AND a.buyer_id = ${buyerId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  /* Consent is recorded per file but asked for per recording, so the episode
     takes the weakest state across its files: a session is only cleared when
     every file in it is. */
  const [episodes, files] = await Promise.all([
    sql<EpisodeRow[]>`
      SELECT e.id, e.capture_id AS "captureId", e.recorded_at AS "recordedAt",
             CASE
               WHEN count(c.id) = 0 THEN NULL
               WHEN bool_or(c.status = 'blocked') THEN 'blocked'
               WHEN bool_or(c.status = 'draft') THEN 'draft'
               WHEN bool_or(c.status = 'awaiting_signatures') THEN 'awaiting_signatures'
               ELSE 'complete'
             END AS "consentStatus"
      FROM data_episodes e
      LEFT JOIN asset_consents c ON c.episode_id = e.id
      WHERE e.assignment_id = ${assignmentId}
      GROUP BY e.id, e.capture_id, e.recorded_at
      ORDER BY e.recorded_at DESC NULLS LAST, e.id DESC
    `,
    sql<FileRow[]>`
      SELECT f.id, f.episode_id AS "episodeId", f.filename,
             f.content_type AS "contentType", f.size_bytes AS "sizeBytes",
             f.duration_seconds AS "durationSeconds", f.modalities,
             f.scan_status AS "scanStatus"
      FROM data_files f
      LEFT JOIN data_episodes e ON e.id = f.episode_id
      WHERE COALESCE(e.assignment_id, f.assignment_id) = ${assignmentId}
      ORDER BY f.id
    `,
  ]);

  const filesByEpisode = new Map<string, FootageFile[]>();
  /* A file with no episode still has to be shown, so it is gathered under a
     key no episode row can have and listed last. */
  const LOOSE = "loose";
  for (const file of files) {
    const key = file.episodeId === null ? LOOSE : String(file.episodeId);
    const list = filesByEpisode.get(key) ?? [];
    list.push({
      id: Number(file.id),
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: Number(file.sizeBytes),
      durationSeconds: file.durationSeconds,
      modalities: file.modalities ?? [],
      scanStatus: file.scanStatus,
      playable: file.scanStatus === "clean" && playableType(file.contentType),
    });
    filesByEpisode.set(key, list);
  }

  const episodeList: FootageEpisode[] = episodes.map((episode) => ({
    id: Number(episode.id),
    captureId: episode.captureId,
    recordedAt: episode.recordedAt?.toISOString() ?? null,
    consentStatus: episode.consentStatus,
    files: filesByEpisode.get(String(episode.id)) ?? [],
  }));

  const loose = filesByEpisode.get(LOOSE);
  if (loose?.length) {
    episodeList.push({
      id: 0,
      captureId: "Uploaded by hand",
      recordedAt: null,
      consentStatus: null,
      files: loose,
    });
  }

  return { ...summaryOf(row), episodeList };
}

/**
 * The object key for a file, if it is one this buyer may read.
 *
 * The single gate in front of the bucket, so it carries the whole rule: the
 * file has to hang off an assignment collecting for this buyer, and the
 * malware sweep has to have passed it. Everything else — pending, infected,
 * never swept, failed — has no key to hand back.
 */
export async function getBuyerFootageObject(
  buyerId: number,
  fileId: number
): Promise<{ objectKey: string; filename: string; contentType: string | null } | null> {
  if (!sql || !Number.isInteger(buyerId) || !Number.isInteger(fileId)) return null;

  const rows = await sql<{ objectKey: string; filename: string; contentType: string | null }[]>`
    SELECT f.object_key AS "objectKey", f.filename, f.content_type AS "contentType"
    FROM data_files f
    LEFT JOIN data_episodes e ON e.id = f.episode_id
    JOIN assignments a ON a.id = COALESCE(e.assignment_id, f.assignment_id)
    WHERE f.id = ${fileId}
      AND a.buyer_id = ${buyerId}
      AND f.scan_status = 'clean'
    LIMIT 1
  `;
  return rows[0] ?? null;
}
