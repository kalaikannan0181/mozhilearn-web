import { Check, CircleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { fetchReviewQueue, updateTranslationReview } from "../lib/api";
import type { Translation, TranslationStatus } from "../types/lesson";

export function ReviewerPage() {
  const [items, setItems] = useState<Translation[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try { setItems(await fetchReviewQueue()); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load review queue."); }
  }

  useEffect(() => { load(); }, []);

  async function review(item: Translation, status: TranslationStatus) {
    try { await updateTranslationReview(item.id, status, status === "rejected" ? "Changes requested by reviewer." : "Reviewed in the web queue."); setMessage(`Translation marked ${status}.`); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update translation."); }
  }

  return <div className="min-h-screen bg-[#f7f8f5]"><header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><BrandMark /><Link to="/dashboard" className="text-sm font-semibold text-forest-700">Dashboard</Link></div></header><main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><p className="text-sm font-semibold text-forest-700">Native review</p><h1 className="mt-1 text-3xl font-semibold text-slate-900">Review queue</h1><p className="mt-2 text-sm text-slate-500">AI output remains a draft until a human reviewer approves it.</p>{error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{message && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}<div className="mt-8 space-y-4">{items.length === 0 && !error && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No translations are waiting for review.</div>}{items.map((item) => { const nextStatus = item.status === "native_reviewed" ? "approved" : "native_reviewed"; return <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-forest-700">{item.lesson_id ? `Lesson ${item.lesson_id}` : "Unattached draft"}</p><h2 className="mt-1 text-base font-semibold text-slate-900">Translation review</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{item.status}</span></div><div className="mt-4 grid gap-4 md:grid-cols-2"><div><p className="text-xs font-semibold text-slate-500">Hindi source</p><p className="mt-1 text-sm leading-6 text-slate-800">{item.hindi_text}</p></div><div><p className="text-xs font-semibold text-slate-500">Mundari draft</p><p className="mt-1 text-sm leading-6 text-slate-800">{item.mundari_text}</p></div></div><p className="mt-4 text-xs text-slate-500">Source: {item.source} · AI-generated draft — review required</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => review(item, nextStatus)} className="inline-flex items-center gap-2 rounded-lg bg-forest-700 px-3 py-2 text-xs font-semibold text-white"><Check size={14} />{nextStatus === "approved" ? "Approve translation" : "Mark native reviewed"}</button><button type="button" onClick={() => review(item, "rejected")} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700"><X size={14} />Request changes</button><CircleAlert size={16} className="ml-auto text-slate-300" /></div></article>; })}</div></main></div>;
}