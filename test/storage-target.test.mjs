/**
 * Which bucket a footage file is read from. Butter keeps footage recorded in
 * Europe, Africa and the Middle East in an EU bucket, keyed `emea/…`; every
 * other key is in the original bucket. A file kept in the EU bucket must never
 * be looked for in the original one.
 *
 * Runs `lib/storage-target.mjs` itself, which `lib/storage.ts` imports.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketFor, regionOfKey } from "../lib/storage-target.mjs";

const original = {
  S3_BUCKET: "us-bucket",
  S3_REGION: "sjc",
  S3_ACCESS_KEY_ID: "us-key",
  S3_SECRET_ACCESS_KEY: "us-secret",
  S3_ENDPOINT: "https://us.storage.test",
};
const eu = {
  S3_EU_BUCKET: "eu-bucket",
  S3_EU_REGION: "ams",
  S3_EU_ACCESS_KEY_ID: "eu-key",
  S3_EU_SECRET_ACCESS_KEY: "eu-secret",
  S3_EU_ENDPOINT: "https://eu.storage.test",
};

test("an emea/ key is read from the EU bucket, with its own credentials", () => {
  const config = bucketFor("emea/providers/7/video.mp4", { ...original, ...eu });
  assert.deepEqual(config, {
    bucket: "eu-bucket",
    region: "ams",
    accessKeyId: "eu-key",
    secretAccessKey: "eu-secret",
    endpoint: "https://eu.storage.test",
  });
});

test("any other key is read from the original bucket", () => {
  assert.equal(bucketFor("providers/7/video.mp4", { ...original, ...eu })?.bucket, "us-bucket");
  assert.equal(bucketFor("cameras/2026-11-17/x/000_video.mp4", { ...original, ...eu })?.bucket, "us-bucket");
});

test("with the EU bucket unset, an emea/ key has no bucket rather than the wrong one", () => {
  assert.equal(bucketFor("emea/providers/7/video.mp4", original), null);
  assert.equal(bucketFor("providers/7/video.mp4", original)?.bucket, "us-bucket");
});

test("nothing configured is nothing to read from", () => {
  assert.equal(bucketFor("providers/7/video.mp4", {}), null);
});

test("only a leading emea/ counts", () => {
  assert.equal(regionOfKey("emea/providers/7/a.mp4"), "emea");
  assert.equal(regionOfKey("providers/7/emea/a.mp4"), "americas");
  assert.equal(regionOfKey("emeaish/a.mp4"), "americas");
});
