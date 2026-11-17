import "server-only";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bucketFor, regionOfKey } from "./storage-target.mjs";

type StorageRegion = "americas" | "emea";

/**
 * Read access to the buckets the seller app uploads footage to.
 *
 * The seller app owns writing: collectors upload browser-to-storage with a
 * presigned PUT and the recording is registered there. This app only ever
 * reads, so this is the download half of that app's `lib/storage.ts` and
 * nothing else — no PUT, no delete.
 *
 * Unconfigured is a state rather than an error, the same as `DATABASE_URL`
 * in `lib/db.ts`: locally there is no bucket, and a portal that still lists
 * what was collected is more use than one that fails to render.
 */

/* Footage lives in one of two buckets, and the key says which: see
   `storage-target.mjs`. Each client is made the first time its bucket is asked for. */
const clients = new Map<StorageRegion, S3Client>();

function clientFor(key: string): { client: S3Client; bucket: string } | null {
  const config = bucketFor(key, process.env);
  if (!config) return null;
  const region = regionOfKey(key);
  let client = clients.get(region);
  if (!client) {
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    clients.set(region, client);
  }
  return { client, bucket: config.bucket };
}

/**
 * Whether footage can be opened at all. With a key, whether that file's own
 * bucket is set up: a recording kept in the EU bucket can't be opened while
 * only the original bucket is configured.
 */
export function isStorageConfigured(key?: string): boolean {
  return bucketFor(key ?? "", process.env) !== null;
}

/**
 * What the bucket should call the file it hands back. The stored object is
 * named for a key nobody typed, so a download that says nothing else arrives
 * as a uuid.
 */
function contentDisposition(disposition: "inline" | "attachment", filename?: string): string {
  if (!filename) return disposition;
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * A short-lived GET URL for one object.
 *
 * The browser reads this URL from the bucket's own origin, so what the bucket
 * says the bytes are is what the browser acts on. Signing the response headers
 * alongside the key is what stops a file that got through the malware sweep
 * from being rendered as a page. Video and sound stay `inline`, because a
 * video element will not play an attachment.
 */
export async function createPresignedDownloadUrl(
  key: string,
  expiresIn = 900,
  options: { disposition?: "inline" | "attachment"; filename?: string; contentType?: string } = {}
): Promise<string> {
  const target = clientFor(key);
  if (!target) throw new Error(regionOfKey(key) === "emea" ? "EU storage not configured" : "Storage not configured");
  const { client, bucket } = target;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition(options.disposition ?? "inline", options.filename),
    ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
  });
  return getSignedUrl(client, command, { expiresIn });
}
