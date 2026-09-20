(() => {
  const STORAGE_KEY = "svuTheme";

  function getApiBase() {
    const explicitBase = window.SVU_API_BASE || localStorage.getItem("svuApiBase");
    if (explicitBase) {
      return String(explicitBase).replace(/\/$/, "");
    }

    const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    return isLocalDev ? `${window.location.protocol}//${window.location.hostname}:3010` : window.location.origin;
  }

  function parseServerMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return "";
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return "";

    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed.message === "string" ? parsed.message : "";
    } catch (_) {
      return trimmed.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  async function getFriendlyError(response) {
    const raw = await response.text().catch(() => "");
    const parsed = parseServerMessage(raw);
    if (parsed) return parsed;

    if (response.status === 404) {
      return "The backend API could not be reached. Please start the server on port 3010 and try again.";
    }

    if (response.status >= 500) {
      return "The server hit a problem. Please try again in a moment.";
    }

    return "Something went wrong. Please try again.";
  }

  function setupThemeToggle() {
    const STYLE_ID = "svuThemeToggleStyles";
    const BUTTON_ID = "themeToggleButton";

    const css =
      ".theme-toggle-fab{position:fixed;right:22px;top:22px;z-index:9999;display:inline-flex;align-items:center;gap:10px;padding:12px 16px;border-radius:16px;border:1px solid rgba(22,163,74,.26);background:linear-gradient(145deg,rgba(247,252,245,.98),rgba(216,230,216,.98));color:#14532d;box-shadow:0 8px 20px rgba(60,80,60,.2);font:inherit;font-weight:700;cursor:pointer}.theme-toggle-fab:focus-visible{outline:3px solid rgba(34,197,94,.55);outline-offset:3px}.theme-toggle-icon{width:1rem;height:1rem;border-radius:999px;background:currentColor;box-shadow:inset -4px 0 0 rgba(255,255,255,.85);flex:0 0 auto}html.theme-dark,body.theme-dark{color-scheme:dark;background:#07130c!important;color:#e8f5ea!important}@media (max-width:640px){.theme-toggle-fab{right:12px;top:12px;padding:10px 12px}}";

    function readTheme() {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch (_) {
        return null;
      }
    }

    function writeTheme(value) {
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch (_) {}
    }

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }

    function syncTheme(isDark) {
      document.documentElement.classList.toggle("theme-dark", isDark);
      document.body.classList.toggle("theme-dark", isDark);
      const button = document.getElementById(BUTTON_ID);
      if (button) {
        button.setAttribute("aria-pressed", String(isDark));
        const label = button.querySelector(".theme-toggle-text");
        if (label) label.textContent = isDark ? "Light Mode" : "Dark Mode";
      }
    }

    function getInitialTheme() {
      const savedTheme = readTheme();
      if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function mountToggle() {
      ensureStyles();
      const isDark = getInitialTheme() === "dark";
      syncTheme(isDark);
      if (document.getElementById(BUTTON_ID)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.id = BUTTON_ID;
      button.className = "theme-toggle-fab";
      button.setAttribute("aria-label", "Toggle dark mode");
      button.setAttribute("aria-pressed", String(isDark));
      button.innerHTML =
        '<span class="theme-toggle-icon" aria-hidden="true"></span><span class="theme-toggle-text">' +
        (isDark ? "Light Mode" : "Dark Mode") +
        "</span>";
      button.addEventListener("click", () => {
        const nextIsDark = !document.body.classList.contains("theme-dark");
        writeTheme(nextIsDark ? "dark" : "light");
        syncTheme(nextIsDark);
      });
      document.body.appendChild(button);
    }

    if (document.body) {
      mountToggle();
    } else {
      document.addEventListener("DOMContentLoaded", mountToggle, { once: true });
    }
  }

  window.SVUCommon = {
    getApiBase,
    parseServerMessage,
    getFriendlyError,
    setupThemeToggle,
  };
})();
