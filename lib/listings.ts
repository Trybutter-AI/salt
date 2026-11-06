import "server-only";
import { sql } from "./db";
import { normalizeCategory, signalPrimitive } from "./taxonomy";

/**
 * The data spec a listing advertises, mirroring the episode record EgoVerse
 * exposes in Mecka's explorer (partners.mecka.ai/egoverse):
 *
 *   episode_hash · operator · lab · num_frames · task · task_description ·
 *   scene · objects · embodiment · robot_name · is_eval · eval_score ·
 *   eval_success · license
 *
 * A listing is a *set* of episodes rather than one, so the per-episode
 * singulars become arrays (`task` → `tasks`, `scene` → `scenes`) and the
 * counts are aggregates. Everything is optional except the three fields the
 * card can't render without, because listings predate this shape and get
 * normalised on read rather than backfilled.
 */
export type ListingParameters = {
  /** Total recorded hours across the episodes. */
  hours: number;
  /** Episode count — EgoVerse's unit of one demonstration. */
  episodes?: number;
  /** Summed `num_frames` across the episodes. */
  frames?: number;
  /** Distinct `operator` ids behind the episodes. */
  operators?: number;

  /** Task slugs, EgoVerse style: `forming_dough_rings`, `loading_dishwasher`. */
  tasks: string[];
  /** The `task_description` sentence, when the set is a single task. */
  taskDescription?: string;
  /** Scene slugs: `bakery_kitchen`, `laundry_room`, `packing_station`. */
  scenes: string[];
  /** Objects handled across the episodes: `dough`, `baking_tray`. */
  objects: string[];
  /** Embodiments present, e.g. `human_bimanual`, `yam_bimanual`. */
  embodiments: string[];
  /** Robot the episodes were replayed on. Absent for pure human capture. */
  robotName?: string;
  /** Capturing lab or consortium partner: `mecka`, `rl2`, `eth`. */
  lab?: string;

  /** MK-SIG codes present in the recording, e.g. `["PX-01", "DP-02"]`. */
  signals: string[];

  /** Whether this is an evaluation set rather than a training set. */
  isEval?: boolean;
  /** Share of evaluation episodes marked `eval_success`, 0-1. */
  evalSuccessRate?: number;

  /** License string as EgoVerse states it, e.g. "CC BY-SA 4.0". */
  license?: string;

  /* ── Butter's own marketplace layer ──
     Mecka's operator is an anonymous id. Here the recorder is a person you
     can see, rate, and talk to, which is the reason to buy through us. */

  /** Platform handle of the recorder. Stored bare; the "@" is display-only. */
  recorderHandle?: string;
  /** Years in the trade. Not shown directly — this is what derives the tier. */
  recorderYears?: number;
  /** Mean buyer rating, 0-5. */
  recorderRating?: number;
  /** Number of ratings behind `recorderRating`. */
  recorderReviews?: number;
};

/**
 * The parameter shape as it was stored before the spec moved to EgoVerse's
 * vocabulary. Rows written under it are still in the table, so they get
 * mapped on read instead of migrated: the JSONB has no schema to alter, and a
 * one-way rewrite of live listings is worse than a translation on the way out.
 */
type LegacyParameters = {
  /** → `episodes` */
  demonstrations?: number;
  /** → `signals` (labels, not MK-SIG codes) */
  sensorModalities?: string[];
  /** → `scenes` */
  environmentTags?: string[];
  /** → folded into `signals` as LC-10 Localization */
  slam?: boolean;
  /** → `robotName` */
  robotPlatform?: string;
};

export type ListingStatus = "pending_review" | "approved" | "rejected";

export type Listing = {
  id: number;
  title: string;
  category: string;
  summary: string;
  askingPriceCents: number;
  parameters: ListingParameters;
  status: ListingStatus;
  createdAt: string;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Fills in the EgoVerse-shaped fields from whatever a row actually holds, so
 * the card renders the same whether the listing was written before or after
 * the spec changed. New keys always win where both are present.
 */
export function normalizeParameters(raw: ListingParameters & LegacyParameters): ListingParameters {
  const legacySignals = asArray(raw.sensorModalities).map(
    (m) => signalPrimitive(m)?.code ?? m
  );
  const signals = asArray(raw.signals).length ? asArray(raw.signals) : legacySignals;

  /* SLAM was a boolean of its own; under MK-SIG it's the Localization
     primitive, so a legacy `slam: true` becomes an LC-10 chip. */
  if (raw.slam && !signals.includes("LC-10")) signals.push("LC-10");

  const scenes = asArray(raw.scenes).length ? asArray(raw.scenes) : asArray(raw.environmentTags);

  return {
    ...raw,
    hours: typeof raw.hours === "number" ? raw.hours : 0,
    episodes: raw.episodes ?? raw.demonstrations,
    tasks: asArray(raw.tasks),
    scenes,
    objects: asArray(raw.objects),
    embodiments: asArray(raw.embodiments),
    robotName: raw.robotName ?? raw.robotPlatform,
    signals,
  };
}

export async function getApprovedListings(): Promise<Listing[]> {
  if (!sql) return [];

  const rows = await sql<Listing[]>`
    SELECT
      id, title, category, summary,
      asking_price_cents AS "askingPriceCents",
      parameters, status,
      created_at AS "createdAt"
    FROM listings
    WHERE status = 'approved'
    ORDER BY created_at DESC
  `;

  /* Both the category and the parameters are translated on the way out, so a
     listing written under the pre-Mecka vocabulary still browses and filters. */
  return rows.map((row) => ({
    ...row,
    category: normalizeCategory(row.category),
    parameters: normalizeParameters(row.parameters),
  }));
}
