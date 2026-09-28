const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const CONNECTION_ERROR_MESSAGE = 'Unable to connect to the server. Please check the server connection.';
let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

export function describeNetworkFailure(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed') ||
    normalized.includes('api server') ||
    normalized.includes('backend api') ||
    normalized.includes('vite_api_url') ||
    normalized.includes('not configured')
  ) {
    return CONNECTION_ERROR_MESSAGE;
  }

  return rawMessage || CONNECTION_ERROR_MESSAGE;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function isLocalBackend(): boolean {
  if (typeof window === 'undefined') return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function apiUrl(path: string): string {
  if (!API_BASE_URL && !import.meta.env.DEV) {
    throw new Error(CONNECTION_ERROR_MESSAGE);
  }

  if (!import.meta.env.DEV && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(API_BASE_URL)) {
    throw new Error(CONNECTION_ERROR_MESSAGE);
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenRequest) {
    csrfTokenRequest = (async () => {
      try {
        const requestUrl = apiUrl('/api/auth/csrf');
        let response: Response;
        try {
          response = await fetch(requestUrl, { credentials: 'include' });
        } catch (error) {
          if (import.meta.env.DEV) {
            console.debug('[apiFetch]', {
              method: 'GET',
              path: '/api/auth/csrf',
              apiBaseUrl: API_BASE_URL,
              requestUrl,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw new Error(describeNetworkFailure(error));
        }
        const text = await response.text();

        let payload: { success?: boolean; csrf_token?: string; message?: string } | null = null;
        try {
          payload = JSON.parse(text);
        } catch {
          // Response is not JSON (e.g. HTML 404 page returned by Vercel when backend is not configured)
        }

        if (!response.ok || !payload?.success || !payload?.csrf_token) {
          const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
          if (!API_BASE_URL && isVercel) {
            throw new Error(
              'Backend API URL is not configured. In your Vercel project settings, set the VITE_API_URL environment variable to your deployed backend service.'
            );
          }
          if (payload?.message) {
            throw new Error(payload.message);
          }
          throw new Error(`Unable to connect to API server (${response.status} ${response.statusText}). Please check that your backend is running.`);
        }

        csrfToken = payload.csrf_token;
        return payload.csrf_token;
      } finally {
        csrfTokenRequest = null;
      }
    })();
  }
  return csrfTokenRequest;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await getCsrfToken());
  }

  try {
    return await fetch(apiUrl(path), { ...options, headers, credentials: 'include' });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[apiFetch]', {
        method,
        path,
        apiBaseUrl: API_BASE_URL,
        requestUrl: apiUrl(path),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new Error(describeNetworkFailure(error));
  }
}

export async function readApiJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.text();

  if (!body.trim()) {
    throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} (HTTP ${response.status})`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
    if (!API_BASE_URL && isVercel) {
      throw new Error(CONNECTION_ERROR_MESSAGE);
    }

    if (!API_BASE_URL) {
      throw new Error(CONNECTION_ERROR_MESSAGE);
    }

    if (response.ok) {
      throw new Error(fallbackMessage);
    }

    throw new Error(`${fallbackMessage} (HTTP ${response.status})`);
  }
}
