// Where the backend lives. Set VITE_API_URL to override.
//
// Production builds default to the production API. Local development defaults
// to a backend on this machine, so running the app on a laptop never reads or
// changes production data by accident.
//
// If the production API address changes, also update connect-src in
// frontend/vercel.json, which only allows the browser to talk to that address.
const DEFAULT_API = import.meta.env.DEV ? "http://localhost:5000" : "https://onegrasp-backend.onrender.com";

export const API_ORIGIN = (import.meta.env.VITE_API_URL || DEFAULT_API).replace(/\/+$/, "").replace(/\/api\/v1$/, "");
