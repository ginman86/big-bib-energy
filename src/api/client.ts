// Same-origin API client. The session is an HttpOnly cookie the browser sends on its own.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** SHA-256 hex of the body. CloudFront OAC signs /api requests to Lambda but doesn't hash bodies. */
async function sha256Hex(body: BodyInit | undefined): Promise<string> {
  const bytes =
    body === undefined
      ? new Uint8Array()
      : typeof body === 'string'
        ? new TextEncoder().encode(body)
        : new Uint8Array(await new Response(body).arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function api<T = unknown>(method: string, path: string, json?: unknown): Promise<T> {
  const body = json === undefined ? undefined : JSON.stringify(json);
  const headers: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-BBE'] = '1'; // CSRF guard; see api/internal/app
    headers['x-amz-content-sha256'] = await sha256Hex(body);
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => undefined);
    throw new ApiError(res.status, msg ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
