(() => {
  const api = window.__TAURI__;
  const maximize = document.getElementById("maximize");
  const logo = document.getElementById("logo");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = "auto";
  const syncTheme = () => {
    const dark = theme === "dark" || (theme === "auto" && systemTheme.matches);
    document.documentElement.classList.toggle("dark", dark);
    logo.src = dark ? "logo-white.png" : "logo-black.png";
  };
  const applyState = (state) => {
    theme = state.theme;
    syncTheme();
    document.documentElement.classList.toggle("unfocused", !state.focused);
    maximize.setAttribute("aria-label", state.maximized ? "还原" : "最大化");
    maximize.innerHTML = state.maximized
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="4" y="2" width="6" height="6" /><path d="M8 8v2H2V4h2" /></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg>';
  };
  const action = (name) => api.core.invoke("desktop_window_action", { action: name })
    .then(applyState)
    .catch((error) => console.error("Window control failed:", error));
  document.getElementById("minimize").addEventListener("click", () => action("minimize"));
  maximize.addEventListener("click", () => action("maximize"));
  document.getElementById("close").addEventListener("click", () => action("close"));
  const dragRegion = document.getElementById("drag-region");
  dragRegion.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    // Windows' native drag loop consumes mouse events; handle double-clicks
    // here before entering the drag loop, rather than waiting for dblclick.
    action(event.detail === 2 ? "maximize" : "drag");
  });
  systemTheme.addEventListener("change", syncTheme);
  syncTheme();
  // Show the window only once these local controls have registered.
  api.event.listen("desktop-frame-state", (event) => applyState(event.payload))
    .then(() => action("ready"))
    .catch((error) => {
      console.error("Window-state listener failed:", error);
      void action("ready");
    });
})();
