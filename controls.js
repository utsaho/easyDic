// Shared preference state in extension pages, content scripts, and the worker.
(() => {
  let enabled = false;
  let revision = 0;
  const listeners = new Set();
  const apply = value => {
    enabled = value !== false;
    for (const listener of listeners) listener(enabled);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.extensionEnabled) return;
    revision++;
    apply(changes.extensionEnabled.newValue);
  });
  const initialRevision = revision;
  const ready = chrome.storage.local.get("extensionEnabled").then(result => {
    if (revision === initialRevision) apply(result.extensionEnabled);
  });
  // Callers report initialization errors; keep features inactive until loaded.
  ready.catch(() => {});
  globalThis.EasyDicState = {
    get enabled() { return enabled; }, ready,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async requireEnabled() {
      await ready;
      if (!enabled) throw new Error("EasyDic is off. Turn it on in the toolbar.");
    }
  };
  if (typeof document === "undefined") return;

  const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
  globalThis.EasyDicSpeaker = class {
    constructor(button, getText, report) {
      this.button = button;
      this.getText = getText;
      this.report = report;
      this.sequence = 0;
      button.innerHTML = icon;
      button.setAttribute("aria-label", "Pronounce English text");
      button.title = "Pronounce English text";
      button.onclick = () => this.speak();
      EasyDicState.subscribe(() => { if (!EasyDicState.enabled) this.stop(); this.update(); });
      this.update();
      window.addEventListener("pagehide", () => this.stop());
    }
    update() {
      const text = this.getText();
      this.button.disabled = !EasyDicState.enabled || !text || [...text].length > 2000;
    }
    stop() {
      this.sequence++;
      this.port?.disconnect();
      this.port = null;
    }
    async speak() {
      this.stop();
      const sequence = this.sequence;
      try {
        await EasyDicState.requireEnabled();
        if (sequence !== this.sequence) return;
        const text = this.getText();
        if (!text || [...text].length > 2000) return;
        this.report("");
        const port = chrome.runtime.connect({ name: "pronunciation" });
        this.port = port;
        port.onMessage.addListener(result => {
          if (this.port !== port) return;
          if (result.error) this.report(result.error);
        });
        port.onDisconnect.addListener(() => {
          const error = chrome.runtime.lastError;
          if (this.port !== port) return;
          this.port = null;
          if (error) this.report("Could not play pronunciation. Reload EasyDic and try again.");
        });
        port.postMessage({ text });
      } catch (error) { if (sequence === this.sequence) this.report(error.message); }
    }
  };
})();
