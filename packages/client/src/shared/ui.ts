import { writable } from 'svelte/store';
import { ApiError } from './api';
import { t } from './copy';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export const toasts = writable<Toast[]>([]);
let seq = 0;

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const id = ++seq;
  toasts.update((t) => [...t, { id, text, kind }]);
  setTimeout(() => toasts.update((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
}

/** Runs an action; shows the server's message on failure. Returns the result or undefined. */
export async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(errorText(e), 'error');
    return undefined;
  }
}

/** A sentence for any failure: the server's message, else copy errors.<code>, else a generic line. Never a raw code. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const msg = e.message?.trim();
    if (msg && msg !== e.code && e.code !== 'bad_request' && !/^[a-z_]+$/.test(msg)) return msg;
    const known = t(`errors.${e.code}`);
    if (known !== `errors.${e.code}`) return known;
    if (e.status === 0) return t('errors.network');
    return t('errors.generic');
  }
  if (e instanceof TypeError) return t('errors.network');
  return t('errors.generic');
}
