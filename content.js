(() => {
  let enabled = false;
  let panel;
  let selectionTimer;
  let pointerDown = false;
  let lastSelection = "";
  let scan = null;
  let scanOperation = 0;
  let readingImage = false;
  const pageWords = [];

  function scanState(active) {
    chrome.runtime.sendMessage({ target: "background", type: "scanState", active }).catch(() => {});
  }

  function getPanel() {
    if (!panel) panel = new EasyDicPanel({
      onSaved(text) {
        if (!pageWords.some(word => word.toLowerCase() === text.toLowerCase())) pageWords.push(text);
      },
      onClose() { lastSelection = ""; readingImage = false; clearTimeout(selectionTimer); scanState(false); }
    });
    return panel;
  }

  chrome.storage.local.get("enabled").then(result => {
    enabled = result.enabled !== false;
    scheduleSelection();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      clearTimeout(selectionTimer);
      lastSelection = "";
      if (!readingImage && !scan) panel?.close();
    }
  });

  function editable(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    return !!element && (element.isContentEditable || !!element.closest("input,textarea,select,[contenteditable]"));
  }
  function selectedText() {
    if (editable(document.activeElement)) return "";
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || editable(selection.anchorNode) || editable(selection.focusNode)) return "";
    return selection.toString().replace(/\s+/gu, " ").trim();
  }
  function scheduleSelection() {
    clearTimeout(selectionTimer);
    if (!enabled || scan || readingImage || pointerDown || document.activeElement === panel?.host) return;
    const text = selectedText();
    if (!text || text === lastSelection) return;
    panel?.cancel();
    selectionTimer = setTimeout(() => {
      if (!enabled || pointerDown || scan || selectedText() !== text) return;
      lastSelection = text;
      getPanel().translate(text);
    }, 350);
  }
  document.addEventListener("pointerdown", event => {
    if (panel?.contains(event) || scan) return;
    const dismissedSelection = selectedText();
    if (readingImage) cancelScan();
    else panel?.close();
    // An outside click may preserve the selection (for example, a page control
    // that prevents focus changes). Do not reopen it on the matching pointerup.
    // A fresh selection clears this baseline through selectionchange below.
    lastSelection = dismissedSelection;
    pointerDown = true;
    clearTimeout(selectionTimer);
  }, true);
  document.addEventListener("pointerup", event => {
    pointerDown = false;
    if (!panel?.contains(event)) scheduleSelection();
  }, true);
  document.addEventListener("pointercancel", () => { pointerDown = false; }, true);
  document.addEventListener("selectionchange", () => {
    if (!enabled || scan || document.activeElement === panel?.host) return;
    const text = selectedText();
    if (readingImage && text && text !== lastSelection) cancelScan();
    if (!text) lastSelection = "";
    else if (text !== lastSelection) panel?.cancel();
    scheduleSelection();
  });
  document.addEventListener("keyup", event => {
    if (!panel?.contains(event) && event.key !== "Escape") scheduleSelection();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      clearTimeout(selectionTimer);
      cancelScan();
      panel?.close();
      lastSelection = selectedText();
    }
  }, true);

  function cancelScan() {
    scanState(false);
    scanOperation++;
    scan?.host.remove();
    scan = null;
    pointerDown = false;
    if (readingImage) { readingImage = false; panel?.close(); }
  }

  function beginScan() {
    cancelScan();
    clearTimeout(selectionTimer);
    panel?.close();
    const host = document.createElement("div");
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;";
    host.setAttribute("data-easydic-scan", "");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host{color-scheme:light} .overlay{position:fixed;inset:0;cursor:crosshair;touch-action:none;user-select:none;background:#10233b18}
      .hint{position:absolute;top:18px;left:50%;transform:translateX(-50%);font:14px/1.5 system-ui,sans-serif;color:#fff;background:#17334d;padding:10px 18px;border-radius:10px;pointer-events:none;text-align:center}
      .box{position:absolute;border:2px solid #1769e0;background:#5a9efc20;box-sizing:border-box;pointer-events:none}
    </style><div class="overlay"><div class="hint" role="status">Drag a box around English text · Escape to cancel</div><div class="box" hidden></div></div>`;
    const overlay = shadow.querySelector(".overlay");
    const box = shadow.querySelector(".box");
    const state = { host, start: null, rect: null, id: ++scanOperation };
    scan = state;
    scanState(true);
    document.documentElement.append(host);
    const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
    overlay.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      state.start = point(event);
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener("pointermove", event => {
      if (!state.start) return;
      const end = point(event);
      state.rect = { x: Math.min(state.start.x, end.x), y: Math.min(state.start.y, end.y), width: Math.abs(end.x - state.start.x), height: Math.abs(end.y - state.start.y) };
      box.hidden = false;
      Object.assign(box.style, { left: `${state.rect.x}px`, top: `${state.rect.y}px`, width: `${state.rect.width}px`, height: `${state.rect.height}px` });
    });
    overlay.addEventListener("pointerup", async event => {
      event.preventDefault();
      if (!state.start || scan !== state) return;
      const end = point(event);
      state.rect = { x: Math.min(state.start.x, end.x), y: Math.min(state.start.y, end.y), width: Math.abs(end.x - state.start.x), height: Math.abs(end.y - state.start.y) };
      if (state.rect.width < 8 || state.rect.height < 8) {
        shadow.querySelector(".hint").textContent = "Draw a larger box around the text · Escape to cancel";
        state.start = null;
        return;
      }
      host.remove();
      scan = null;
      readingImage = true;
      // Let removal paint before asking the background to capture the viewport.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (scanOperation !== state.id || document.hidden) return;
      await getPanel().readImage(state.rect, { width: innerWidth, height: innerHeight });
      if (scanOperation === state.id) { readingImage = false; scanState(false); }
      lastSelection = selectedText();
    });
  }

  for (const name of ["scroll", "resize"]) window.addEventListener(name, () => {
    if (scan || readingImage) cancelScan();
  }, true);
  document.addEventListener("visibilitychange", () => {
    pointerDown = false;
    if (document.hidden && (scan || readingImage)) cancelScan();
  });
  window.addEventListener("pagehide", () => { cancelScan(); panel?.cancel(); });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "getTemporaryWords") respond({ words: [...pageWords] });
    if (message?.type === "canScan") respond({ ok: true });
    if (message?.type === "showTranslation") {
      cancelScan();
      clearTimeout(selectionTimer);
      lastSelection = selectedText();
      getPanel().translate(message.text);
      respond({ ok: true });
    }
    if (message?.type === "beginScan") { beginScan(); respond({ ok: true }); }
    if (message?.type === "cancelScan") { cancelScan(); respond({ ok: true }); }
    if (message?.type === "captureComplete" && readingImage && panel?.operation === message.id) panel.captureComplete();
  });
})();
