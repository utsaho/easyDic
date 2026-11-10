import { mergeWords } from "./translation.js";

const enabledInput = document.getElementById("enabled");
const dictionarySearchForm = document.getElementById("dictionary-search-form");
const dictionarySearchInput = document.getElementById("dictionary-search-input");
const dictionarySearchButton = document.getElementById("dictionary-search-button");
const flashcardsTitle = document.getElementById("flashcards-title");
const wordCard = document.getElementById("word-card");
const wordPosition = document.getElementById("word-position");
const loadButton = document.getElementById("load-words");
const removeButton = document.getElementById("remove-words");
const searchButton = document.getElementById("search-word");
const saveButton = document.getElementById("save-words");
const actionStatus = document.getElementById("action-status");
const previousButton = document.getElementById("previous-word");
const randomButton = document.getElementById("random-word");
const nextButton = document.getElementById("next-word");
let words = [];
let currentWordIndex = 0;
let isWorking = true;
let deckSource = "page";
let fallbackPanel;
let popupRequest = 0;

async function background(message) {
  const result = await chrome.runtime.sendMessage({ target: "background", ...message });
  if (!result?.ok) throw new Error(result?.error || "EasyDic could not complete the request.");
  return result;
}

document.getElementById("scan-area").addEventListener("click", () => {
  const button = document.getElementById("scan-area");
  button.disabled = true;
  try {
    const port = chrome.runtime.connect({ name: "scan-area" });
    port.onMessage.addListener(result => {
      if (result.ok) { window.close(); return; }
      actionStatus.classList.add("error");
      actionStatus.textContent = result.error;
      button.disabled = false;
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        actionStatus.classList.add("error");
        actionStatus.textContent = "Could not start scanning. Reload EasyDic and refresh the page.";
      }
      button.disabled = false;
    });
    port.postMessage({ type: "prepare" });
  } catch (error) {
    button.disabled = false;
    actionStatus.classList.add("error");
    actionStatus.textContent = error.message;
  }
});

chrome.storage.local.get("enabled").then(({ enabled }) => updateUi(enabled !== false)).catch(() => {
  actionStatus.textContent = "Could not read your translation preference.";
});
updateFlashcard();
loadTemporaryWords();

enabledInput.addEventListener("change", async () => {
  const enabled = enabledInput.checked;
  try { await chrome.storage.local.set({ enabled }); }
  catch { updateUi(!enabled); actionStatus.textContent = "Could not save your translation preference."; }
});

function updateUi(enabled) {
  enabledInput.checked = enabled;
}

dictionarySearchInput.addEventListener("input", () => {
  dictionarySearchButton.disabled = !dictionarySearchInput.value.trim();
});

dictionarySearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const searchText = dictionarySearchInput.value.trim();
  if (!searchText) return;
  openTranslation(searchText);
});

searchButton.addEventListener("click", () => {
  if (!words.length) return;
  openTranslation(words[currentWordIndex]);
});

loadButton.addEventListener("click", async () => {
  if (isWorking) return;

  isWorking = true;
  actionStatus.classList.remove("error");
  actionStatus.textContent = "Loading...";
  updateFlashcard();

  try {
    const { savedWords } = await chrome.storage.local.get("savedWords");
    const storedWords = mergeWords([], savedWords);

    if (!storedWords.length) {
      actionStatus.textContent = "No saved words yet";
      return;
    }

    words = storedWords;
    currentWordIndex = 0;
    deckSource = "saved";
    flashcardsTitle.textContent = "Saved words";
    actionStatus.textContent = `Loaded ${words.length} ${words.length === 1 ? "word" : "words"}`;
  } catch (error) {
    console.error("Unable to load the saved words", error);
    actionStatus.classList.add("error");
    actionStatus.textContent = "Could not load saved words";
  } finally {
    isWorking = false;
    updateFlashcard();
  }
});

removeButton.addEventListener("click", async () => {
  if (isWorking) return;
  if (!window.confirm("Clear all saved words? This cannot be undone.")) return;

  isWorking = true;
  actionStatus.classList.remove("error");
  actionStatus.textContent = "Clearing...";
  updateFlashcard();

  try {
    await background({ type: "clearWords" });

    if (deckSource === "saved") {
      words = [];
      currentWordIndex = 0;
    }

    actionStatus.textContent = "Saved words cleared";
  } catch (error) {
    console.error("Unable to clear the saved words", error);
    actionStatus.classList.add("error");
    actionStatus.textContent = "Could not clear saved words";
  } finally {
    isWorking = false;
    updateFlashcard();
  }
});

saveButton.addEventListener("click", async () => {
  if (!words.length || isWorking) return;

  isWorking = true;
  actionStatus.classList.remove("error");
  actionStatus.textContent = "Saving...";
  updateFlashcard();

  try {
    const { words: mergedWords } = await background({ type: "saveWords", words });
    actionStatus.textContent = `Saved ${mergedWords.length} ${mergedWords.length === 1 ? "word" : "words"}`;
  } catch (error) {
    console.error("Unable to save the words", error);
    actionStatus.classList.add("error");
    actionStatus.textContent = "Could not save words";
  } finally {
    isWorking = false;
    updateFlashcard();
  }
});

previousButton.addEventListener("click", () => {
  if (!words.length) return;
  currentWordIndex = (currentWordIndex - 1 + words.length) % words.length;
  updateFlashcard();
});

randomButton.addEventListener("click", () => {
  if (!words.length) return;

  if (words.length > 1) {
    let randomIndex = Math.floor(Math.random() * (words.length - 1));
    if (randomIndex >= currentWordIndex) randomIndex += 1;
    currentWordIndex = randomIndex;
  }

  updateFlashcard();
});

nextButton.addEventListener("click", () => {
  if (!words.length) return;
  currentWordIndex = (currentWordIndex + 1) % words.length;
  updateFlashcard();
});

async function loadTemporaryWords() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error("No active tab");

    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "getTemporaryWords"
    });
    words = Array.isArray(response?.words) ? response.words : [];
  } catch {
    words = [];
  }

  currentWordIndex = 0;
  deckSource = "page";
  flashcardsTitle.textContent = "Saved from this page";
  isWorking = false;
  updateFlashcard();
}

function updateFlashcard() {
  const hasWords = words.length > 0;
  wordCard.textContent = hasWords ? words[currentWordIndex] : deckSource === "page" ? "Nothing saved from this page yet" : "No saved words yet";
  wordCard.classList.toggle("empty", !hasWords);
  wordPosition.textContent = hasWords
    ? `${currentWordIndex + 1} / ${words.length}`
    : "0 / 0";
  searchButton.disabled = !hasWords;
  loadButton.disabled = isWorking;
  removeButton.disabled = isWorking;
  saveButton.disabled = !hasWords || isWorking;
  previousButton.disabled = !hasWords;
  randomButton.disabled = !hasWords;
  nextButton.disabled = !hasWords;
}

async function openTranslation(text) {
  const request = ++popupRequest;
  fallbackPanel?.close();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active page");
    const result = await chrome.tabs.sendMessage(tab.id, { type: "showTranslation", text }, { frameId: 0 });
    if (!result?.ok) throw new Error("Page unavailable");
    window.close();
  } catch {
    if (request !== popupRequest) return;
    fallbackPanel ||= new EasyDicPanel({ mount: document.getElementById("translation-fallback"), inline: true });
    fallbackPanel.translate(text);
  }
}
