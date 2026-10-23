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
        <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
          <div className="panel w-full max-w-md p-6 shadow-sm">
            <h1 className="text-base font-semibold text-gray-900">Something went wrong</h1>
            <p className="mt-1 text-sm text-gray-500">
              This page hit an unexpected error. Your data is safe — reload the page or return to the dashboard.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="btn btn-secondary"
              >
                Reload page
              </button>
              <button type="button" onClick={this.handleResetToDashboard} className="btn btn-primary">
                Go to dashboard
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
