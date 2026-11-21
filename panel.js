// Shared rendering for the article overlay and the toolbar's inline results.
(() => {
  const normalize = value => typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  const styles = `
    :host { color-scheme:light dark; } * { box-sizing:border-box; } [hidden] { display:none!important; }
    section { --ink:#203047; --muted:#63738a; --line:#e2e8f0; --surface:#fff; --soft:#f5f8fc; --accent:#2463d4;
      font:14px/1.6 system-ui,"Noto Sans Bengali",sans-serif; text-align:left; color:var(--ink); color-scheme:light dark;
      background:var(--surface); border:1px solid var(--line); border-radius:16px; box-shadow:0 12px 40px #102b4526; overflow:hidden; }
    header { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:8px; } .brand-mark { color:var(--accent); font-size:18px; } strong { font-size:14px; letter-spacing:-.02em; }
    .header-actions { display:flex; gap:12px; } .body { padding:20px; max-height:calc(75vh - 76px); overflow:auto; overscroll-behavior:contain; }
    .label { font-size:11px; font-weight:650; color:var(--muted); margin:0 0 10px; letter-spacing:.04em; }
    .source-row { display:flex; align-items:flex-start; gap:6px; } .source-row .source { flex:1; min-width:0; }
    .speaker { flex:none; width:30px; min-height:30px; padding:5px!important; display:grid; place-items:center; background:transparent; }
    .source { font-size:13px; color:var(--muted); margin:0 0 24px; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    .translation { font-size:20px; line-height:1.8; margin:0 0 24px; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    .status,.speech-status { font-size:12px; color:var(--muted); margin:8px 0; white-space:pre-wrap; } .status:empty,.speech-status:empty { display:none; } .status.error,.speech-status.error { color:#ad332a; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; }
    button { font:inherit; font-size:13px; font-weight:600; line-height:1.4; min-height:40px; padding:10px 16px; border:1px solid var(--line); border-radius:8px; color:var(--ink); background:var(--soft); cursor:pointer; }
    button:hover:not(:disabled) { background:#eaf0fb; } button:disabled { opacity:.55; cursor:default; }
    button:focus-visible,textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .icon { width:40px; height:40px; padding:0; display:grid; place-items:center; color:var(--muted); background:transparent; border:0; font-size:16px; }
    .close { font-size:23px; font-weight:400; } .primary { color:#fff; background:var(--accent); border-color:var(--accent); }
    .primary:hover:not(:disabled) { background:#1b51b4; } .save.saved { color:#226344; background:#edf7f1; border-color:#d3e8db; opacity:1; }
    textarea { width:100%; min-height:90px; resize:vertical; font:inherit; font-size:13px; padding:10px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); }
    footer { display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid var(--line); font-size:11px; color:var(--muted); }
    .announcement { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); }
    section.inline { box-shadow:none; border:0; border-radius:14px; }
    .inline .body { max-height:none; padding:16px; }
    .inline .source { font-size:12px; margin-bottom:12px; }
    .inline .label { margin-bottom:8px; }
    .inline .translation { font-size:19px; line-height:1.6; margin-bottom:12px; }
    .inline .actions { gap:8px; margin-top:12px; }
    .inline button { padding:10px 12px; max-width:100%; }
    .inline .status,.inline .speech-status { overflow-wrap:anywhere; }
    .inline footer { margin-top:12px; padding-top:12px; font-size:10px; overflow-wrap:anywhere; }
    @media(prefers-color-scheme:dark) {
      section { --ink:#e4edf7; --muted:#a8b7cb; --line:#364558; --surface:#202b3a; --soft:#293649; --accent:#3978e3; }
      button:hover:not(:disabled) { background:#354962; } .status.error,.speech-status.error { color:#ffb4ab; }
      .save.saved { color:#abe2c2; background:#213e34; border-color:#345848; }
    }`;

  class TranslationPanel {
    constructor({ mount = document.documentElement, inline = false, onSaved = () => {}, onClose = () => {} } = {}) {
      this.onSaved = onSaved;
      this.onClose = onClose;
      this.inline = inline;
      this.mount = mount;
      this.operation = null;
      this.pending = false;
      this.text = "";
      this.translation = "";
      this.ocr = false;
      this.showSource = true;
      this.savedKeys = new Set();
      this.savingKeys = new Set();
      this.storageRevision = 0;
      this.host = document.createElement("div");
      this.host.setAttribute("data-easydic-panel", inline ? mount.id : "page");
      const properties = inline
        ? "all:initial;display:block;width:100%;"
        : "all:initial;display:block;position:fixed;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);z-index:2147483647;";
      this.host.style.cssText = properties.split(";").filter(Boolean).map(v => `${v} !important`).join(";");
      this.shadow = this.host.attachShadow({ mode: "closed" });
      // All source, provider, and storage strings are rendered as text, never HTML.
      this.shadow.innerHTML = `<style>${styles}</style><section class="${inline ? "inline" : "floating"}" role="region" aria-label="Bangla translation">
        <header ${inline ? "hidden" : ""}><div class="brand"><span class="brand-mark" aria-hidden="true">অ</span><strong>EasyDic</strong></div><div class="header-actions">
          <button class="close icon" aria-label="Close translation" title="Close (Escape)">×</button></div></header>
        <div class="body"><div class="source-block"><p class="label">English</p><div class="source-row"><p class="source"></p><button class="speaker" type="button" disabled></button></div></div>
          <div class="editor" hidden><textarea aria-label="Correct extracted English text" maxlength="10000"></textarea><div class="actions"><button class="again">Translate again</button></div></div>
          <p class="label result-label" hidden>বাংলা</p><p class="translation" lang="bn" hidden></p>
          <p class="speech-status error" role="status" aria-live="polite"></p>
          <p class="status" role="status" aria-live="polite"></p>
          <div class="actions"><button class="save primary" disabled>Save</button><button class="edit" hidden>Edit text</button><button class="retry" hidden>Retry</button></div>
          <footer><span>Translated with MyMemory</span></footer>
          <span class="announcement" role="status" aria-live="polite"></span>
        </div></section>`;
      this.el = Object.fromEntries(["close", "source", "source-block", "editor", "again", "translation", "result-label", "status", "save", "edit", "retry", "announcement"].map(name => [name, this.shadow.querySelector(`.${name}`)]));
      this.speaker = new EasyDicSpeaker(this.shadow.querySelector(".speaker"), () => this.text, this.shadow.querySelector(".speech-status"));
      EasyDicState.subscribe(enabled => { if (!enabled) this.close(); });
      this.editor = this.shadow.querySelector("textarea");
      this.el.close.onclick = () => this.close();
      this.el.retry.onclick = () => this.translate(this.text, { ocr: this.ocr, showSource: this.showSource });
      this.el.edit.onclick = () => {
        this.editor.value = this.text;
        this.el.editor.hidden = !this.el.editor.hidden;
        if (!this.el.editor.hidden) this.editor.focus({ preventScroll: true });
      };
      this.el.again.onclick = () => this.translate(this.editor.value, { ocr: true });
      this.el.save.onclick = () => this.save();
      if (!inline) this.host.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.stopPropagation(); this.close(); }
      });
      this.storageListener = (changes, area) => {
        if (area === "local" && changes.savedWords) {
          this.storageRevision++;
          this.updateSaved(changes.savedWords.newValue);
        }
      };
      chrome.storage.onChanged.addListener(this.storageListener);
      const revision = this.storageRevision;
      chrome.storage.local.get("savedWords").then(({ savedWords }) => {
        if (this.storageRevision === revision) this.updateSaved(savedWords);
      }).catch(() => {});
      mount.append(this.host);
      this.hide();
    }

    contains(event) { return event.composedPath().includes(this.host); }
    show() { if (this.inline) this.mount.hidden = false; this.host.style.setProperty("display", "block", "important"); }
    hide() { if (this.inline) this.mount.hidden = true; this.host.style.setProperty("display", "none", "important"); }
    status(message, error = false) {
      this.el.status.textContent = message;
      this.el.status.classList.toggle("error", error);
    }
    announce(message) { this.el.announcement.textContent = message; }
    updateSaved(words) {
      this.savedKeys = new Set((Array.isArray(words) ? words : []).map(normalize).filter(Boolean).map(text => text.toLowerCase()));
      this.updateSaveButton();
    }
    updateSaveButton() {
      const key = this.text.toLowerCase();
      const saving = this.savingKeys.has(key);
      const saved = this.savedKeys.has(key);
      this.el.save.textContent = saving ? "Saving…" : saved ? "Saved ✓" : "Save";
      this.el.save.classList.toggle("saved", saved && !saving);
      this.el.save.disabled = !key || [...this.text].length > 2000 || saving || saved;
    }
    async send(message) {
      const result = await chrome.runtime.sendMessage({ target: "background", ...message });
      if (!result?.ok) throw new Error(result?.error || "Could not complete the request. Reload EasyDic and refresh the page.");
      return result;
    }
    cancel() {
      this.speaker.stop();
      if (this.operation && this.pending) this.send({ type: "cancel", id: this.operation }).catch(() => {});
      this.operation = null;
      this.pending = false;
    }
    close() { this.cancel(); this.hide(); this.onClose(); }
    begin(text, ocr) {
      this.cancel();
      this.operation = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("-");
      this.text = text;
      this.ocr = ocr;
      this.translation = "";
      this.el.source.textContent = text;
      this.shadow.querySelector(".speech-status").textContent = "";
      this.speaker.update();
      this.el.translation.textContent = "";
      this.el.translation.hidden = this.el["result-label"].hidden = true;
      this.el.editor.hidden = true;
      this.el.edit.hidden = !ocr || !text;
      this.el.retry.hidden = true;
      this.announce("");
      this.updateSaveButton();
      this.show();
      return this.operation;
    }
    async translate(value, { ocr = false, showSource = true } = {}) {
      if (!EasyDicState.enabled) return;
      this.showSource = !this.inline || showSource;
      this.el["source-block"].hidden = !this.showSource;
      const text = normalize(value);
      if (this.pending && this.operation && this.text === text && this.ocr === ocr) return;
      const op = this.begin(text, ocr);
      if (!text || [...text].length > 2000) {
        this.status(text ? "Select less text — the limit is 2,000 characters." : "No text found. Try a clearer image or edit the text.", true);
        return;
      }
      this.pending = true;
      this.status("Translating…");
      try {
        const result = await this.send({ type: "translate", id: op, text });
        if (this.operation !== op) return;
        this.translation = result.translation;
        this.el.translation.textContent = result.translation;
        this.el.translation.hidden = this.el["result-label"].hidden = false;
        this.status("");
        this.announce("Translation ready.");
      } catch (error) {
        if (this.operation !== op) return;
        this.status(error.message, true);
        this.el.retry.hidden = false;
      } finally {
        if (this.operation === op) this.pending = false;
      }
    }
    async readImage(rect, viewport) {
      if (!EasyDicState.enabled) return;
      const op = this.begin("", true);
      this.pending = true;
      this.hide();
      try {
        const result = await this.send({ type: "readImage", id: op, rect, viewport });
        if (this.operation !== op) return;
        await this.translate(result.text, { ocr: true });
      } catch (error) {
        if (this.operation !== op) return;
        this.pending = false;
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
      const key = text.toLowerCase();
      const op = this.operation;
      if (this.el.save.disabled || this.savingKeys.has(key)) return;
      this.savingKeys.add(key);
      this.updateSaveButton();
      this.announce("Saving…");
      if (this.el.status.textContent.startsWith("Could not save.")) this.status("");
      try {
        await this.send({ type: "saveWords", words: [text] });
        this.savedKeys.add(key);
        this.onSaved(text);
        if (this.operation === op) this.announce("Saved to your library.");
      } catch (error) {
        if (this.operation === op) this.status(`Could not save. ${error.message}`, true);
      } finally {
        this.savingKeys.delete(key);
        this.updateSaveButton();
      }
    }
  }
  globalThis.EasyDicPanel = TranslationPanel;
})();
