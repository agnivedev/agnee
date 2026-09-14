/**
 * Thin wrapper over fetch for the Agnee API.
 *
 * Session lives in an http-only cookie, so there is no token to attach here —
 * the only job is JSON encoding, error shaping, and turning a 401 into
 * something the app can react to instead of a silent empty screen.
 */

export class ApiError extends Error {
  status: number;

  /** The parsed error payload. Some routes refuse with a reason the UI must translate. */
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

/** Fires whenever a request comes back 401 so the shell can drop to the login view. */
const unauthorizedListeners = new Set<() => void>();

export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, { ...options, headers, body });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/v1/auth/')) {
      for (const listener of unauthorizedListeners) listener();
    }
    throw new ApiError(data?.error || `Permintaan gagal (${response.status})`, response.status, data);
  }

  return data;
}

export function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
