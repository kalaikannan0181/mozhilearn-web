import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { StatusBadge } from "../components/StatusBadge";
import { Class1VoiceDemoCard } from "../components/Class1VoiceDemoCard";
import { useAuth } from "../features/auth/AuthProvider";
import { createLesson, fetchLessons, translateHindiToMundari } from "../lib/api";
import type { CreateLessonInput, Lesson } from "../types/lesson";

type LoadState = "loading" | "ready" | "error";

export function DashboardPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationMessage, setTranslationMessage] = useState("");
  const translationTimer = useRef<number | null>(null);
  const translationRequest = useRef(0);
  const [lessonForm, setLessonForm] = useState<CreateLessonInput>({
    title: "",
    grade: 1,
    subject: "",
    topic: "",
    learning_outcome_hindi: "",
    learning_outcome_mundari: "",
    status: "draft",
    version: 1,
  });
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function loadLessons(signal?: AbortSignal) {
    try {
      const loadedLessons = await fetchLessons(signal);
      setLessons(loadedLessons);
      setLoadState("ready");
    } catch (requestError: unknown) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return;
      }

      setError(requestError instanceof Error ? requestError.message : "Unable to load lessons from the server.");
      setLoadState("error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadLessons(controller.signal);

    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    if (translationTimer.current !== null) {
      window.clearTimeout(translationTimer.current);
    }
    translationRequest.current += 1;
  }, []);

  async function handleCreateLesson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isTranslating) {
      setFormError("Wait for the Mundari translation to finish before saving.");
      return;
    }

    setIsCreating(true);
    setFormError("");
    setSuccessMessage("");

    try {
      await createLesson(lessonForm);
      setLessonForm({
        title: "",
        grade: 1,
        subject: "",
        topic: "",
        learning_outcome_hindi: "",
        learning_outcome_mundari: "",
        status: "draft",
        version: 1,
      });
      setTranslationMessage("");
      await loadLessons();
      setSuccessMessage("Lesson created successfully.");
    } catch (requestError: unknown) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create the lesson.");
    } finally {
      setIsCreating(false);
    }
  }

  async function runAiTranslate(hindiText: string, requestId: number) {
    try {
      const translation = await translateHindiToMundari({ hindi_text: hindiText, preview: true, output_script: "roman" });
      if (requestId !== translationRequest.current) return;
      const romanText = translation.mundari_roman;
      if (!romanText || !/\p{Script=Latin}/u.test(romanText) || /\p{Script=Devanagari}/u.test(romanText)) {
        throw new Error("The translation service did not return Mundari Roman text.");
      }

      setLessonForm((current) => current.learning_outcome_hindi.trim() === hindiText
        ? { ...current, learning_outcome_mundari: romanText }
        : current);
      setTranslationMessage("AI-generated Mundari Roman draft. Script checked; native review required.");
    } catch (requestError: unknown) {
      if (requestId !== translationRequest.current) return;
      setTranslationMessage(requestError instanceof Error ? requestError.message : "Translation failed. Please try again.");
    } finally {
      if (requestId === translationRequest.current) setIsTranslating(false);
    }
  }

  function scheduleAiTranslate(hindiText: string) {
    if (translationTimer.current !== null) {
      window.clearTimeout(translationTimer.current);
      translationTimer.current = null;
    }

    const requestId = ++translationRequest.current;
    const normalizedText = hindiText.trim();
    if (!normalizedText) {
      setLessonForm((current) => ({ ...current, learning_outcome_mundari: "" }));
      setTranslationMessage("");
      setIsTranslating(false);
      return;
    }

    setIsTranslating(true);
    setLessonForm((current) => ({ ...current, learning_outcome_mundari: "" }));
    setTranslationMessage("Translating after you pause typing...");
    translationTimer.current = window.setTimeout(() => {
      translationTimer.current = null;
      void runAiTranslate(normalizedText, requestId);
    }, 700);
  }

  function handleAiTranslate() {
    const hindiText = lessonForm.learning_outcome_hindi.trim();
    if (!hindiText) {
      setTranslationMessage("Enter Hindi text before requesting a translation.");
      return;
    }

    if (translationTimer.current !== null) {
      window.clearTimeout(translationTimer.current);
      translationTimer.current = null;
    }

    const requestId = ++translationRequest.current;
    setIsTranslating(true);
    setTranslationMessage("Generating translation...");
    void runAiTranslate(hindiText, requestId);
  }

  const teacherName =
    (user?.user_metadata.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "Teacher";

  const firstName = teacherName.split(" ")[0];

  const counts = useMemo(
    () => ({
      total: lessons.length,
      review: lessons.filter((lesson) => lesson.status === "needs_review").length,
      published: lessons.filter((lesson) => lesson.status === "published").length,
    }),
    [lessons],
  );

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  const navigation = (
    <>
      <nav className="mt-8 space-y-1" aria-label="Main navigation">
        <Link
          to="/dashboard"
          className="flex items-center gap-3 rounded-xl bg-forest-50 px-3 py-2.5 text-sm font-semibold text-forest-800"
        >
          <LayoutDashboard size={18} />
          Dashboard
        </Link>
        <Link
          to="/lessons"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <BookOpen size={18} />
          All lessons
        </Link>
        <Link
          to="/packs"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <BookOpen size={18} />
          Offline packs
        </Link>
        <Link
          to="/library"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <BookOpen size={18} />
          Content library
        </Link>
        {(user?.role === "reviewer" || user?.role === "admin") && (
          <Link
            to="/review"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <CircleAlert size={18} />
            Review queue
          </Link>
        )}
      </nav>
      <div className="mt-auto rounded-2xl bg-forest-900 p-4 text-white">
        <div className="mb-3 grid size-8 place-items-center rounded-lg bg-white/10 text-saffron-400">
          <Sparkles size={16} />
        </div>
        <p className="text-sm font-semibold">AI-assisted learning</p>
        <p className="mt-1 text-xs leading-5 text-white/55">
          Translation drafts will always be marked for teacher review.
        </p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <LogOut size={17} />
        {loggingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white p-5 lg:flex">
        <BrandMark />
        {navigation}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(82vw,300px)] flex-col bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <BrandMark />
              <button
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
                className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>
            {navigation}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/90 backdrop-blur">
          <div className="flex h-[72px] items-center justify-between px-5 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <button
                aria-label="Open navigation"
                onClick={() => setMobileMenuOpen(true)}
                className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"
              >
                <Menu size={19} />
              </button>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-slate-800">Teacher workspace</p>
                <p className="mt-0.5 text-xs text-slate-400">SIH26042 · MozhiTech</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="max-w-52 truncate text-sm font-semibold text-slate-800">{teacherName}</p>
                <p className="max-w-52 truncate text-xs text-slate-400">{user?.email}</p>
              </div>
              <div className="grid size-10 place-items-center rounded-full bg-saffron-100 text-sm font-bold text-saffron-500 ring-4 ring-white">
                {teacherName.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold text-forest-700">Namaste, {firstName}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-slate-900 sm:text-[34px]">
                Your teaching dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Review your lessons and prepare what your class will learn next.
              </p>
            </div>
            <a
              href="#create-lesson"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("create-lesson")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-forest-700 px-4 text-sm font-semibold text-white shadow-sm shadow-forest-900/10 hover:bg-forest-800"
            >
              <Plus size={17} />
              Create new lesson
            </a>
          </div>

          <section aria-label="Lesson overview" className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Total lessons", value: counts.total, icon: FileText, color: "bg-forest-50 text-forest-700" },
              { label: "Needs review", value: counts.review, icon: CircleAlert, color: "bg-amber-50 text-amber-700" },
              { label: "Published", value: counts.published, icon: BookOpen, color: "bg-blue-50 text-blue-700" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.02)]">
                <div className={`grid size-11 place-items-center rounded-xl ${stat.color}`}>
                  <stat.icon size={20} />
                </div>
                <div>
                  <p className="text-2xl font-semibold tracking-[-0.03em] text-slate-900">{stat.value}</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">{stat.label}</p>
                </div>
              </div>
            ))}
          </section>

          <Class1VoiceDemoCard />

          <section id="create-lesson" className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgb(15_23_42/0.03)] sm:p-6">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">Create a lesson</h2>
              <p className="mt-1 text-xs text-slate-500">Add the lesson content your class will learn next.</p>
            </div>
            <form onSubmit={handleCreateLesson} className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["title", "Lesson title", "e.g. Numbers around us"],
                ["subject", "Subject", "e.g. Foundational Numeracy"],
                ["topic", "Topic", "e.g. Counting 1-5"],
              ].map(([name, label, placeholder]) => (
                <label key={name} className="grid gap-1.5 text-xs font-semibold text-slate-700">
                  {label}
                  <input
                    required={name !== "topic"}
                    value={lessonForm[name as "title" | "subject" | "topic"]}
                    onChange={(event) => setLessonForm((current) => ({ ...current, [name]: event.target.value }))}
                    placeholder={placeholder}
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-900 outline-none focus:border-forest-500 focus:ring-2 focus:ring-forest-100"
                  />
                </label>
              ))}
              <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                Grade
                <input
                  required
                  type="number"
                  min="1"
                  value={lessonForm.grade}
                  onChange={(event) => setLessonForm((current) => ({ ...current, grade: Number(event.target.value) }))}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-900 outline-none focus:border-forest-500 focus:ring-2 focus:ring-forest-100"
                />
              </label>
              {[
                ["learning_outcome_hindi", "Learning outcome in Hindi"],
                ["learning_outcome_mundari", "Learning outcome in Mundari"],
              ].map(([name, label]) => (
                <label key={name} className="grid gap-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">
                  <span className="flex items-center justify-between gap-3">
                    {label}
                    {name === "learning_outcome_hindi" && (
                      <button
                        type="button"
                        onClick={handleAiTranslate}
                        disabled={isTranslating || !lessonForm.learning_outcome_hindi.trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-forest-200 bg-forest-50 px-2.5 py-1.5 text-[11px] font-semibold text-forest-800 hover:bg-forest-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Sparkles size={13} />
                        {isTranslating ? "Generating..." : "Generate Mundari with AI"}
                      </button>
                    )}
                    {name === "learning_outcome_mundari" && <span className="text-[11px] font-normal text-slate-500">Generated in Roman script</span>}
                  </span>
                  <textarea
                    rows={3}
                    value={lessonForm[name as "learning_outcome_hindi" | "learning_outcome_mundari"]}
                    readOnly={name === "learning_outcome_mundari"}
                    placeholder={name === "learning_outcome_mundari" ? "Generated automatically from Hindi" : ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setLessonForm((current) => ({ ...current, [name]: value }));
                      if (name === "learning_outcome_hindi") scheduleAiTranslate(value);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-forest-500 focus:ring-2 focus:ring-forest-100"
                  />
                </label>
              ))}
              {translationMessage && (
                <p aria-live="polite" className="text-sm text-slate-600 sm:col-span-2">
                  {translationMessage}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <div aria-live="polite" className="text-sm">
                  {formError && <p className="text-red-700">{formError}</p>}
                  {successMessage && <p className="text-forest-700">{successMessage}</p>}
                </div>
                <button
                  type="submit"
                  disabled={isCreating || isTranslating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-forest-700 px-4 text-sm font-semibold text-white hover:bg-forest-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus size={16} />
                  {isCreating ? "Saving…" : "Save lesson"}
                </button>
              </div>
            </form>
          </section>

          <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgb(15_23_42/0.03)]">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">My lessons</h2>
                <p className="mt-1 text-xs text-slate-500">Only lessons created by your account are shown.</p>
              </div>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  disabled
                  aria-label="Search lessons"
                  placeholder="Search lessons"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm placeholder:text-slate-400 sm:w-56"
                />
              </div>
            </div>

            {loadState === "loading" && (
              <div className="space-y-3 p-5 sm:p-6">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            )}

            {loadState === "error" && (
              <div className="m-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 sm:m-6">
                <CircleAlert className="mt-0.5 shrink-0" size={18} />
                <div>
                  <p className="font-semibold">Lesson library needs attention</p>
                  <p className="mt-0.5 text-amber-800">{error}</p>
                </div>
              </div>
            )}

            {loadState === "ready" && lessons.length === 0 && (
              <div className="px-5 py-14 text-center sm:px-8 sm:py-16">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-forest-50 text-forest-700">
                  <BookOpen size={24} />
                </div>
                <h3 className="mt-5 text-base font-semibold text-slate-900">Your lesson library is ready</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  You have not created a lesson yet. Start with a topic your Class 1 students are learning.
                </p>
                <Link
                  to="/create-lesson"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-sm font-semibold text-forest-800 hover:bg-forest-100"
                >
                  <Plus size={16} />
                  Create your first lesson
                </Link>
              </div>
            )}

            {loadState === "ready" && lessons.length > 0 && (
              <div className="divide-y divide-slate-100">
                <div className="hidden grid-cols-[minmax(220px,2fr)_110px_minmax(150px,1fr)_130px_130px_24px] gap-4 bg-slate-50/70 px-6 py-3 text-[10px] font-bold tracking-[0.1em] text-slate-400 uppercase md:grid">
                  <span>Lesson</span>
                  <span>Grade</span>
                  <span>Topic</span>
                  <span>Status</span>
                  <span>Created</span>
                  <span />
                </div>
                {lessons.map((lesson) => (
                  <article
                    key={lesson.id}
                    className="group grid gap-3 px-5 py-5 hover:bg-slate-50/60 md:grid-cols-[minmax(220px,2fr)_110px_minmax(150px,1fr)_130px_130px_24px] md:items-center md:gap-4 md:px-6 md:py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-900">{lesson.title}</h3>
                        <p className="mt-1 text-xs text-slate-400">{lesson.subject}</p>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600">{lesson.grade}</p>
                    <p className="truncate text-sm text-slate-600">{lesson.topic}</p>
                    <div><StatusBadge status={lesson.status} /></div>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <CalendarDays size={14} className="md:hidden" />
                      {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(lesson.created_at))}
                    </p>
                    <ChevronRight size={17} className="hidden text-slate-300 group-hover:text-forest-700 md:block" />
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
