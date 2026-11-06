/**
 * Numbers and dates as the portal shows them. No locale argument anywhere:
 * the server and the browser have to agree or React replaces the markup it
 * streamed, so everything here is fixed to en-GB and UTC.
 */

/** `1.4 GB`, `842 MB`, `3.1 kB`. Decimal units, as a bucket reports them. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const step = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / 1000 ** step;
  return `${value.toFixed(step === 0 ? 0 : value < 10 ? 1 : 0)} ${units[step]}`;
}

/** `1h 12m`, `12m 30s`, `48s`. Hours once there are any, seconds until minutes. */
export function duration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${whole % 60}s`;
  return `${whole}s`;
}

/** `4 Oct 2026`. */
export function day(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `4 Oct 2026, 14:05`, for a recording where the time of day matters. */
export function moment(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${day(iso)}, ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })}`;
}
