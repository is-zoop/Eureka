(() => {
  const api = window.__TAURI__;
  const maximize = document.getElementById("maximize");
  const logo = document.getElementById("logo");
  const back = document.getElementById("back");
  const forward = document.getElementById("forward");
  const menuIds = ["file", "edit", "view", "help"];
  const menuButtons = menuIds.map((id) => document.getElementById(`menu-${id}`));
  let openMenuId = null;
  const reflectMenu = () => menuButtons.forEach((button, index) => button.setAttribute("aria-expanded", String(menuIds[index] === openMenuId)));
  const openMenu = (menu) => {
    const button = menuButtons[menuIds.indexOf(menu)];
    if (menu !== null && (!button || button.disabled)) return;
    openMenuId = menu;
    reflectMenu();
    void api.core.invoke("desktop_open_menu", { menu, x: button?.getBoundingClientRect().left ?? 0 }).catch((error) => {
      openMenuId = null; reflectMenu();
      console.error("Could not open desktop menu:", error);
    });
  };
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
    document.documentElement.classList.toggle("non-resizable", state.maximized || state.fullscreen);
    back.disabled = !state.canGoBack;
    forward.disabled = !state.canGoForward;
    menuButtons.forEach((button, index) => {
      button.disabled = !state.menuReady;
      if (state.menuLabels?.[index]) button.textContent = state.menuLabels[index];
    });
    if (!state.menuReady) { openMenuId = null; reflectMenu(); }
    maximize.setAttribute("aria-label", state.maximized ? "还原" : "最大化");
    maximize.innerHTML = state.maximized
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="4" y="2" width="6" height="6" /><path d="M8 8v2H2V4h2" /></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg>';
  };
  const action = (name) => api.core.invoke("desktop_window_action", { action: name })
    .then((state) => {
      // Navigation state arrives from the content view after it applies the
      // visit. Its async update must not be overwritten by this older reply.
      if (name !== "back" && name !== "forward") applyState(state);
    })
    .catch((error) => console.error("Window control failed:", error));
  document.getElementById("minimize").addEventListener("click", () => action("minimize"));
  maximize.addEventListener("click", () => action("maximize"));
  document.getElementById("close").addEventListener("click", () => action("close"));
  back.addEventListener("click", () => action("back"));
  forward.addEventListener("click", () => action("forward"));
  menuButtons.forEach((button, index) => {
    // Preserve the content view's input focus and selection until the popup
    // opens there. The caption itself must never receive an edit operation.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => openMenu(openMenuId === menuIds[index] ? null : menuIds[index]));
    button.addEventListener("mouseenter", () => {
      if (openMenuId && openMenuId !== menuIds[index]) openMenu(menuIds[index]);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = (index + (event.key === "ArrowLeft" ? 3 : 1)) % menuIds.length;
        menuButtons[next].focus(); openMenu(menuIds[next]);
      } else if (event.key === "ArrowDown") { event.preventDefault(); openMenu(menuIds[index]); }
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenuId) { event.preventDefault(); openMenu(null); return; }
    if (event.key === "F10") { event.preventDefault(); openMenu("file"); return; }
    let command = null;
    const key = event.key.toLowerCase();
    if (!event.metaKey && event.ctrlKey) {
      if (event.altKey) command = key === "n" && !event.shiftKey ? "new-task" : null;
      else if (key === "b") command = event.shiftKey ? "toggle-files" : "toggle-sidebar";
      else if (key === "," && !event.shiftKey) command = "settings";
      else if (key === "+" || key === "=") command = "zoom-in";
      else if (key === "-" || key === "_") command = "zoom-out";
      else if (key === "0" && !event.shiftKey) command = "zoom-reset";
      else command = { z: event.shiftKey ? "redo" : "undo", y: "redo", x: "cut", c: "copy", v: "paste", a: "select-all" }[key] ?? null;
    } else if (key === "f11" && !event.altKey && !event.shiftKey && !event.metaKey) command = "fullscreen";
    if (!command) return;
    event.preventDefault();
    void api.core.invoke("desktop_dispatch_menu_action", { command }).catch(console.error);
  });
  const dragRegion = document.getElementById("drag-region");
  // The caption WebView covers the native top sizing border. Forward only
  // presses in this narrow strip to Windows' native resize loop.
  document.querySelectorAll("[data-resize-direction]").forEach((region) => {
    region.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || document.documentElement.classList.contains("non-resizable")) return;
      event.preventDefault();
      event.stopPropagation();
      void api.window.getCurrentWindow().startResizeDragging(region.dataset.resizeDirection)
        .catch((error) => console.error("Window resize failed:", error));
    });
  });
  dragRegion.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    // Windows' native drag loop consumes mouse events; handle double-clicks
    // here before entering the drag loop, rather than waiting for dblclick.
    action(event.detail === 2 ? "maximize" : "drag");
  });
  document.querySelector(".brand").addEventListener("mousedown", (event) => {
    if (event.button === 0) action(event.detail === 2 ? "maximize" : "drag");
  });
  systemTheme.addEventListener("change", syncTheme);
  syncTheme();
  void api.event.listen("desktop-menu-closed", (event) => {
    if (event.payload === openMenuId) { openMenuId = null; reflectMenu(); }
  }).catch(console.error);
  void api.event.listen("desktop-menu-cycle", (event) => {
    const current = menuIds.indexOf(openMenuId);
    const next = event.payload === 0 ? 0 : (Math.max(current, 0) + (event.payload < 0 ? 3 : 1)) % menuIds.length;
    openMenu(menuIds[next]);
  }).catch(console.error);
  // Show the window only once these local controls have registered.
  api.event.listen("desktop-frame-state", (event) => applyState(event.payload))
    .then(() => action("ready"))
    .catch((error) => {
      console.error("Window-state listener failed:", error);
      void action("ready");
    });
})();
