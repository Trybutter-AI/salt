const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.trybutter.ai").replace(/\/$/, "");

/**
 * The seller login/signup and the workbench both live on app.trybutter.ai
 * (login isn't a separate subdomain) — this app is always a different
 * origin from that one either way.
 */
export function loginUrl(path = "/login"): string {
  return `${APP_URL}${path}`;
}

export function appUrl(path = "/"): string {
  return `${APP_URL}${path}`;
}

/**
 * A path on this site and nothing else, for a "where to go next" that arrived
 * in a query string or a form field. Anything that could take the browser to
 * another host answers `fallback`: a full URL, `//host`, and `/\host`, which
 * browsers read as `//host`. Whitespace and control characters go the same
 * way, since a tab or newline inside the slashes is dropped by the browser
 * before it decides.
 */
export function localPath(asked: string | null | undefined, fallback: string): string {
  if (!asked || !asked.startsWith("/") || asked.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f\s]/.test(asked)) return fallback;
  return asked;
}
