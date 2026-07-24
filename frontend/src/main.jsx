import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Production Anti-Tampering & Security Hardening
if (import.meta.env.PROD) {
  // Suppress verbose console debug output in browser developer tools
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};

  // Prevent keyboard shortcuts for Inspect Element / DevTools (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
  window.addEventListener("keydown", (e) => {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) ||
      (e.ctrlKey && (e.key === "U" || e.key === "u"))
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Block right-click context menu inspect element shortcut
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (!import.meta.env.PROD) {
      console.error("Uncaught UI Error:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F5FEF7] p-6 text-center font-sans select-none">
          <div className="max-w-md bg-white border border-rose-200 rounded-3xl p-8 shadow-xl">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600 font-bold text-xl">
              🛡️
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Secure Session Exception</h2>
            <p className="text-xs text-slate-500 mb-6">
              An unexpected application state occurred. Please reload to resume your secure session.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-wa-green hover:bg-wa-dark text-slate-900 font-semibold px-6 py-2.5 rounded-2xl text-xs transition-all shadow-md"
            >
              Reload Secure Session
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
