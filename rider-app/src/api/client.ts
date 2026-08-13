import { clearSessionToken, getSessionToken } from './session';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    if (typeof body.message === 'string' && body.message) return body.message;
    const detail = body.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (typeof first.msg === 'string') return first.msg;
    }
  }
  return `Request failed (${status})`;
}

export type ApiFetchInit = RequestInit & {
  /** Skip Authorization header (login bootstrap). */
  skipAuth?: boolean;
};

export async function apiFetch<T>(url: string, init: ApiFetchInit = {}): Promise<T> {
  const { skipAuth, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders || {});

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Rider-Client', 'expo');

  if (!skipAuth) {
    const token = await getSessionToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(url, {
    ...rest,
    headers,
  });

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // Session gone — clear local token so boot redirects to login.
      if (!skipAuth) {
        await clearSessionToken();
      }
    }
    throw new ApiError(parseErrorMessage(payload, res.status), res.status, payload);
  }

  return payload as T;
}
