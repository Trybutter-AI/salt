import { NextResponse, type NextRequest } from "next/server";
import { verifyBuyerSession } from "../../../../lib/buyer-auth";
import { getBuyerFootageObject } from "../../../../lib/footage";
import { createPresignedDownloadUrl, isStorageConfigured } from "../../../../lib/storage";

/**
 * One footage file, for the buyer it was collected for.
 *
 * A redirect to a signed bucket URL rather than a proxy: a recording runs to
 * gigabytes, and streaming it through the app would hold a connection open
 * for the length of the video and break seeking. The browser follows this per
 * request, so a `<video>` seeking in a two-hour file comes back here and gets
 * a fresh signature each time rather than reusing one that has run out.
 *
 * The URL is signed for fifteen minutes and never reaches the HTML, so a
 * page shared or cached leaks nothing: what is in the markup is this path,
 * and this path checks the session on every hit.
 *
 * `getBuyerFootageObject` holds the authorization — the file has to hang off
 * an assignment collecting for this buyer, and it has to have passed the
 * malware sweep. A file that is neither is reported as missing, so the ids
 * of other buyers' recordings cannot be probed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const buyer = await verifyBuyerSession();
  if (!buyer || buyer.status !== "approved") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }

  const { fileId } = await params;
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "No such file." }, { status: 404, headers: NO_STORE });
  }

  const file = await getBuyerFootageObject(buyer.buyerId, id);
  if (!file) {
    return NextResponse.json({ error: "No such file." }, { status: 404, headers: NO_STORE });
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Footage can't be opened right now." },
      { status: 503, headers: NO_STORE }
    );
  }

  /* Asked to be saved, or a file the browser should not try to render. Only
     video and sound play in the page; everything else — a motion log, a
     manifest — leaves as an attachment, so a file the browser might have
     opinions about is saved rather than shown. */
  const download = req.nextUrl.searchParams.get("download") === "1";
  const contentType = file.contentType ?? "application/octet-stream";
  const playable = /^(video|audio)\//.test(contentType);
  const inline = playable && !download;

  const url = await createPresignedDownloadUrl(file.objectKey, 900, {
    disposition: inline ? "inline" : "attachment",
    filename: inline ? undefined : file.filename,
    contentType,
  });

  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}
