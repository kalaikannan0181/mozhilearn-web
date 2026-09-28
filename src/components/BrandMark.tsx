import { Languages } from "lucide-react";

export function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid size-10 place-items-center rounded-xl ${
          inverse ? "bg-white/12 text-white" : "bg-forest-700 text-white"
        }`}
      >
        <Languages aria-hidden="true" size={21} strokeWidth={2.2} />
      </div>
      <div className="leading-none">
        <p className={`text-[17px] font-bold tracking-[-0.02em] ${inverse ? "text-white" : "text-forest-900"}`}>
          MozhiLearn
        </p>
        <p className={`mt-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase ${inverse ? "text-white/55" : "text-forest-700/60"}`}>
          PALASH AI Classroom
        </p>
      </div>
    </div>
  );
}
