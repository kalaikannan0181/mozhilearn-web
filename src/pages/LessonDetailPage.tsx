import { ArrowLeft, BookOpen, ClipboardCheck, FileText, Plus, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { ClassroomMaterialsGenerator } from "../components/ClassroomMaterialsGenerator";
import { MundariPlayButton } from "../components/MundariPlayButton";
import { StatusBadge } from "../components/StatusBadge";
import { createActivity, createAssessment, createTranslation, fetchLesson, fetchLessonTranslations, translateHindiToMundari } from "../lib/api";
import type { LessonDetail, Translation } from "../types/lesson";

export function LessonDetailPage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hindiText, setHindiText] = useState("");
  const [mundariText, setMundariText] = useState("");
  const [activityName, setActivityName] = useState("");
  const [activityGuide, setActivityGuide] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [loadedLesson, loadedTranslations] = await Promise.all([fetchLesson(lessonId), fetchLessonTranslations(lessonId)]);
    setLesson(loadedLesson);
    setTranslations(loadedTranslations);
  }

  useEffect(() => {
    if (!Number.isInteger(lessonId)) { setError("Invalid lesson ID."); return; }
    load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load lesson."));
  }, [lessonId]);

  async function submitTranslation(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await createTranslation({ lesson_id: lessonId, hindi_text: hindiText, mundari_text: mundariText, source: "manual" }); setHindiText(""); setMundariText(""); await load(); setMessage("Translation draft saved. Review required."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save translation."); } finally { setBusy(false); }
  }

  async function generateDraft() {
    if (!hindiText.trim()) { setError("Enter Hindi text before requesting a draft."); return; }
    setBusy(true); setError(""); setMessage("Generating translation...");
    try { const draft = await translateHindiToMundari({ lesson_id: lessonId, hindi_text: hindiText }); setMundariText(draft.mundari_text); setMessage("AI-generated draft — review required"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Translation failed. Please try again."); } finally { setBusy(false); }
  }

  async function submitActivity(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await createActivity(lessonId, { activity_name: activityName, hindi_guide: activityGuide, mundari_guide: null }); setActivityName(""); setActivityGuide(""); await load(); setMessage("Activity saved."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save activity."); } finally { setBusy(false); }
  }

  async function submitAssessment(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await createAssessment(lessonId, { question_no: (lesson?.assessments.length || 0) + 1, hindi_question: question, mundari_question: null, expected_answer: answer }); setQuestion(""); setAnswer(""); await load(); setMessage("Assessment saved."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save assessment."); } finally { setBusy(false); }
  }

  if (!lesson && !error) return <div className="grid min-h-screen place-items-center bg-[#f7f8f5] text-sm text-slate-500">Loading lesson...</div>;

  return <div className="min-h-screen bg-[#f7f8f5]"><header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><BrandMark /><Link to="/lessons" className="inline-flex items-center gap-2 text-sm font-semibold text-forest-700"><ArrowLeft size={16} />Lessons</Link></div></header><main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">{error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{lesson && <><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-forest-700">Grade {lesson.grade} · {lesson.subject}</p><h1 className="mt-1 text-3xl font-semibold text-slate-900">{lesson.title}</h1><p className="mt-2 text-sm text-slate-500">{lesson.topic}</p></div><StatusBadge status={lesson.status} /></div>{message && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}<div className="mt-8 grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><FileText size={18} className="text-forest-700" /><h2 className="font-semibold text-slate-900">Learning outcomes</h2></div><p className="mt-4 text-sm leading-6 text-slate-700">{lesson.learning_outcome_hindi || "No Hindi outcome recorded."}</p><div className="mt-3 flex items-center justify-between gap-3"><p className="text-sm leading-6 text-slate-600">{lesson.learning_outcome_mundari || "No Mundari outcome recorded."}</p>{lesson.learning_outcome_mundari ? <MundariPlayButton text={lesson.learning_outcome_mundari} ttsInput={lesson.learning_outcome_mundari} sourceType="lesson" sourceId={lesson.id} compact /> : null}</div><form onSubmit={submitTranslation} className="mt-6 space-y-3 border-t border-slate-100 pt-5"><h3 className="text-sm font-semibold text-slate-900">Translation editor</h3><textarea required value={hindiText} onChange={(event) => setHindiText(event.target.value)} placeholder="Hindi source text" rows={3} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" /><textarea required value={mundariText} onChange={(event) => setMundariText(event.target.value)} placeholder="Mundari draft" rows={3} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" /><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={generateDraft} className="inline-flex items-center gap-2 rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-xs font-semibold text-forest-800"><Sparkles size={14} />AI Translate</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-forest-700 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} />Save draft</button></div></form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><BookOpen size={18} className="text-forest-700" /><h2 className="font-semibold text-slate-900">Activities</h2></div><div className="mt-4 space-y-3">{lesson.activities.map((activity) => <article key={activity.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-800">{activity.activity_name}</p><p className="mt-1 text-xs leading-5 text-slate-600">{activity.hindi_guide}</p></article>)}</div><form onSubmit={submitActivity} className="mt-5 space-y-2 border-t border-slate-100 pt-4"><input required value={activityName} onChange={(event) => setActivityName(event.target.value)} placeholder="Activity name" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /><textarea required value={activityGuide} onChange={(event) => setActivityGuide(event.target.value)} placeholder="Hindi guide" rows={2} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><button disabled={busy} className="rounded-lg bg-forest-700 px-3 py-2 text-xs font-semibold text-white">Add activity</button></form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><ClipboardCheck size={18} className="text-forest-700" /><h2 className="font-semibold text-slate-900">Assessments</h2></div><div className="mt-4 space-y-3">{lesson.assessments.map((assessment) => <article key={assessment.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-800">{assessment.question_no}. {assessment.hindi_question}</p><p className="mt-1 text-xs text-slate-600">Answer: {assessment.expected_answer || "Not recorded"}</p></article>)}</div><form onSubmit={submitAssessment} className="mt-5 space-y-2 border-t border-slate-100 pt-4"><input required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Hindi question" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Expected answer" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /><button disabled={busy} className="rounded-lg bg-forest-700 px-3 py-2 text-xs font-semibold text-white">Add assessment</button></form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Saved translations</h2><div className="mt-4 space-y-3">{translations.length === 0 ? <p className="text-sm text-slate-500">No translations recorded.</p> : translations.map((translation) => <article key={translation.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm text-slate-700">{translation.hindi_text}</p><p className="mt-2 text-sm text-slate-600">{translation.mundari_text}</p><p className="mt-2 text-xs font-semibold text-forest-700">{translation.source} · {translation.status}</p></article>)}</div></section></div><div className="mt-8"><ClassroomMaterialsGenerator selectedLessonId={lesson.id} /></div></>}</main></div>;
}
