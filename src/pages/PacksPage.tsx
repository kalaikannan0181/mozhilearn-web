import { Archive, Box, CheckCircle2, Plus } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { createOfflinePack, fetchPacks, publishPack, type OfflinePack } from "../lib/api";

export function PacksPage() {
  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [name, setName] = useState("Grade 1 Mundari FLN");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() { try { setPacks(await fetchPacks()); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load packs."); } }
  useEffect(() => { load(); }, []);

  async function create(event: FormEvent) { event.preventDefault(); setError(""); setMessage(""); try { await createOfflinePack({ name, language: "Mundari", grade: 1 }); setMessage("Pack created from approved content."); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create pack."); } }
  async function publish(id: number) { setError(""); try { await publishPack(id); setMessage("Pack published."); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish pack."); } }

  return <div className="min-h-screen bg-[#f7f8f5]"><header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><BrandMark /><Link to="/dashboard" className="text-sm font-semibold text-forest-700">Dashboard</Link></div></header><main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><p className="text-sm font-semibold text-forest-700">Offline preparation</p><h1 className="mt-1 text-3xl font-semibold text-slate-900">Offline packs</h1><p className="mt-2 text-sm text-slate-500">Only approved or published lessons can enter a published pack.</p>{error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{message && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}<form onSubmit={create} className="mt-8 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-5"><input value={name} onChange={(event) => setName(event.target.value)} required className="h-10 min-w-64 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm" /><button className="inline-flex items-center gap-2 rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16} />Create Grade 1 pack</button></form><div className="mt-6 space-y-3">{packs.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No packs created yet.</div>}{packs.map((pack) => <article key={pack.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="grid size-10 place-items-center rounded-xl bg-forest-50 text-forest-700"><Box size={18} /></div><div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-900">{pack.name}</h2><p className="mt-1 text-xs text-slate-500">{pack.language} · Grade {pack.grade} · Version {pack.version}</p></div><span className="text-xs font-semibold text-slate-600">{pack.status}</span>{pack.status !== "published" && <button type="button" onClick={() => publish(pack.id)} className="inline-flex items-center gap-2 rounded-lg bg-forest-700 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 size={14} />Publish</button>}{pack.status === "published" && <Archive size={17} className="text-forest-700" />}</article>)}</div></main></div>;
}