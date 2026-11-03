(() => {
  // The packaged startup origin cannot read the localhost app's localStorage.
  // Rust supplies the saved preference before this document is parsed.
  const saved = window.__EUREKA_DESKTOP_THEME__;
  const preference = saved === "light" || saved === "dark" ? saved : "auto";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const reflect = () => {
    const dark = preference === "dark" || (preference === "auto" && system.matches);
    document.documentElement.dataset.theme = preference;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };
  reflect();
  system.addEventListener("change", reflect);
})();
