import { Link, useLocation } from "react-router-dom";

export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-brand-600">404</p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          There's no page at <span className="break-all font-mono text-13 text-gray-700">{pathname}</span>. Check the address, or
          go back to the dashboard.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={() => window.history.back()} className="btn btn-secondary">
            Go back
          </button>
          <Link to="/dashboard" className="btn btn-primary">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
