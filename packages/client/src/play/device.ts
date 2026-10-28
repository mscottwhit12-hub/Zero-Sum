import { ApiError } from '@shared/api';

const KEY = 'gn_device';
const PENDING = 'gn_pending';

/** Identity lives in the browser (no password). localStorage can be unavailable: fail soft. */
const safe = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export const deviceToken = () => safe.get(KEY);
export const setDeviceToken = (t: string | null) => safe.set(KEY, t);
export const pendingToken = () => safe.get(PENDING);
export const setPendingToken = (t: string | null) => safe.set(PENDING, t);
export const store = safe;

/** A permanent random id for this phone. Kept after signing out, so rejoining on the same phone needs no approval. */
export function phoneId(): string {
  let id = safe.get('gn_phone');
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    safe.set('gn_phone', id);
  }
  return id;
}

/** API call authenticated as this device. */
export async function dapi<T = unknown>(method: string, url: string, body?: unknown, token = deviceToken()): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { 'x-device-token': token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? data.error ?? res.statusText);
  return data as T;
}

/** Resize an image to ≤512 px and encode under 200 KB (the server enforces both). */
export async function prepareAvatar(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    for (const type of ['image/webp', 'image/jpeg']) {
      const url = c.toDataURL(type, q);
      if (url.startsWith(`data:${type}`) && (url.length - url.indexOf(',') - 1) * 0.75 < 195 * 1024) return url;
    }
  }
  throw new Error('Image is too large even after resizing.');
}
