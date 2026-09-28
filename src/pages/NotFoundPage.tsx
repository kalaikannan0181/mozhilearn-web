import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f8f5] px-5 text-center">
      <div>
        <p className="text-sm font-bold text-forest-700">404</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-3 text-sm text-slate-500">The page you are looking for does not exist.</p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
