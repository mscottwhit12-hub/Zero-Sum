/**
 * Brute-force brake for the GM password and the device-unlock PIN (a 4-digit PIN is only 10,000 guesses).
 * After `free` wrong tries for the same key, each further wrong try locks that key for a doubling wait
 * (30 s, 60 s, 2 min … up to 15 min). A right answer clears it. In memory: a restart clears it too (fine on a LAN).
 */
import { HttpError, type Ctx } from '../context';

interface Entry {
  fails: number;
  until: number;
}
const FREE = 5;
const BASE_MS = 30_000;
const MAX_MS = 15 * 60_000;
const books = new WeakMap<Ctx, Map<string, Entry>>();
const book = (ctx: Ctx) => {
  let m = books.get(ctx);
  if (!m) books.set(ctx, (m = new Map()));
  return m;
};

/** Throws 429 while `key` is locked. Call before checking the secret. */
export function checkAttempts(ctx: Ctx, key: string): void {
  const e = book(ctx).get(key);
  const now = ctx.now();
  if (e && e.until > now) {
    const s = Math.ceil((e.until - now) / 1000);
    throw new HttpError(429, 'too_many_attempts', `Too many wrong tries. Wait ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`} and try again.`);
  }
}

/** Record the outcome of a check. */
export function noteAttempt(ctx: Ctx, key: string, ok: boolean): void {
  const m = book(ctx);
  if (ok) {
    m.delete(key);
    return;
  }
  const e = m.get(key) ?? { fails: 0, until: 0 };
  e.fails++;
  if (e.fails >= FREE) e.until = ctx.now() + Math.min(MAX_MS, BASE_MS * 2 ** (e.fails - FREE));
  m.set(key, e);
  if (m.size > 5000) m.delete(m.keys().next().value!); // bounded
}
