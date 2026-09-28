import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, readApiJson } from "../../lib/apiClient";

interface AppUser {
  id: number;
  email: string;
  user_metadata: {
    full_name?: string;
  };
  role: "teacher" | "reviewer" | "admin";
}

interface AuthSession {
  user: AppUser;
}

interface SignUpDetails {
  name: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AppUser | null;
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (details: SignUpDetails) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function requestAuth(path: string, options?: RequestInit) {
  const response = await apiFetch(path, options);
  const payload = await readApiJson<{ success: boolean; user?: AppUser; message?: string }>(response, "Authentication request failed.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Authentication request failed.");
  }

  return payload;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    requestAuth("/api/auth/me")
      .then((payload) => {
        if (payload.user) {
          setSession({ user: payload.user });
        }
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const payload = await requestAuth("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (payload.user) setSession({ user: payload.user });
  }, []);

  const signUp = useCallback(async ({ name, email, password }: SignUpDetails) => {
    const payload = await requestAuth("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (payload.user) setSession({ user: payload.user });

    return { needsConfirmation: false };
  }, []);

  const signOut = useCallback(async () => {
    await requestAuth("/api/auth/logout", { method: "POST" });
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [loading, session, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
