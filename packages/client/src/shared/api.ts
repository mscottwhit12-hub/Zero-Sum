export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON fetch against the same origin. Throws ApiError with the server's error code. */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? data.error ?? res.statusText);
  return data as T;
}

export const get = <T = unknown>(url: string) => api<T>('GET', url);
export const post = <T = unknown>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T = unknown>(url: string, body: unknown = {}) => api<T>('PATCH', url, body);
export const del = <T = unknown>(url: string) => api<T>('DELETE', url);
