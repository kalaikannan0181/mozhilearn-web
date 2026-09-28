import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../features/auth/AuthProvider";
import { getApiBaseUrl } from "../lib/apiClient";

type Mode = "login" | "signup";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { user, loading, signIn, signUp, signInDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const destination =
    (location.state as { from?: string } | null)?.from ?? "/dashboard";

  const isVercelHosted = typeof window !== "undefined" && window.location.hostname.includes("vercel.app");
  const isApiConfigured = Boolean(getApiBaseUrl());

  useEffect(() => {
    setError("");
    setNotice("");
  }, [mode]);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);

    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
        navigate(destination, { replace: true });
      } else {
        const result = await signUp({ name, email: email.trim(), password });
        if (result.needsConfirmation) {
          setNotice("Account created. Check your email to confirm your account, then sign in.");
          setMode("login");
          setPassword("");
        } else {
          navigate("/dashboard", { replace: true });
        }
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Something went wrong. Please try again.";
      setError(
        message === "Invalid login credentials"
          ? "The email or password is incorrect. Please check and try again."
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleDemoLogin() {
    signInDemo("teacher");
    navigate(destination, { replace: true });
  }

  const isConnectionError =
    error.includes("Backend API") ||
    error.includes("Unable to connect") ||
    error.includes("VITE_API_URL") ||
    error.includes("404") ||
    error.includes("Failed to fetch");

  return (
    <main className="min-h-screen bg-[#f7f8f5] lg:grid lg:grid-cols-[minmax(380px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-forest-900 px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-50">
          <div className="absolute -top-28 -right-20 size-80 rounded-full border border-white/10" />
          <div className="absolute -top-12 -right-2 size-52 rounded-full border border-white/10" />
          <div className="absolute right-16 bottom-16 grid grid-cols-6 gap-3 opacity-20">
            {Array.from({ length: 24 }).map((_, index) => (
              <span key={index} className="size-1 rounded-full bg-saffron-400" />
            ))}
          </div>
        </div>

        <div className="relative">
          <BrandMark inverse />
        </div>

        <div className="relative my-auto max-w-lg py-16">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-medium text-white/80">
            <span className="size-1.5 rounded-full bg-saffron-400" />
            SIH26042 · MozhiTech
          </div>
          <h1 className="max-w-md text-[44px] leading-[1.08] font-semibold tracking-[-0.04em]">
            Every lesson, in a language that feels like home.
          </h1>
          <p className="mt-6 max-w-md text-[16px] leading-7 text-white/65">
            Create, review and manage bilingual classroom lessons for foundational learning in Hindi and Mundari.
          </p>

          <div className="mt-12 grid max-w-md grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <p className="text-2xl font-semibold text-saffron-400">2</p>
              <p className="mt-1 text-xs text-white/55">Classroom languages</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <p className="text-2xl font-semibold text-saffron-400">Offline</p>
              <p className="mt-1 text-xs text-white/55">Classroom-ready design</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/35">Built for government school teachers</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-16">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>

          <div className="mb-8">
            <p className="mb-3 text-xs font-bold tracking-[0.15em] text-forest-700 uppercase">
              Teacher Portal
            </p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-slate-900">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === "login"
                ? "Sign in to continue managing your classroom lessons."
                : "Join MozhiLearn and start preparing bilingual lessons."}
            </p>
          </div>

          {isVercelHosted && !isApiConfigured && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs leading-5 text-amber-900 shadow-sm">
              <div className="flex items-center gap-2 font-semibold text-amber-950">
                <span className="size-2 rounded-full bg-amber-500" />
                Vercel Hosting Preview
              </div>
              <p className="mt-1 text-amber-800">
                To link your live PostgreSQL backend, set <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">VITE_API_URL</code> in Vercel settings. You can click <strong>Explore in Demo Mode</strong> below to test the full UI right now.
              </p>
            </div>
          )}

          <div className="mb-7 grid grid-cols-2 rounded-xl bg-slate-200/65 p-1">
            {(["login", "signup"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  mode === item
                    ? "bg-white text-forest-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {item === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-5 text-red-800">
              <div className="flex gap-3">
                <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
                <div className="space-y-2">
                  <p>{error}</p>
                  {isConnectionError && (
                    <button
                      type="button"
                      onClick={handleDemoLogin}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-900 transition hover:bg-red-200"
                    >
                      <Sparkles size={13} />
                      Enter in Demo Mode to explore
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {notice && (
            <div className="mb-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm leading-5 text-emerald-800">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "signup" && (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Full name</span>
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Enter your name"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Email address</span>
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teacher@school.edu"
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Password</span>
              <div className="relative">
                <input
                  required
                  minLength={8}
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-12 pl-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-forest-700 px-5 text-sm font-semibold text-white shadow-sm shadow-forest-900/10 hover:bg-forest-800 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {submitting ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {mode === "login" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                <>
                  {mode === "login" ? "Sign in to dashboard" : "Create teacher account"}
                  <ArrowRight aria-hidden="true" size={17} />
                </>
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#f7f8f5] px-3 font-medium text-slate-400">or explore without account</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDemoLogin}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-forest-300 bg-white px-4 text-sm font-semibold text-forest-800 shadow-xs transition hover:bg-forest-50/70"
          >
            <Sparkles size={16} className="text-forest-600" />
            Explore Teacher Portal (Demo Mode)
          </button>

          <div className="mt-8 flex items-start gap-2.5 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-500">
            <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-forest-600" size={16} />
            <p>Your account gives you private access to lessons created by you.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

