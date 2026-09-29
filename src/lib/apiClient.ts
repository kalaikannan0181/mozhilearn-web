const DEFAULT_PROD_API_URL =
  'https://mozli-learn.onrender.com';
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
    ? DEFAULT_PROD_API_URL
    : '')
).replace(/\/+$/, '');

const CONNECTION_ERROR_MESSAGE = 'Unable to connect to the server.';
let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  serverError?: string;

  constructor(status: number, message: string, code?: string, serverError?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.serverError = serverError;
  }
}

export function describeNetworkFailure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network failure')
  ) {
    return CONNECTION_ERROR_MESSAGE;
  }

  return rawMessage || CONNECTION_ERROR_MESSAGE;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL || (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app') ? DEFAULT_PROD_API_URL : '');
}

export function isLocalBackend(): boolean {
  if (typeof window === 'undefined') return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function apiUrl(path: string): string {
  let base = API_BASE_URL;
  if (!base) {
    if (import.meta.env.DEV) {
      base = 'http://localhost:5000';
    } else {
      base = DEFAULT_PROD_API_URL;
    }
  }

  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
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
          throw new Error(describeNetworkFailure(error));
        }

        const text = await response.text();
        let payload: { success?: boolean; csrf_token?: string; message?: string; error?: string; code?: string } | null = null;
        try {
          payload = JSON.parse(text);
        } catch {
        }

        if (!response.ok || !payload?.success || !payload?.csrf_token) {
          const status = response.status;
          const code = payload?.code || (status === 403 ? 'INVALID_CSRF_TOKEN' : undefined);
          const message = payload?.error || payload?.message || `Failed to obtain CSRF token (HTTP ${status})`;
          throw new ApiError(status, message, code);
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

export function clearCsrfToken(): void {
  csrfToken = null;
  csrfTokenRequest = null;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await getCsrfToken());
  }

  try {
    const response = await fetch(apiUrl(path), { ...options, headers, credentials: 'include' });
    if (response.status === 403) {
      clearCsrfToken();
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(describeNetworkFailure(error));
  }
}

export async function readApiJson<T extends { success?: boolean; code?: string; error?: string; message?: string }>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const rawBody = await response.text();

  let payload: (T & { success?: boolean; error?: string; message?: string; code?: string }) | null = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Response is not JSON
    }
  }

  if (!response.ok || (payload && payload.success === false)) {
    const status = response.status;
    const code = payload?.code;
    const rawError = payload?.error || payload?.message;

    let safeMessage: string;
    if (status === 409 || code === 'EMAIL_ALREADY_EXISTS') {
      safeMessage = 'An account with this email already exists.';
    } else if (status === 401 || code === 'INVALID_CREDENTIALS') {
      safeMessage = 'Invalid email or password.';
    } else if (status === 403 && (code === 'INVALID_CSRF_TOKEN' || rawError?.toLowerCase().includes('csrf'))) {
      safeMessage = 'Security validation failed. Please refresh and try again.';
    } else if (status === 403 && (code === 'CORS_ERROR' || rawError?.toLowerCase().includes('cors'))) {
      safeMessage = rawError || 'Cross-origin request blocked by CORS policy.';
    } else if (status === 503 || code === 'DATABASE_UNAVAILABLE') {
      safeMessage = 'Backend service is temporarily unavailable.';
    } else if (status === 500) {
      safeMessage = rawError && !/failed to (create account|sign in)/i.test(rawError)
        ? rawError
        : 'Server error. Please try again.';
    } else {
      safeMessage = rawError || (response.ok ? fallbackMessage : `${fallbackMessage} (HTTP ${status})`);
    }

    throw new ApiError(status, safeMessage, code, rawError);
  }

  if (!payload) {
    throw new ApiError(response.status, fallbackMessage);
  }

  return payload as T;
}
