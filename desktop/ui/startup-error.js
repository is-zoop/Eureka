const heading = document.getElementById("startup-error");
const retry = document.getElementById("startup-retry");
const status = document.getElementById("startup-status");
const stage = new URL(location.href).searchParams.get("stage");

if (stage === "service") heading.textContent = "Eureka 本地服务未就绪";
if (stage === "page") heading.textContent = "Eureka 页面加载超时";

retry.addEventListener("click", async () => {
  retry.disabled = true;
  status.textContent = "正在重试…";
  try {
    await window.__TAURI_INTERNALS__.invoke("desktop_startup_retry");
  } catch {
    retry.disabled = false;
    status.textContent = "无法开始重试。请从系统托盘退出 Eureka 后重新打开。";
  }
});
