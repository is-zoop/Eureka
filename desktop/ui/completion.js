(() => {
  const { core, event } = window.__TAURI__;
  const card = document.getElementById("card");
  const title = document.getElementById("task-title");
  const summary = document.getElementById("summary");
  const close = document.getElementById("dismiss");
  const form = document.getElementById("reply-form");
  const input = document.getElementById("reply");
  const send = document.getElementById("send");
  const status = document.getElementById("reply-status");
  let cardId;
  let labels;
  let sending = false;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function updateReplyControls() {
    input.readOnly = sending;
    send.disabled = sending || !input.value.trim();
  }

  function render({ id, dark, notification }) {
    cardId = id;
    labels = notification;
    document.documentElement.lang = notification.locale;
    document.documentElement.classList.toggle("dark", dark);
    title.textContent = notification.title;
    summary.textContent = notification.summary;
    close.setAttribute("aria-label", notification.closeLabel);
    input.placeholder = notification.replyPlaceholder;
    input.setAttribute("aria-label", notification.replyPlaceholder);
    send.textContent = notification.sendLabel;
    input.value = "";
    sending = false;
    setStatus("");
    updateReplyControls();
    card.hidden = false;
  }

  async function dismissCard(id) {
    await core.invoke("desktop_completion_dismiss", { id });
    if (cardId !== id) return;
    cardId = undefined;
    card.hidden = true;
  }

  close.addEventListener("click", () => {
    if (cardId !== undefined) void dismissCard(cardId).catch(console.error);
  });

  input.addEventListener("input", () => {
    updateReplyControls();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = cardId;
    const message = input.value.trim();
    if (id === undefined || sending || !message) return;

    sending = true;
    setStatus(labels.sendingLabel);
    updateReplyControls();
    let accepted;
    try {
      accepted = await core.invoke("desktop_completion_reply", { id, message });
    } catch {
      accepted = false;
    }
    if (cardId !== id) return;

    sending = false;
    if (accepted === true) {
      input.value = "";
      setStatus(labels.sentLabel);
      updateReplyControls();
      await dismissCard(id).catch(console.error);
    } else {
      setStatus(accepted === false ? labels.failureLabel : labels.unconfirmedLabel, true);
      updateReplyControls();
    }
  });

  void (async () => {
    await event.listen("desktop-completion-card", ({ payload }) => render(payload));
    await core.invoke("desktop_completion_ready");
  })().catch(console.error);
})();
