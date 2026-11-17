/**
 * Which bucket a footage key is read from.
 *
 * Butter keeps footage recorded in Europe, Africa and the Middle East in an EU
 * bucket (Amsterdam), and the key says so: one that starts with `emea/` lives
 * there, stored under that same full key, and every other key lives in the
 * original bucket. The seller app's `lib/storage-region.ts` sets the rule and
 * every service reading Butter's storage follows it.
 *
 * Plain JavaScript with nothing server-only, so `test/storage-target.test.mjs`
 * runs this file itself rather than a copy of it.
 */

export const EMEA_PREFIX = "emea/";

/**
 * @typedef {{ bucket: string, region: string, accessKeyId: string, secretAccessKey: string, endpoint: string | undefined }} BucketConfig
 * @typedef {"americas" | "emea"} StorageRegion
 */

/** @param {string} key @returns {StorageRegion} */
export function regionOfKey(key) {
  return key.startsWith(EMEA_PREFIX) ? "emea" : "americas";
}

/**
 * One bucket's settings from the environment, or null when any is missing.
 * @param {Record<string, string | undefined>} env
 * @param {"S3" | "S3_EU"} prefix
 * @returns {BucketConfig | null}
 */
export function bucketConfig(env, prefix) {
  const bucket = env[`${prefix}_BUCKET`];
  const region = env[`${prefix}_REGION`];
  const accessKeyId = env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${prefix}_SECRET_ACCESS_KEY`];
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return { bucket, region, accessKeyId, secretAccessKey, endpoint: env[`${prefix}_ENDPOINT`] || undefined };
}

/**
 * The settings for the bucket `key` lives in, or null when that bucket is not
 * configured. An `emea/` key with the EU bucket unset is null, never the
 * original bucket.
 * @param {string} key
 * @param {Record<string, string | undefined>} env
 * @returns {BucketConfig | null}
 */
export function bucketFor(key, env) {
  return bucketConfig(env, regionOfKey(key) === "emea" ? "S3_EU" : "S3");
}
