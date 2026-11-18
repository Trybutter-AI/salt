/**
 * How many times a login may be guessed: ten wrong passwords for one login,
 * thirty from one address, each over a quarter of an hour.
 *
 * Runs `lib/auth/login-limit.mjs` itself, which the sign-in action imports.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clientAddress,
  loginAllowed,
  loginFailed,
  loginSucceeded,
  resetLoginLimits,
} from "../lib/auth/login-limit.mjs";

const MINUTE = 60_000;

beforeEach(() => resetLoginLimits());

test("a login is locked after ten wrong passwords, from any address, however it is typed", () => {
  const start = 1_000_000;
  for (let i = 0; i < 10; i++) {
    assert.equal(loginAllowed("Lab_Admin", `10.0.0.${i}`, start), null);
    loginFailed("lab_admin ", `10.0.0.${i}`, start);
  }
  const wait = loginAllowed("LAB_ADMIN", "10.0.9.9", start + MINUTE);
  assert.equal(wait, 14 * 60);
  /* Another login is not held up by it. */
  assert.equal(loginAllowed("someone_else", "10.0.9.9", start + MINUTE), null);
});

test("the lock runs out with its quarter hour", () => {
  for (let i = 0; i < 10; i++) loginFailed("lab_admin", "10.0.0.1", 0);
  assert.notEqual(loginAllowed("lab_admin", "10.0.0.2", 14 * MINUTE), null);
  assert.equal(loginAllowed("lab_admin", "10.0.0.2", 15 * MINUTE), null);
});

test("an address is stopped after thirty wrong passwords across logins", () => {
  for (let i = 0; i < 30; i++) loginFailed(`login-${i}`, "203.0.113.7", 0);
  assert.notEqual(loginAllowed("fresh-login", "203.0.113.7", 1), null);
  assert.equal(loginAllowed("fresh-login", "203.0.113.8", 1), null);
});

test("getting it right forgets the login's earlier slips", () => {
  for (let i = 0; i < 9; i++) loginFailed("lab_admin", `10.1.0.${i}`, 0);
  loginSucceeded("lab_admin");
  for (let i = 0; i < 9; i++) loginFailed("lab_admin", `10.2.0.${i}`, 1);
  assert.equal(loginAllowed("lab_admin", "10.3.0.1", 2), null);
});

test("the address is the one the nearest proxy wrote, not one the client sent", () => {
  const headers = (h) => ({ get: (name) => h[name] ?? null });
  assert.equal(clientAddress(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientAddress(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientAddress(headers({})), "unknown");
});
