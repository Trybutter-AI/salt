import "server-only";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Read access to the bucket the seller app uploads footage to.
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

const BUCKET = process.env.S3_BUCKET;

function createClient(): S3Client | null {
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!BUCKET || !region || !accessKeyId || !secretAccessKey) return null;

  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(endpoint),
    credentials: { accessKeyId, secretAccessKey },
  });
}

const client = createClient();

export function isStorageConfigured(): boolean {
  return client !== null;
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
  if (!client || !BUCKET) throw new Error("Storage not configured");

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: contentDisposition(options.disposition ?? "inline", options.filename),
    ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
  });
  return getSignedUrl(client, command, { expiresIn });
}
