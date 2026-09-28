import { ArrowRight, BookOpen, Plus } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { StatusBadge } from "../components/StatusBadge";
import { useEffect, useState } from "react";
import { fetchLessons } from "../lib/api";
import type { Lesson } from "../types/lesson";

export function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    fetchLessons().then(setLessons).then(() => setState("ready")).catch(() => setState("error"));
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <BrandMark />
          <Link to="/dashboard" className="text-sm font-semibold text-forest-700">Dashboard</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <div className="flex items-end justify-between gap-4">
          <div><p className="text-sm font-semibold text-forest-700">Teacher workspace</p><h1 className="mt-1 text-3xl font-semibold text-slate-900">Lessons</h1></div>
          <a href="/dashboard#create-lesson" className="inline-flex items-center gap-2 rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16} />Create lesson</a>
        </div>
        {state === "loading" && <div className="mt-8 h-32 animate-pulse rounded-2xl bg-slate-200" />}
        {state === "error" && <p className="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-800">Unable to load lessons.</p>}
        {state === "ready" && lessons.length === 0 && <p className="mt-8 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">No lessons found.</p>}
        {state === "ready" && lessons.length > 0 && <div className="mt-8 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">{lessons.map((lesson) => <Link key={lesson.id} to={`/lessons/${lesson.id}`} className="flex items-center gap-4 p-5 hover:bg-slate-50"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700"><BookOpen size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{lesson.title}</p><p className="mt-1 text-xs text-slate-500">Grade {lesson.grade} · {lesson.subject} · {lesson.topic}</p></div><StatusBadge status={lesson.status} /><ArrowRight size={17} className="text-slate-300" /></Link>)}</div>}
      </main>
    </div>
  );
}