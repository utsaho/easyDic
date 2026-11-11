import { mergeWords } from "./translation.js";

const byId = id => document.getElementById(id);
const input = byId("dictionary-search-input");
const libraryView = byId("library-view");
const wordCard = byId("word-card");
const translateButton = byId("search-word");
const bulkSave = byId("save-words");
const status = byId("action-status");
let savedWords = [];
let pageWords = [];
let loaded = false;
let libraryBusy = false;
let storageRevision = 0;
const indices = { saved: 0, page: 0 };
let resultPanel;
let resultOrigin;

function setStatus(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}
async function background(message) {
  const result = await chrome.runtime.sendMessage({ target: "background", ...message });
  if (!result?.ok) throw new Error(result?.error || "Could not complete the request.");
  return result;
}
function words() { return libraryView.value === "saved" ? savedWords : pageWords; }
function currentWord() { return words()[indices[libraryView.value]] || ""; }
function renderLibrary() {
  const entries = words();
  indices[libraryView.value] = Math.max(0, Math.min(indices[libraryView.value], entries.length - 1));
  const hasWords = entries.length > 0;
  wordCard.textContent = hasWords ? currentWord() : !loaded ? "Loading your library…" : libraryView.value === "saved" ? "No saved entries yet" : "Nothing saved from this page";
  wordCard.classList.toggle("empty", !hasWords);
  byId("empty-hint").hidden = hasWords || !loaded;
  byId("word-position").textContent = hasWords ? `${indices[libraryView.value] + 1} of ${entries.length}` : "0 of 0";
  for (const id of ["search-word", "previous-word", "next-word", "random-word"]) byId(id).disabled = !hasWords || !loaded;
  bulkSave.hidden = libraryView.value !== "page";
  bulkSave.disabled = !hasWords || libraryBusy;
  byId("remove-words").disabled = !savedWords.length || libraryBusy;
}
function applySaved(value) {
  const previous = currentWord();
  savedWords = mergeWords([], value);
  if (libraryView.value === "saved") {
    const preserved = savedWords.findIndex(text => text.toLowerCase() === previous.toLowerCase());
    indices.saved = preserved >= 0 ? preserved : Math.min(indices.saved, Math.max(0, savedWords.length - 1));
    if (currentWord() !== previous && resultOrigin === "saved") resultPanel?.close();
  }
  loaded = true;
  renderLibrary();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.savedWords) return;
  storageRevision++;
  applySaved(changes.savedWords.newValue);
});
const initialRevision = storageRevision;
chrome.storage.local.get("savedWords").then(({ savedWords: stored }) => {
  if (storageRevision === initialRevision) applySaved(stored);
}).catch(() => {
  loaded = true;
  renderLibrary();
  setStatus(status, "Could not load your library. Close and reopen EasyDic to retry.", true);
});
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "getTemporaryWords" }, { frameId: 0 });
      pageWords = mergeWords([], response?.words);
    }
  } catch { pageWords = []; }
  if (libraryView.value === "page") renderLibrary();
})();
renderLibrary();

async function translate(text, origin) {
  resultOrigin = origin;
  resultPanel ||= new EasyDicPanel({ mount: byId("translation-result"), inline: true });
  const completion = resultPanel.translate(text, { showSource: origin === "typed" });
  const operation = resultPanel.operation;
  resultPanel.host.scrollIntoView({ block: "nearest" });
  await completion;
  if (resultPanel.operation === operation) resultPanel.host.scrollIntoView({ block: "nearest" });
}
libraryView.addEventListener("change", () => {
  resultPanel?.close();
  setStatus(status, "");
  renderLibrary();
});
function moveEntry(direction) {
  const length = words().length;
  if (!length) return;
  resultPanel?.close();
  setStatus(status, "");
  const key = libraryView.value;
  if (direction === "random" && length > 1) {
    let index = Math.floor(Math.random() * (length - 1));
    if (index >= indices[key]) index++;
    indices[key] = index;
  } else if (typeof direction === "number") indices[key] = (indices[key] + direction + length) % length;
  renderLibrary();
}
byId("previous-word").onclick = () => moveEntry(-1);
byId("next-word").onclick = () => moveEntry(1);
byId("random-word").onclick = () => moveEntry("random");
translateButton.onclick = () => {
  if (!currentWord()) return;
  translate(currentWord(), "saved");
};
input.addEventListener("input", () => {
  resultPanel?.close();
  const count = [...input.value].length;
  byId("character-count").textContent = `${count.toLocaleString("en-US")} / 2,000`;
  byId("character-count").classList.toggle("error", count > 2000);
  byId("dictionary-search-button").disabled = !input.value.trim() || count > 2000;
});
byId("dictionary-search-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!input.value.trim() || [...input.value].length > 2000) return;
  translate(input.value, "typed");
});
bulkSave.onclick = async () => {
  if (libraryBusy || !pageWords.length) return;
  libraryBusy = true;
  renderLibrary();
  setStatus(status, "Saving…");
  try {
    await background({ type: "saveWords", words: pageWords });
    setStatus(status, "Page entries saved to your library.");
  } catch (error) { setStatus(status, `Could not save. ${error.message}`, true); }
  finally { libraryBusy = false; renderLibrary(); }
};
byId("remove-words").onclick = async () => {
  if (libraryBusy || !window.confirm("Clear all saved entries? This cannot be undone.")) return;
  libraryBusy = true;
  renderLibrary();
  try {
    await background({ type: "clearWords" });
    setStatus(status, "Library cleared.");
  } catch (error) { setStatus(status, `Could not clear your library. ${error.message}`, true); }
  finally { libraryBusy = false; renderLibrary(); }
};
byId("help-toggle").onclick = () => {
  const expanded = byId("help-panel").hidden;
  byId("help-panel").hidden = !expanded;
  byId("help-toggle").setAttribute("aria-expanded", String(expanded));
};
async function loadShortcut() {
  const bindings = [["scan-area", "shortcut-key", "Translation"], ["capture-area", "scan-shortcut-key", "Scanning"]];
  try {
    const commands = await chrome.commands.getAll();
    const missing = [];
    for (const [name, id, label] of bindings) {
      const shortcut = commands.find(command => command.name === name)?.shortcut;
      byId(id).textContent = shortcut || "Not assigned";
      if (!shortcut) missing.push(label);
    }
    byId("shortcut-notice").hidden = !missing.length;
    byId("shortcut-notice").textContent = missing.length ? `${missing.join(" and ")} shortcut not assigned. Assign it in the extension shortcut settings below.` : "";
  } catch {
    for (const [, id] of bindings) byId(id).textContent = "Unavailable";
    byId("shortcut-notice").hidden = false;
    byId("shortcut-notice").textContent = "Could not read the shortcuts. Assign it in the extension shortcut settings below.";
  }
}
loadShortcut();
window.addEventListener("focus", loadShortcut);
byId("scan-area").onclick = () => {
  const button = byId("scan-area");
  button.disabled = true;
  try {
    const port = chrome.runtime.connect({ name: "scan-area" });
    port.onMessage.addListener(result => {
      if (result.ok) { window.close(); return; }
      setStatus(byId("app-status"), result.error, true);
      button.disabled = false;
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) setStatus(byId("app-status"), "Could not start scanning. Reload EasyDic and refresh the page.", true);
      button.disabled = false;
    });
    port.postMessage({ type: "prepare" });
  } catch (error) {
    button.disabled = false;
    setStatus(byId("app-status"), error.message, true);
  }
};
window.addEventListener("pagehide", () => { resultPanel?.cancel(); });
