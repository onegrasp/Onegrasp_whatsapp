import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { SocketProvider } from "./context/SocketContext";
import AppShell from "./components/AppShell";
import { FeedbackProvider } from "./components/feedback";
import { SettingsProvider } from "./components/SettingsDialog";
import Dashboard from "./pages/Dashboard";
import BulkSender from "./pages/BulkSender";
import Chats from "./pages/Chats";
import Contacts from "./pages/Contacts";
import Campaigns from "./pages/Campaigns";
import Templates from "./pages/Templates";
import Logs from "./pages/Logs";
import NotFound from "./pages/NotFound";
import { login as apiLogin, logout as apiLogout } from "./services/api";

function Login({ onLoginSuccess }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiLogin(password);
      // Stored in sessionStorage so closing the tab ends the session.
      sessionStorage.setItem("token", res.data.token);
      onLoginSuccess(res.data.token);
    } catch (err) {
      const errData = err.response?.data?.error;
      const errorMsg = typeof errData === "object" ? errData.message : (errData || err.message || "Invalid password or server error");
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 text-xs font-semibold text-white" aria-hidden="true">
            OG
          </div>
          <span className="text-sm font-semibold text-gray-900">OneGrasp</span>
        </div>

        <div className="panel p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">Enter the admin password to open the console.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
                className="input"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            {error && (
              <p id="login-error" role="alert" className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">The first sign-in after a quiet period can take up to a minute while the server starts.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("token"));

  // Signs out on the server too, so the token stops working everywhere.
  const handleLogout = async () => {
    await apiLogout();
    setToken(null);
  };

  if (!token) {
    return <Login onLoginSuccess={setToken} />;
  }

  return (
    <SocketProvider>
      <BrowserRouter>
        <FeedbackProvider>
          <SettingsProvider>
            <AppShell onLogout={handleLogout}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/bulk" element={<BulkSender />} />
                <Route path="/chats" element={<Chats />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppShell>
          </SettingsProvider>
        </FeedbackProvider>
      </BrowserRouter>
    </SocketProvider>
  );
}
