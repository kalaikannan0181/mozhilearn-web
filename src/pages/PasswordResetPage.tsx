import { ArrowLeft, CheckCircle2, KeyRound, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { apiFetch, readApiJson } from "../lib/apiClient";

interface ResetResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
}

export function PasswordResetPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (token && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch(
        token ? "/api/auth/password-reset/complete" : "/api/auth/password-reset/request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(token ? { token, password } : { email: email.trim() }),
        },
      );
      const payload = await readApiJson<ResetResponse>(response, "Password reset request failed.");
      setNotice(payload.message || "Password reset request completed.");
      if (token) {
        setPassword("");
        setConfirmation("");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Password reset request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#f7f8f5] lg:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)]">
      <section className="hidden min-h-screen flex-col justify-between bg-forest-900 p-10 text-white lg:flex">
        <BrandMark inverse />
        <div className="max-w-md pb-10">
          <KeyRound aria-hidden="true" className="mb-6 text-saffron-400" size={30} />
          <h1 className="text-4xl leading-tight font-semibold">Account access, restored securely.</h1>
          <p className="mt-4 text-sm leading-6 text-white/65">Reset links are single-use and expire after 20 minutes.</p>
        </div>
        <span />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden"><BrandMark /></div>
          <Link to="/login" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-forest-800">
            <ArrowLeft aria-hidden="true" size={16} /> Back to sign in
          </Link>
          <p className="mb-3 text-xs font-bold text-forest-700 uppercase">Account recovery</p>
          <h2 className="text-3xl font-semibold text-slate-900">{token ? "Choose a new password" : "Reset your password"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {token ? "Set a new password for your MozhiLearn account." : "Enter your account email and we will send a one-time reset link if it matches an account."}
          </p>

          {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
          {notice && <div role="status" className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 aria-hidden="true" className="shrink-0" size={18} />{notice}</div>}

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            {!token ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Email address</span>
                <span className="relative block">
                  <Mail aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" size={17} />
                  <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-4 pl-10 text-sm text-slate-900 shadow-sm focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none" />
                </span>
              </label>
            ) : (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">New password</span>
                  <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Confirm new password</span>
                  <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm focus:border-forest-600 focus:ring-3 focus:ring-forest-100 focus:outline-none" />
                </label>
              </>
            )}
            <button type="submit" disabled={submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-forest-700 px-5 text-sm font-semibold text-white shadow-sm hover:bg-forest-800 disabled:cursor-not-allowed disabled:opacity-65">
              {submitting ? "Please wait…" : token ? "Update password" : "Send reset link"}
              {!submitting && (token ? <KeyRound aria-hidden="true" size={17} /> : <Mail aria-hidden="true" size={17} />)}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}