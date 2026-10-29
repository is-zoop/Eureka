(() => {
  const api = window.__TAURI__;
  const menu = document.getElementById("tray-menu");
  const recent = document.getElementById("recent-sessions");
  const newTask = document.getElementById("new-task");
  const settings = document.getElementById("settings");
  const tooltip = document.getElementById("tray-tooltip");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = "auto";
  const reflectTheme = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "auto" && media.matches));
  media.addEventListener("change", reflectTheme);
  let tooltipTimer = null;
  let tooltipTarget = null;
  let keyboardNavigation = false;
  const hideTooltip = () => {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
    tooltipTarget?.removeAttribute("aria-describedby");
    tooltipTarget = null;
    tooltip.hidden = true;
    tooltip.textContent = "";
  };
  const queueTooltip = (button) => {
    hideTooltip();
    if (button.scrollWidth <= button.clientWidth) return;
    tooltipTarget = button;
    tooltipTimer = setTimeout(() => {
      if (tooltipTarget !== button || !menu.contains(button)) return;
      tooltip.textContent = button.textContent;
      tooltip.hidden = false;
      const anchor = button.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
      const below = anchor.bottom + 8;
      const preferredTop = below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, Math.min(preferredTop, window.innerHeight - bounds.height - 8))}px`;
      button.setAttribute("aria-describedby", tooltip.id);
    }, 450);
  };
  const perform = (command, sessionId) => {
    hideTooltip();
    return api.core.invoke("desktop_tray_action", { command, sessionId }).catch(console.error);
  };
  const items = () => [...menu.querySelectorAll("button:not(:disabled)")];
  const focusFirst = () => items()[0]?.focus({ preventScroll: true });

  const render = (state) => {
    hideTooltip();
    const focusedId = menu.contains(document.activeElement) ? document.activeElement?.id : null;
    theme = state.theme ?? "auto";
    reflectTheme();
    const rows = state.sessions.slice(0, 3).map((session) => {
      const button = document.createElement("button");
      button.id = `session-${session.id}`;
      button.dataset.slot = "dropdown-menu-item";
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.textContent = session.title;
      button.addEventListener("pointerenter", () => queueTooltip(button));
      button.addEventListener("pointerleave", hideTooltip);
      button.addEventListener("focus", () => { if (keyboardNavigation) queueTooltip(button); });
      button.addEventListener("blur", hideTooltip);
      button.addEventListener("click", () => { void perform("select-session", session.id); });
      return button;
    });
    if (!rows.length) {
      const empty = document.createElement("button");
      empty.dataset.slot = "dropdown-menu-item";
      empty.setAttribute("role", "menuitem");
      empty.tabIndex = -1;
      empty.disabled = true;
      empty.textContent = "暂无最近会话";
      rows.push(empty);
    }
    recent.replaceChildren(...rows);
    newTask.disabled = !state.canCreate;
    settings.disabled = !state.ready;
    if (focusedId) (items().find((item) => item.id === focusedId) ?? items()[0])?.focus({ preventScroll: true });
  };

  for (const command of ["new-task", "open", "settings", "quit"]) {
    document.getElementById(command).addEventListener("click", () => { void perform(command); });
  }
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("pointerdown", (event) => {
    keyboardNavigation = false;
    hideTooltip();
    if (!menu.contains(event.target)) void perform("close");
  });
  window.addEventListener("blur", () => { void perform("close"); });
  document.addEventListener("keydown", (event) => {
    if (["Escape", "Tab"].includes(event.key)) {
      event.preventDefault();
      void perform("close");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    keyboardNavigation = true;
    hideTooltip();
    event.preventDefault();
    const buttons = items();
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  });

  const refresh = async () => { render(await api.core.invoke("desktop_tray_snapshot")); };
  void (async () => {
    await api.event.listen("desktop-tray-state", ({ payload }) => render(payload));
    await api.event.listen("desktop-tray-open", async () => { keyboardNavigation = false; await refresh(); focusFirst(); });
    await refresh();
  })().catch(console.error);
})();
