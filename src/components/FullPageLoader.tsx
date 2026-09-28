export function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f8f5]">
      <div className="flex flex-col items-center gap-4 text-sm font-medium text-slate-600">
        <span className="size-8 animate-spin rounded-full border-3 border-forest-100 border-t-forest-700" />
        <span>{label}</span>
      </div>
    </div>
  );
}
