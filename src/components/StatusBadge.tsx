import type { LessonStatus } from "../types/lesson";

const styles: Record<LessonStatus, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  ai_assisted: "border-violet-200 bg-violet-50 text-violet-700",
  needs_review: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const labels: Record<LessonStatus, string> = {
  draft: "Draft",
  ai_assisted: "AI Assisted",
  needs_review: "Needs Review",
  approved: "Approved",
  published: "Published",
};

export function StatusBadge({ status }: { status: LessonStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${styles[status] ?? styles.draft}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
