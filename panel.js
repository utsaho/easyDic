// Shared by the content script and the protected-page popup fallback.
(() => {
  const styles = `
    :host { color-scheme:light dark; font:14px/1.6 system-ui,"Noto Sans Bengali",sans-serif; color:#17283d; text-align:left; }
    * { box-sizing:border-box; } [hidden] { display:none !important; }
    section { font:14px/1.6 system-ui,"Noto Sans Bengali",sans-serif; color:#17283d; text-align:left; color-scheme:light dark; background:#fff; border:1px solid #c8d6e5; border-radius:16px; box-shadow:0 12px 40px #102b4530; overflow:hidden; }
    header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e3e9f0; }
    strong { font-size:15px; } .badge { color:#60758b; font-size:11px; margin-left:8px; }
    .body { padding:14px 16px; max-height:calc(70vh - 60px); overflow:auto; overscroll-behavior:contain; }
    .label { font-size:11px; color:#60758b; text-transform:uppercase; letter-spacing:.07em; margin:0 0 4px; }
    .source { font-size:13px; margin:0 0 14px; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    .translation { color:#103e31; font-size:18px; line-height:1.8; margin:0 0 14px; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    .status { font-size:12px; color:#526b84; margin:8px 0; white-space:pre-wrap; }
    .status.error { color:#aa302c; }
    .actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    button { font:inherit; font-size:12px; line-height:1.4; padding:7px 10px; border:1px solid #bdcddd; border-radius:7px; color:#1d466f; background:#f7faff; cursor:pointer; }
    button:hover { background:#e8f1fc; } button:disabled { opacity:.5; cursor:default; }
    button:focus-visible,textarea:focus-visible { outline:2px solid #2475d9; outline-offset:2px; }
    .close { font-size:20px; padding:0 8px; background:transparent; border:0; }
    .primary { color:#fff; background:#1769d2; border-color:#1769d2; } .primary:hover { background:#1257b2; }
    textarea { width:100%; min-height:90px; resize:vertical; font:inherit; font-size:13px; padding:8px; border:1px solid #a8bed4; border-radius:7px; background:#fff; color:#17283d; }
    footer { margin-top:13px; font-size:10px; color:#60758b; }
    @media(prefers-color-scheme:dark) {
      :host { color:#e4edf7; } section { color:#e4edf7; background:#202b39; border-color:#43556a; }
      header { border-color:#43556a; } .label,.badge,footer,.status { color:#acbfd4; }
      .translation { color:#b8ebd6; } .status.error { color:#ffb4ab; }
      button { background:#2b3a4e; color:#e1edfc; border-color:#637b96; } button:hover { background:#354c68; }
      .primary { background:#1769d2; } textarea { background:#192331; color:#e4edf7; }
    }`;

  class TranslationPanel {
    constructor({ mount = document.documentElement, inline = false, onSaved = () => {}, onClose = () => {} } = {}) {
      this.onSaved = onSaved;
      this.onClose = onClose;
      this.operation = null;
      this.text = "";
      this.translation = "";
      this.ocr = false;
      this.host = document.createElement("div");
      this.host.setAttribute("data-easydic-panel", "");
      const properties = inline
        ? "all:initial;display:block;margin-top:14px;width:100%;"
        : "all:initial;display:block;position:fixed;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);z-index:2147483647;";
      this.host.style.cssText = properties.split(";").filter(Boolean).map(v => `${v} !important`).join(";");
      this.shadow = this.host.attachShadow({ mode: "closed" });
      // Variable text is always assigned with textContent/value below.
      this.shadow.innerHTML = `<style>${styles}</style><section role="region" aria-label="EasyDic translation">
        <header><div><strong>EasyDic</strong><span class="badge">English → বাংলা</span></div><button class="close" aria-label="Close translation" title="Close (Escape)">×</button></header>
        <div class="body"><p class="label">Selected text</p><p class="source"></p>
          <div class="editor" hidden><textarea aria-label="Correct extracted English text" maxlength="10000"></textarea><div class="actions"><button class="again">Translate again</button></div></div>
          <p class="label result-label" hidden>Bangla translation</p><p class="translation" lang="bn" hidden></p>
          <p class="status" role="status" aria-live="polite"></p>
          <div class="actions"><button class="save primary" disabled>Save</button><button class="copy" disabled>Copy translation</button><button class="edit" hidden>Edit text</button><button class="retry" hidden>Retry</button></div>
          <footer>Translation: MyMemory · Selected text is sent online.<br>Free allowance: 5,000 characters/day. Image reading stays on your device.</footer>
        </div></section>`;
      this.el = Object.fromEntries(["close", "source", "editor", "again", "translation", "result-label", "status", "save", "copy", "edit", "retry"].map(name => [name, this.shadow.querySelector(`.${name}`)]));
      this.editor = this.shadow.querySelector("textarea");
      this.el.close.onclick = () => this.close();
      this.el.retry.onclick = () => this.translate(this.text, { ocr: this.ocr });
      this.el.edit.onclick = () => {
        this.editor.value = this.text;
        this.el.editor.hidden = !this.el.editor.hidden;
        if (!this.el.editor.hidden) this.editor.focus({ preventScroll: true });
      };
      this.el.again.onclick = () => this.translate(this.editor.value, { ocr: true });
      this.el.save.onclick = () => this.save();
      this.el.copy.onclick = async () => {
        const op = this.operation;
        try {
          await navigator.clipboard.writeText(this.translation);
          if (this.operation === op) this.status("Translation copied.");
        } catch {
          if (this.operation === op) this.status("Copy is unavailable here. Select the translation and copy it manually.", true);
        }
      };
      this.host.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.stopPropagation(); this.close(); }
      });
      mount.append(this.host);
      this.hide();
    }

    contains(event) { return event.composedPath().includes(this.host); }
    show() { this.host.style.setProperty("display", "block", "important"); }
    hide() { this.host.style.setProperty("display", "none", "important"); }
    status(message, error = false) {
      this.el.status.textContent = message;
      this.el.status.classList.toggle("error", error);
    }
    async send(message) {
      const result = await chrome.runtime.sendMessage({ target: "background", ...message });
      if (!result?.ok) throw new Error(result?.error || "EasyDic could not complete the request. Reload the extension and refresh this page.");
      return result;
    }
    cancel() {
      if (this.operation) this.send({ type: "cancel", id: this.operation }).catch(() => {});
      this.operation = null;
    }
    close() { this.cancel(); this.hide(); this.onClose(); }
    begin(text, ocr) {
      this.cancel();
      this.operation = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("-");
      this.text = text;
      this.ocr = ocr;
      this.translation = "";
      this.el.source.textContent = text;
      this.el.translation.textContent = "";
      this.el.translation.hidden = this.el["result-label"].hidden = true;
      this.el.editor.hidden = true;
      this.el.edit.hidden = !ocr || !text;
      this.el.retry.hidden = true;
      this.el.save.disabled = this.el.copy.disabled = true;
      this.el.save.textContent = "Save";
      this.show();
      return this.operation;
    }
    async translate(value, { ocr = false } = {}) {
      const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
      const op = this.begin(text, ocr);
      if (!text || [...text].length > 2000) {
        this.status(text ? "Select less text — the limit is 2,000 characters." : "No text found. Try a clearer image or edit the extracted text.", true);
        return;
      }
      this.el.save.disabled = false;
      this.status("Translating…");
      try {
        const result = await this.send({ type: "translate", id: op, text });
        if (this.operation !== op) return;
        this.translation = result.translation;
        this.el.translation.textContent = result.translation;
        this.el.translation.hidden = this.el["result-label"].hidden = false;
        this.el.copy.disabled = false;
        this.status(ocr ? "Read from image. Use Edit text if recognition needs a correction." : "");
      } catch (error) {
        if (this.operation !== op) return;
        this.status(error.message, true);
        this.el.retry.hidden = false;
      }
    }
    async readImage(rect, viewport) {
      const op = this.begin("", true);
      this.hide();
      try {
        const result = await this.send({ type: "readImage", id: op, rect, viewport });
        if (this.operation !== op) return;
        await this.translate(result.text, { ocr: true });
      } catch (error) {
        if (this.operation !== op) return;
        this.show();
        this.status(`${error.message} Use Scan area to try again.`, true);
      }
    }
    captureComplete() {
      if (!this.operation || !this.ocr) return;
      this.show();
      this.status("Reading image…");
    }
    async save() {
      const text = this.text;
      const op = this.operation;
      this.el.save.disabled = true;
      try {
        await this.send({ type: "saveWords", words: [text] });
        this.onSaved(text);
        if (this.operation === op) { this.el.save.textContent = "Saved"; this.status("Saved to your vocabulary library."); }
      } catch (error) {
        if (this.operation === op) { this.el.save.disabled = false; this.status(error.message, true); }
      }
    }
  }
  globalThis.EasyDicPanel = TranslationPanel;
})();
