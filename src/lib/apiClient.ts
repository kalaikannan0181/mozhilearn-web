const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenRequest) {
    csrfTokenRequest = fetch(apiUrl('/api/auth/csrf'), { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { success?: boolean; csrf_token?: string };
        if (!response.ok || !payload.success || !payload.csrf_token) {
          throw new Error('Unable to initialize secure request protection.');
        }
        csrfToken = payload.csrf_token;
        return payload.csrf_token;
      })
      .finally(() => { csrfTokenRequest = null; });
  }
  return csrfTokenRequest;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await getCsrfToken());
  }
  return fetch(apiUrl(path), { ...options, headers, credentials: 'include' });
}

export async function readApiJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.text();

  if (!body.trim()) {
    throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} (HTTP ${response.status})`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${fallbackMessage} (HTTP ${response.status})`);
  }
}