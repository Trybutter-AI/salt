/**
 * How many times a login may be guessed.
 *
 * Counted in memory, in this one process. The marketplace runs as a single
 * instance and owns no table to count in, and a count that starts again on a
 * deploy still turns "as many guesses as the network allows" into a handful
 * every quarter of an hour. If it is ever run as several instances, each
 * keeps its own count and this wants a table instead.
 *
 * Two counts, as the seller app keeps them: wrong passwords for one login,
 * whoever sends them, and every wrong password from one address.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_LOGIN = 10;
const MAX_PER_ADDRESS = 30;
/** Past this many keys the oldest are dropped, so the map cannot be grown without end. */
const MAX_KEYS = 50_000;

/** @type {Map<string, { failures: number, startedAt: number }>} */
const counts = new Map();

/** @param {string} key @param {number} now */
function live(key, now) {
  const count = counts.get(key);
  if (!count) return null;
  if (now - count.startedAt >= WINDOW_MS) {
    counts.delete(key);
    return null;
  }
  return count;
}

/** @param {string} key @param {number} now */
function bump(key, now) {
  const count = live(key, now);
  if (count) {
    count.failures += 1;
    return;
  }
  if (counts.size >= MAX_KEYS) {
    for (const oldest of counts.keys()) {
      counts.delete(oldest);
      if (counts.size < MAX_KEYS) break;
    }
  }
  counts.set(key, { failures: 1, startedAt: now });
}

/** @param {string} login */
const loginKey = (login) => `login:${login.trim().toLowerCase()}`;
/** @param {string} address */
const addressKey = (address) => `address:${address}`;

/**
 * Null when another try is allowed, or the seconds to wait.
 * @param {string} login @param {string} address @returns {number | null}
 */
export function loginAllowed(login, address, now = Date.now()) {
  for (const [key, max] of /** @type {[string, number][]} */ ([
    [loginKey(login), MAX_PER_LOGIN],
    [addressKey(address), MAX_PER_ADDRESS],
  ])) {
    const count = live(key, now);
    if (count && count.failures >= max) return Math.ceil((count.startedAt + WINDOW_MS - now) / 1000);
  }
  return null;
}

/** @param {string} login @param {string} address */
export function loginFailed(login, address, now = Date.now()) {
  bump(loginKey(login), now);
  bump(addressKey(address), now);
}

/**
 * The owner got it right, so their earlier slips are forgotten.
 * @param {string} login
 */
export function loginSucceeded(login) {
  counts.delete(loginKey(login));
}

/**
 * The address the request came from. Railway's edge appends the real one to
 * `x-forwarded-for`, so the last entry is the one a client cannot write.
 * @param {{ get(name: string): string | null }} headers
 * @returns {string}
 */
export function clientAddress(headers) {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  return last || headers.get("x-real-ip")?.trim() || "unknown";
}

/** For tests. */
export function resetLoginLimits() {
  counts.clear();
}
