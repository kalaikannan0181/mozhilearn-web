import { BookOpen, Hash, MessageSquareText, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { MundariPlayButton } from "../components/MundariPlayButton";
import { apiFetch } from "../lib/apiClient";

type LibraryState = { vocabulary: any[]; classroom_phrases: any[]; textbook_terms: any[]; number_vocabulary: any[] };

export function LibraryPage() {
  const [data, setData] = useState<LibraryState>({ vocabulary: [], classroom_phrases: [], textbook_terms: [], number_vocabulary: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      apiFetch("/api/vocabulary").then((response) => response.json()),
      apiFetch("/api/classroom-phrases").then((response) => response.json()),
      apiFetch("/api/textbook-terms").then((response) => response.json()),
      apiFetch("/api/number-vocabulary").then((response) => response.json()),
    ]).then(([vocabulary, classroomPhrases, textbookTerms, numbers]) => setData({ vocabulary: vocabulary.vocabulary || [], classroom_phrases: classroomPhrases.classroom_phrases || [], textbook_terms: textbookTerms.textbook_terms || [], number_vocabulary: numbers.number_vocabulary || [] })).catch(() => setError("Unable to load content libraries."));
  }, []);

  const sections = [
    { key: "vocabulary", label: "Vocabulary", icon: BookOpen, items: data.vocabulary, render: (item: any) => `${item.hindi} · ${item.mundari_roman}` },
    { key: "classroom_phrases", label: "Classroom phrases", icon: MessageSquareText, items: data.classroom_phrases, render: (item: any) => `${item.hindi} · ${item.mundari_roman}` },
    { key: "textbook_terms", label: "Textbook terms", icon: ScrollText, items: data.textbook_terms, render: (item: any) => `${item.hindi} · ${item.mundari_roman || ""}` },
    { key: "number_vocabulary", label: "Numbers", icon: Hash, items: data.number_vocabulary, render: (item: any) => `${item.number_value}: ${item.hindi} · ${item.mundari_roman}` },
  ];

  return <div className="min-h-screen bg-[#f7f8f5]"><header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><BrandMark /><Link to="/dashboard" className="text-sm font-semibold text-forest-700">Dashboard</Link></div></header><main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><p className="text-sm font-semibold text-forest-700">Content library</p><h1 className="mt-1 text-3xl font-semibold text-slate-900">Classroom content</h1>{error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}<div className="mt-8 grid gap-5 md:grid-cols-2">{sections.map((section) => <section key={section.key} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><section.icon size={18} className="text-forest-700" /><h2 className="font-semibold text-slate-900">{section.label}</h2><span className="ml-auto text-xs text-slate-400">{section.items.length}</span></div><div className="mt-4 space-y-2">{section.items.slice(0, 12).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-700">{section.render(item)}</p><MundariPlayButton text={item.mundari_roman || item.hindi || ""} ttsInput={item.mundari_roman || item.hindi || ""} sourceType="library" sourceId={item.id} compact /></div>)}{section.items.length === 0 && <p className="text-sm text-slate-500">No records found.</p>}</div></section>)}</div></main></div>;
}
