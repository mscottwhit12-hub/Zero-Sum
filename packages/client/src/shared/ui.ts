import { writable } from 'svelte/store';
import { ApiError } from './api';

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
    toast(e instanceof ApiError ? e.message || e.code : String(e), 'error');
    return undefined;
  }
}
