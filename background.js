import { Translator, mergeWords, validateText } from "./translation.js";

const translator = new Translator({ storage: chrome.storage.session, fetcher: (...args) => fetch(...args) });
const jobs = new Map();
const scanningTabs = new Map();
let libraryQueue = Promise.resolve();
let offscreenCreation;

function owner(sender) {
  return sender.documentId || `${sender.tab?.id ?? "popup"}:${sender.frameId ?? 0}`;
}

function editLibrary(edit) {
  const operation = libraryQueue.catch(() => {}).then(async () => {
    const { savedWords } = await chrome.storage.local.get("savedWords");
    const words = edit(savedWords);
    await chrome.storage.local.set({ savedWords: words });
    return { words };
  });
  libraryQueue = operation;
  return operation;
}

async function ensureOffscreen() {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = (async () => {
    if (!await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html", reasons: ["WORKERS", "BLOBS"],
        justification: "Read selected screenshot text locally with OCR and canvas cropping."
      });
    }
  })().finally(() => { offscreenCreation = null; });
  return offscreenCreation;
}

async function activeSource(sender) {
  if (!sender.tab || sender.frameId !== 0) throw new Error("Scanning is available on ordinary webpages only.");
  const [tab] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
  if (tab?.id !== sender.tab.id) throw new Error("Scan cancelled because the active tab changed.");
  return tab;
}

async function scanTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Open an ordinary webpage to scan text.");
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "canScan" }, { frameId: 0 });
    if (!response?.ok) throw new Error("Page unavailable");
    return tab;
  } catch { throw new Error("Scanning needs an ordinary webpage. Refresh it after reloading EasyDic."); }
}

async function beginTabScan(tab) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) return;
  return chrome.tabs.sendMessage(tab.id, { type: "beginScan" }, { frameId: 0 });
}

// A popup port disconnects when the popup closes. Start the overlay only then,
// after the browser has removed the popup and restored the article viewport.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "scan-area" || port.sender?.id !== chrome.runtime.id ||
      port.sender.url !== chrome.runtime.getURL("popup.html")) return;
  let preparedTab;
  let disconnected = false;
  let preparing = false;
  port.onMessage.addListener(async message => {
    if (message?.type !== "prepare" || preparing) return;
    preparing = true;
    try {
      const tab = await scanTab();
      if (disconnected) return;
      preparedTab = tab;
      port.postMessage({ ok: true });
    } catch (error) {
      if (!disconnected) port.postMessage({ ok: false, error: error.message });
      preparing = false;
    }
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (preparedTab) beginTabScan(preparedTab).catch(() => {});
  });
});

async function readImage(message, sender, signal, id) {
  const { rect, viewport } = message;
  const numbers = [rect?.x, rect?.y, rect?.width, rect?.height, viewport?.width, viewport?.height];
  if (!numbers.every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width < 8 || rect.height < 8 ||
      viewport.width <= 0 || viewport.height <= 0 || rect.x + rect.width > viewport.width + 1 ||
      rect.y + rect.height > viewport.height + 1) throw new Error("Draw a larger box around the text.");
  await activeSource(sender);
  signal.throwIfAborted();
  let screenshot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  await activeSource(sender);
  signal.throwIfAborted();
  await chrome.tabs.sendMessage(sender.tab.id, { type: "captureComplete", id: message.id }, { frameId: 0 });
  await ensureOffscreen();
  signal.throwIfAborted();
  const result = await chrome.runtime.sendMessage({
    target: "offscreen", type: "readImage", id, screenshot, rect, viewport
  });
  screenshot = null;
  signal.throwIfAborted();
  if (!result?.ok) throw new Error(result?.error || "Could not read the image. Try a clearer or larger selection.");
  return { text: result.text };
}

function cancelJob(key) {
  const job = jobs.get(key);
  if (!job) return;
  job.controller.abort();
  if (job.type === "readImage") {
    chrome.runtime.sendMessage({ target: "offscreen", type: "cancelOCR", id: key }).catch(() => {});
  }
  jobs.delete(key);
}

async function handle(message, sender) {
  if (message.type === "scanState") {
    if (sender.tab && sender.frameId === 0) {
      if (message.active) scanningTabs.set(sender.tab.id, sender.tab.windowId);
      else scanningTabs.delete(sender.tab.id);
    }
    return {};
  }
  if (message.type === "saveWords") {
    if (!Array.isArray(message.words) || !message.words.length) throw new Error("There is no text to save.");
    const words = message.words.map(validateText);
    return editLibrary(saved => mergeWords(saved, words));
  }
  if (message.type === "clearWords") return editLibrary(() => []);
  if (message.type === "startScan") {
    return beginTabScan(await scanTab());
  }
  const key = `${owner(sender)}:${message.id}`;
  if (message.type === "cancel") { cancelJob(key); return {}; }
  if (typeof message.id !== "string" || message.id.length > 100) throw new Error("Invalid request.");
  const controller = new AbortController();
  jobs.set(key, { controller, type: message.type, tabId: sender.tab?.id, windowId: sender.tab?.windowId });
  try {
    return message.type === "translate"
      ? { translation: await translator.translate(message.text, controller.signal) }
      : await readImage(message, sender, controller.signal, key);
  } finally { jobs.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("offscreen.html") &&
      message?.target === "background" && message.type === "ocrHeartbeat") {
    respond({ ok: true });
    return;
  }
  if (sender.id !== chrome.runtime.id || message?.target !== "background" ||
      !["translate", "readImage", "cancel", "saveWords", "clearWords", "startScan", "scanState"].includes(message.type)) return;
  handle(message, sender).then(result => respond({ ok: true, ...result }), error => {
    respond({ ok: false, error: error.name === "AbortError" ? "Cancelled." : error.message });
  });
  return true;
});

chrome.commands.onCommand.addListener(command => {
  if (command === "scan-area") handle({ type: "startScan" }, {}).catch(() => {
    // Protected pages cannot host the panel; the popup explains availability.
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setTitle({ title: "EasyDic: open an ordinary webpage, then try scanning again" });
  });
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  for (const [scanningTabId, scanningWindowId] of scanningTabs) {
    if (scanningWindowId === windowId && scanningTabId !== tabId) {
      chrome.tabs.sendMessage(scanningTabId, { type: "cancelScan" }, { frameId: 0 }).catch(() => {});
      scanningTabs.delete(scanningTabId);
    }
  }
  for (const [key, job] of jobs) {
    if (job.type === "readImage" && job.windowId === windowId && job.tabId !== tabId) cancelJob(key);
  }
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "EasyDic" });
});

chrome.tabs.onRemoved.addListener(tabId => {
  scanningTabs.delete(tabId);
  for (const [key, job] of jobs) if (job.tabId === tabId) cancelJob(key);
});
