import axios from "axios";

const rawUrl = import.meta.env.VITE_API_URL || "https://onegrasp-backend.onrender.com";
const cleanUrl = rawUrl.replace(/\/+$/, "");
const baseURL = cleanUrl.endsWith("/api/v1") ? cleanUrl : `${cleanUrl}/api/v1`;

console.log("[API] Connecting to backend at:", baseURL);

const api = axios.create({
  baseURL,
  timeout: 30000,
});

// Attach JWT token to every request if it exists in local storage
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
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

// Auth
export const login = (password) => api.post("/auth/login", { password });

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

// Messaging
export const sendBulkMessages = (data) => api.post("/send-bulk", data);
export const sendSingleMessage = (data) => api.post("/send-message", data);

// Templates
export const getTemplates = () => api.get("/templates");
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
