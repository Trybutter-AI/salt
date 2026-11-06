/**
 * What kind of place a site is, as the seller app codes it.
 *
 * A mirror of the `site_category` list in the seller app's `lib/code-lists.ts`,
 * which owns it. Copied rather than imported because the two apps are separate
 * deployments with no shared package, and a buyer reading "S14" learns nothing
 * — the portal needs the words. Regenerate from that file if it changes; an
 * unknown code falls back to itself, so a site categorised under a newer code
 * still renders.
 *
 * The narrower `venue_type` list is deliberately not mirrored: the category
 * already says what sort of place the footage was recorded in, and 170 more
 * rows of it would be a second label for the same fact.
 */
const SITE_CATEGORIES: Record<string, string> = {
  S01: "Bar, café or drinks counter",
  S02: "Building site, trades or hardware",
  S03: "Child or elder care",
  S04: "Clinic, hospital or pharmacy",
  S05: "Commercial cleaning",
  S06: "Crafts studio or maker space",
  S07: "Drug, biotech or medical-device production",
  S08: "Farm, greenhouse or animal care",
  S09: "Fire, rescue or security",
  S10: "Garment, tailoring or footwear work",
  S11: "Gym or sports venue",
  S12: "Hotel or guest lodging",
  S13: "IT and telecom equipment site",
  S14: "Lab or research bench",
  S15: "Manufacturing or production line",
  S16: "Office or admin",
  S17: "Power, water or utility site",
  S18: "Print, sign or graphics shop",
  S19: "Repair shop for goods",
  S20: "Restaurant or catering kitchen",
  S21: "Salon, barber or spa",
  S22: "School or training center",
  S23: "Shop or store",
  S24: "Vehicle workshop or transport depot",
  S25: "Venue, stage or event production",
  S26: "Warehouse, stockroom or shipping",
  S27: "Something else",
};

/** The words for a site category code, or the code itself if it is unknown. */
export function siteCategoryLabel(code: string | null): string | null {
  if (!code) return null;
  return SITE_CATEGORIES[code] ?? code;
}
