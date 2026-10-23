import axios from "axios";

const rawUrl = import.meta.env.VITE_API_URL || "https://onegrasp-backend.onrender.com";
const cleanUrl = rawUrl.replace(/\/+$/, "");
const baseURL = cleanUrl.endsWith("/api/v1") ? cleanUrl : `${cleanUrl}/api/v1`;

console.log("[API] Connecting to backend at:", baseURL);

const api = axios.create({
  baseURL,
  // The backend (Render free tier) sleeps when idle and can take up to ~2 min
  // to wake on the first request. A short timeout turns that cold start into a
  // false "unable to connect" error, so we wait it out.
  timeout: 120000,
});

// Attach JWT token to every request if it exists in session or local storage
api.interceptors.request.use(
  (config) => {
    config.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    config.headers["Pragma"] = "no-cache";
    const token = sessionStorage.getItem("token") || localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercept responses to unwrap error messages cleanly and handle 401 auth expiry
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isAuthLogin = error.config?.url?.includes("/auth/login");
      if (!isAuthLogin) {
        sessionStorage.removeItem("token");
        localStorage.removeItem("token");
        window.location.href = "/";
      }
    }

    if (error.response?.data?.error) {
      if (typeof error.response.data.error === "object") {
        error.response.data.error = error.response.data.error.message || JSON.stringify(error.response.data.error);
      }
    } else if (error.response?.data?.message) {
      if (!error.response.data.error) {
        error.response.data.error = error.response.data.message;
      }
    } else if (!error.response) {
      error.message = "Unable to connect to server. Please check your internet connection.";
    }

    return Promise.reject(error);
  }
);

// Fire a warm-up request as soon as the app loads so the backend starts waking
// from its idle sleep while the user reads the login screen / types — by the
// time they submit, the cold start is usually already done. Fire-and-forget.
try {
  api.get("/health").catch(() => {});
} catch (_) {
  // ignore — this is a best-effort warm-up only
}

// Auth
export const login = (password) => api.post("/auth/login", { password });
export const logout = () => {
  sessionStorage.removeItem("token");
  localStorage.removeItem("token");
  return api.post("/auth/logout").catch(() => {});
};

// Contacts
export const uploadContacts = (formData) =>
  api.post("/contacts/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getContacts = (params = {}) => api.get("/contacts", { params });
export const getContactSets = () => api.get("/contacts/sets");
export const assignContactSet = (data) => api.post("/contacts/sets/assign", data);
export const removeContactSet = (data) => api.post("/contacts/sets/remove", data);

export const addSingleContact = (data) => api.post("/contacts", data);
export const deleteBulkContacts = (ids) => api.post("/contacts/bulk-delete", { ids });
export const updateContactLabel = (id, label) =>
  api.patch(`/contacts/${id}/label`, { label });

export const deleteContact = (id) => api.delete(`/contacts/${id}`);
export const toggleImportantContact = (phone, isImportant) =>
  api.patch(`/contacts/important/${phone}`, { isImportant });
// status: "opted_in" (with where consent came from) or "opted_out"
export const updateContactConsent = (contactIds, status, source) =>
  api.post("/contacts/consent", { contactIds, status, source });

// Messaging
export const sendBulkMessages = (data) => api.post("/send-bulk", data);
export const sendSingleMessage = (data) => api.post("/send-message", data);

// Templates
export const getTemplates = () => api.get(`/templates?_t=${Date.now()}`);
export const getTemplateById = (id) => api.get(`/templates/${id}`);
export const createTemplate = (data) => api.post("/templates", data);
export const updateTemplate = (id, data) => api.put(`/templates/${id}`, data);
export const deleteTemplate = (id) => api.delete(`/templates/${id}`);
export const submitTemplate = (id) => api.post(`/templates/${id}/submit`);
export const syncTemplateStatus = (id) => api.get(`/templates/${id}/status`);
export const syncAllTemplates = () => api.post("/templates/sync");

// Media Upload
export const uploadMediaFile = (formData) =>
  api.post("/media/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

// Campaigns
export const getCampaigns = () => api.get("/campaigns");
export const getCampaignMessages = (id) => api.get(`/campaigns/${id}/messages`);
// What a campaign would do before sending: skipped contacts, daily limit, start time.
export const campaignPreflight = (data) => api.post("/campaigns/preflight", data);
export const pauseCampaign = (id) => api.post(`/campaigns/${id}/pause`);
export const resumeCampaign = (id) => api.post(`/campaigns/${id}/resume`);
export const cancelCampaign = (id) => api.post(`/campaigns/${id}/cancel`);

// Conversations & Messages
export const getConversations = (params = {}) =>
  api.get("/conversations", { params });

export const getMessages = (phone, params = {}) =>
  api.get(`/messages/${phone}`, { params });

// Stats
export const getStats = () => api.get("/stats");

// Settings
export const getSettings = () => api.get("/settings");
export const updateSettings = (data) => api.post("/settings", data);

// Logs
export const getLogs = (params = {}) => api.get("/logs", { params });

export default api;
