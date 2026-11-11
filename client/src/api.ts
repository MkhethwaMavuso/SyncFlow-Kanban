import axios from "axios";

function getApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  if (typeof window !== "undefined" && window.location.hostname.endsWith(".app.github.dev")) {
    return "";
  }

  return "http://localhost:4000";
}

export const apiBaseUrl = getApiBaseUrl();

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});
