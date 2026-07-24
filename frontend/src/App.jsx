import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SocketProvider } from "./context/SocketContext";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import BulkSender from "./pages/BulkSender";
import Chats from "./pages/Chats";
import Contacts from "./pages/Contacts";
import Campaigns from "./pages/Campaigns";
import Templates from "./pages/Templates";
import Logs from "./pages/Logs";
import { Lock, LogIn, Sparkles } from "lucide-react";
import { login as apiLogin } from "./services/api";

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
      localStorage.setItem("token", res.data.token);
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
    <div className="min-h-screen flex items-center justify-center bg-[#F5FEF7] p-4 font-sans">
      <div className="w-full max-w-md bg-white border border-[#D7EAD6] rounded-3xl p-8 shadow-xl relative overflow-hidden">
        {/* Decorative background gradients */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-wa-green/10 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-wa-dark/10 rounded-full blur-2xl" />

        <div className="text-center mb-8 relative">
          <div className="w-16 h-16 bg-wa-green/15 rounded-full flex items-center justify-center mx-auto mb-4 border border-wa-green/20">
            <Lock className="text-wa-dark" size={24} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center justify-center gap-1.5">
            <Sparkles size={18} className="text-wa-green animate-pulse" />
            WA Campaign Manager
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-medium">Please authenticate to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs text-center font-semibold animate-shake">
              ⚠️ {error}
            </div>
          )}
          
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
              Admin Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-wa-green focus:bg-white transition-all font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-wa-green hover:bg-wa-dark text-slate-900 font-semibold px-4 py-3 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm shadow-md active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed"
          >
            {loading ? "Authenticating..." : (
              <>
                <LogIn size={16} />
                Access Console
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token"));

  if (!token) {
    return <Login onLoginSuccess={setToken} />;
  }

  return (
    <SocketProvider>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden bg-[#F5FEF7]">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/bulk" element={<BulkSender />} />
              <Route path="/chats" element={<Chats />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </main>
        </div>
        <Analytics />
      </BrowserRouter>
    </SocketProvider>
  );
}
