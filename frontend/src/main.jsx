import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Suppress verbose console output in production. (Note: blocking DevTools /
// right-click was removed — client code is always inspectable, so it added no
// security while harming debugging and accessibility.)
if (import.meta.env.PROD) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
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

  handleResetToDashboard = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F5FEF7] p-6 text-center font-sans select-none">
          <div className="max-w-md bg-white border border-rose-200 rounded-3xl p-8 shadow-xl">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600 font-bold text-xl">
              🛡️
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Application Notice</h2>
            <p className="text-xs text-slate-500 mb-6">
              An unexpected display issue occurred in this section. You can return safely to your dashboard.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleResetToDashboard}
                className="bg-wa-green hover:bg-wa-dark text-slate-900 font-semibold px-5 py-2.5 rounded-2xl text-xs transition-all shadow-md active:scale-[0.98]"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-5 py-2.5 rounded-2xl text-xs transition-all active:scale-[0.98]"
              >
                Reload Session
              </button>
            </div>
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
