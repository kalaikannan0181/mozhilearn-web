import { ArrowLeft, BookOpen } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";

export function PlannedPage() {
  return (
    <main className="min-h-screen bg-[#f7f8f5] px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <BrandMark />
        <div className="mt-16 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm sm:px-12">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-forest-50 text-forest-700">
            <BookOpen size={25} />
          </div>
          <p className="mt-5 text-xs font-bold tracking-[0.13em] text-forest-700 uppercase">Next phase</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-900">
            Lesson creation is coming next
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
            This phase includes only login and the teacher dashboard, as requested.
          </p>
          <Link
            to="/dashboard"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-800"
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
