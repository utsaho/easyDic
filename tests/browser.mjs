import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const extension = resolve(import.meta.dirname, "..");
const profile = await mkdtemp(join(tmpdir(), "easydic-browser-"));
const fixture = `<!doctype html><html><head><title>Reading fixture</title><style>
 body{font:20px/1.8 system-ui;margin:40px;background:#fff;color:#111} p{max-width:620px} canvas{display:block;border:1px solid #aaa} .space{height:1500px}
 </style></head><body><h1>Keep reading</h1><p id="one">I am reading an article.</p><p id="two">A new sentence has a different meaning.</p><p id="slow">Slow translation.</p><p id="fail">Retry translation.</p><p id="multiline">First line.<br>Second line.</p><input aria-label="Editable text" value="Do not translate this input"><div contenteditable="true">Editable paragraph</div><canvas id="image" width="600" height="100"></canvas><div class="space"></div></body></html>`;
const server = createServer((_, response) => {
  response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'none'; img-src 'self' data:; worker-src 'none'" });
  response.end(fixture);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let context;
const sessions = new WeakMap();
async function shadow(page, selector, fn, args = []) {
  let cdp = sessions.get(page);
  if (!cdp) { cdp = await context.newCDPSession(page); sessions.set(page, cdp); }
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  function find(node) {
    const attributes = node.attributes || [];
    if (attributes.includes(selector)) return node;
    for (const child of [...node.children || [], ...node.shadowRoots || []]) {
      const match = find(child);
      if (match) return match;
    }
  }
  const host = find(root);
  if (!host?.shadowRoots?.[0]) return null;
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: host.shadowRoots[0].backendNodeId });
  const result = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const panel = page => shadow(page, "data-easydic-panel", function () {
  return { source: this.querySelector(".source").textContent, result: this.querySelector(".translation").textContent,
    status: this.querySelector(".status").textContent, hidden: this.host.style.display === "none", edit: !this.querySelector(".edit").hidden };
});
const click = async (page, selector) => {
  const point = await shadow(page, "data-easydic-panel", function (selector) {
    const rect = this.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, [selector]);
  await page.mouse.click(point.x, point.y);
};
async function until(check, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error(`Timed out: ${label}`);
}
const select = (page, selector) => page.evaluate(selector => {
  document.activeElement?.blur();
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(selector));
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
}, selector);
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: process.env.HEADED !== "1", channel: process.env.BROWSER_EXECUTABLE ? undefined : "chromium",
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    viewport: { width: 1100, height: 850 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-first-run", "--disable-component-update", "--enable-unsafe-extension-debugging"]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(() => {
    chrome.runtime.onMessage.addListener(message => {
      if (message.target === "background" && message.type === "readImage") {
        globalThis.captureGeometry = { rect: message.rect, viewport: message.viewport };
      }
    });
    const capture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    chrome.tabs.captureVisibleTab = async (...args) => {
      globalThis.lastCapture = await capture(...args);
      return globalThis.lastCapture;
    };
    globalThis.requests = [];
    globalThis.originalFetch = globalThis.fetch;
    globalThis.failOnce = true;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://api.mymemory.translated.net/get?")) return originalFetch(url, options);
      const text = new URL(url).searchParams.get("q");
      requests.push(text);
      if (text.startsWith("Slow")) await new Promise(resolve => setTimeout(resolve, 1100));
      if (text.startsWith("Retry") && failOnce) { failOnce = false; throw new TypeError("Offline"); }
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `বাংলা: ${text}` } }), { headers: { "Content-Type": "application/json" } });
    };
    return chrome.storage.local.set({ savedWords: ["Legacy", "hello"], enabled: true });
  });
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 100);
    ctx.fillStyle = "black"; ctx.font = "32px Arial"; ctx.fillText("Reading makes life better.", 20, 60);
  });
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const tabsBefore = context.pages().length;
  await select(page, "#one");
  await until(async () => (await panel(page))?.result.includes("I am reading"), "highlight translation");
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords), ["Legacy", "hello"]);
  await click(page, ".save");
  await until(async () => (await panel(page))?.status.includes("Saved to"), "explicit save");
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords), ["Legacy", "hello", "I am reading an article."]);
  const deck = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "getTemporaryWords" }), tabId);
  assert.deepEqual(deck.words, ["I am reading an article."]);
  console.log("PASS highlight, focus, explicit saving, legacy storage, page deck");

  // Real pointer events exercise closed Shadow DOM containment, not just .click().
  await click(page, ".source");
  assert.equal((await panel(page)).hidden, false);
  const insideRange = await shadow(page, "data-easydic-panel", function () {
    const range = document.createRange();
    const text = this.querySelector(".source").firstChild;
    range.setStart(text, 0); range.setEnd(text, 12);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2, right: rect.right };
  });
  await page.mouse.move(insideRange.x, insideRange.y);
  await page.mouse.down();
  await page.mouse.move(insideRange.right, insideRange.y, { steps: 5 });
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal((await panel(page)).hidden, false);
  assert.equal((await panel(page)).source, "I am reading an article.");
  await click(page, ".copy");
  assert.equal((await panel(page)).hidden, false);
  await page.evaluate(() => scrollTo(0, 80));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await panel(page)).hidden, false);
  await page.evaluate(() => scrollTo(0, 0));

  // A page may prevent the default focus/selection change on its controls.
  await select(page, "#one");
  await page.evaluate(() => document.body.addEventListener("pointerdown", event => event.preventDefault(), { once: true }));
  await page.mouse.click(950, 80);
  assert.equal((await panel(page)).hidden, true);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal((await panel(page)).hidden, true, "An unchanged selection must not reopen the dismissed result");
  // Clear the old highlight before starting a fresh selection; dragging an
  // existing highlight starts the browser's native text drag-and-drop instead.
  await page.mouse.click(950, 120);

  // Drag over the same text again, then over different text while a result is open.
  async function dragSelection(selector) {
    const rect = await page.locator(selector).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2, right: rect.right };
    });
    await page.mouse.move(rect.x, rect.y); await page.mouse.down();
    assert.equal((await panel(page)).hidden, true);
    await page.mouse.move(rect.right, rect.y, { steps: 8 }); await page.mouse.up();
  }
  await dragSelection("#one");
  await until(async () => !(await panel(page))?.hidden && (await panel(page)).source === "I am reading an article.", "reselect same text");
  await dragSelection("#two");
  await until(async () => !(await panel(page))?.hidden && (await panel(page)).source.includes("different meaning"), "new dragged selection");

  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "showTranslation", text: "Slow outside dismissal." }), tabId);
  await page.mouse.click(950, 80);
  assert.equal((await panel(page)).hidden, true);
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal((await panel(page)).hidden, true, "A late response must not reopen the panel");
  console.log("PASS outside dismissal, retained selection, fresh drag selection, inside controls/text, scrolling, and delayed responses");

  await select(page, "#multiline");
  await until(async () => (await panel(page))?.result.includes("First line. Second line."), "multiline selection");
  await page.keyboard.press("Escape");
  const requestCount = await worker.evaluate(() => requests.length);
  await page.locator("input").focus();
  await page.locator("input").evaluate(input => input.select());
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await worker.evaluate(() => requests.length), requestCount);
  assert.equal((await panel(page)).hidden, true);
  await select(page, "#two");
  await page.evaluate(() => {
    const selection = getSelection();
    selection.collapseToStart();
    selection.modify("extend", "forward", "word");
  });
  await page.keyboard.press("Shift+ArrowRight");
  const keyboardText = await page.evaluate(() => getSelection().toString().trim());
  await until(async () => (await panel(page))?.result.includes(keyboardText) && (await panel(page)).source === keyboardText, "keyboard selection");
  console.log("PASS multiline and keyboard selection; editable text ignored");

  await select(page, "#slow");
  await until(async () => (await panel(page))?.status === "Translating…", "slow request starts");
  await select(page, "#two");
  await until(async () => (await panel(page))?.result.includes("different meaning"), "new selection wins");
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.ok((await panel(page)).result.includes("different meaning"));
  await page.keyboard.press("Escape");
  assert.equal((await panel(page)).hidden, true);
  await select(page, "#fail");
  await until(async () => (await panel(page))?.status.includes("internet"), "offline error");
  await page.mouse.click(950, 80);
  assert.equal((await panel(page)).hidden, true, "Outside click dismisses errors too");
  await worker.evaluate(() => { globalThis.failOnce = true; });
  await select(page, "#fail");
  await until(async () => !(await panel(page))?.hidden && (await panel(page))?.status.includes("internet"), "reopened offline error");
  await click(page, ".retry");
  await until(async () => (await panel(page))?.result.includes("Retry translation"), "retry result");
  console.log("PASS stale request cancellation, Escape, error and retry");

  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "showTranslation", text: "Slow close request." }), tabId);
  await click(page, ".close");
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal((await panel(page)).hidden, true);
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "showTranslation", text: "x".repeat(2001) }), tabId);
  await until(async () => (await panel(page))?.status.includes("2,000"), "oversized text feedback");
  assert.ok(!(await worker.evaluate(() => requests)).some(text => text.length > 2000));

  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await select(page, "#multiline");
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await panel(page)).hidden, true);

  // Trigger the real toolbar action to grant activeTab, then click Scan area.
  // Synthetic page keystrokes do not dispatch browser-level extension commands.
  await page.bringToFront();
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.ok(commands.find(command => command.name === "scan-area")?.shortcut);
  const browserCDP = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserCDP.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  const targetInfo = targetInfos.find(target => target.url === page.url());
  assert.ok(targetInfo, "Article tab target exists");
  await browserCDP.send("Extensions.triggerAction", { id: extensionId, targetId: targetInfo.targetId });
  const popupTarget = await until(async () => {
    const { targetInfos } = await browserCDP.send("Target.getTargets", { filter: [{}] });
    return targetInfos.find(item => item.url === `chrome-extension://${extensionId}/popup.html`);
  }, "toolbar popup", 5000);
  const { sessionId: popupSession } = await browserCDP.send("Target.attachToTarget", { targetId: popupTarget.targetId, flatten: false });
  await browserCDP.send("Target.sendMessageToTarget", { sessionId: popupSession, message: JSON.stringify({
    id: 1, method: "Runtime.evaluate", params: { expression: "document.readyState !== 'complete' ? window.addEventListener('load', () => document.getElementById('scan-area').click()) : document.getElementById('scan-area').click()" }
  }) });
  await until(async () => page.locator("[data-easydic-scan]").count(), "scan area", 5000);
  await until(async () => {
    const { targetInfos } = await browserCDP.send("Target.getTargets", { filter: [{}] });
    return !targetInfos.some(item => item.targetId === popupTarget.targetId);
  }, "scan popup closes");
  const rect = await page.locator("canvas").boundingBox();
  await page.mouse.move(rect.x + 2, rect.y + 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 2, rect.y + rect.height - 2, { steps: 10 });
  await page.mouse.up();
  await until(async () => { const state = await panel(page); return state?.edit && !state.hidden && state.result; }, "real local OCR", 55000);
  assert.match((await panel(page)).source, /Reading makes life better/i);
  assert.equal((await panel(page)).edit, true);
  await click(page, ".edit");
  await shadow(page, "data-easydic-panel", function () { this.querySelector("textarea").value = "Corrected image text."; });
  await click(page, ".again");
  await until(async () => (await panel(page))?.result.includes("Corrected image text"), "OCR correction");
  assert.equal(context.pages().length, tabsBefore);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({ path: join(tmpdir(), "easydic-panel.png") });
  console.log("PASS shortcut registration, toolbar scan with automatic translation disabled, local OCR at 2× density, correction, no new tabs");

  // Browser zoom changes CSS coordinates; capture-to-crop mapping must still agree.
  await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1.25), tabId);
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.locator("canvas").scrollIntoViewIfNeeded();
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  const zoomed = await page.locator("canvas").boundingBox();
  await page.mouse.move(zoomed.x + 3, zoomed.y + 3);
  await page.mouse.down();
  await page.mouse.move(Math.min(1090, zoomed.x + zoomed.width - 3), zoomed.y + zoomed.height - 3, { steps: 8 });
  await page.mouse.up();
  await until(async () => { const state = await panel(page); return state?.edit && !state.hidden && state.result; }, "OCR with browser zoom", 55000);
  assert.match((await panel(page)).source, /Reading makes life better/i);
  await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId);
  await page.evaluate(() => scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 250));
  console.log("PASS local OCR at 125% browser zoom");

  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  await page.mouse.move(800, 100);
  await page.mouse.down();
  await page.mouse.move(1000, 220, { steps: 5 });
  await page.mouse.up();
  await until(async () => (await panel(page))?.status.includes("No English text found"), "blank image feedback", 55000);
  assert.equal((await panel(page)).result, "");
  console.log("PASS blank image produces an actionable OCR error");

  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  await page.mouse.move(20, 20); await page.mouse.down();
  await page.mouse.move(22, 22); await page.mouse.up();
  assert.equal(await page.locator("[data-easydic-scan]").count(), 1);
  assert.match(await shadow(page, "data-easydic-scan", function () { return this.querySelector(".hint").textContent; }), /larger box/);
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await until(async () => !await page.locator("[data-easydic-scan]").count(), "tab switch cancels scan");
  await other.close();
  await page.bringToFront();
  console.log("PASS tiny scan rejection and tab-switch cancellation");

  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  await until(async () => page.locator("[data-easydic-scan]").count(), "second scan");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  await page.evaluate(() => scrollTo(0, 100));
  await until(async () => !await page.locator("[data-easydic-scan]").count(), "scroll cancels scan");
  await page.evaluate(() => scrollTo(0, 0));
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "beginScan" }), tabId);
  await page.setViewportSize({ width: 360, height: 650 });
  await until(async () => !await page.locator("[data-easydic-scan]").count(), "resize cancels scan");
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "showTranslation", text: "Small viewport." }), tabId);
  await until(async () => (await panel(page))?.result.includes("Small viewport"), "small viewport");
  const bounds = await page.locator("[data-easydic-panel]").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  await page.emulateMedia({ colorScheme: "dark" });
  const colors = await shadow(page, "data-easydic-panel", function () {
    const style = getComputedStyle(this.querySelector("section"));
    return { color: style.color, font: style.fontFamily };
  });
  assert.equal(colors.color, "rgb(228, 237, 247)");
  assert.ok(colors.font.includes("system-ui"));
  await page.screenshot({ path: join(tmpdir(), "easydic-panel-dark.png") });
  console.log("PASS scan cancellation, small viewport and dark theme");

  // An extension page cannot host the content script, exercising the popup fallback.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#dictionary-search-input").fill("Fallback translation.");
  await popup.locator("#dictionary-search-button").click();
  await until(async () => (await panel(popup))?.result.includes("Fallback translation"), "popup fallback");
  await popup.locator("#load-words").click();
  await until(async () => (await popup.locator("#word-card").textContent()) === "Legacy", "load legacy words");
  console.log("PASS protected-page popup fallback and saved-library loading");
  const writes = await popup.evaluate(() => Promise.all([
    chrome.runtime.sendMessage({ target: "background", type: "saveWords", words: ["Concurrent one"] }),
    chrome.runtime.sendMessage({ target: "background", type: "saveWords", words: ["Concurrent two"] })
  ]));
  assert.ok(writes.every(result => result.ok));
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords);
  assert.ok(saved.includes("Concurrent one") && saved.includes("Concurrent two") && saved.includes("Legacy"));
  popup.once("dialog", dialog => dialog.accept());
  await popup.locator("#remove-words").click();
  await until(async () => (await popup.locator("#action-status").textContent()) === "Saved words cleared", "clear saved library");
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords), []);
  assert.deepEqual((await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: "getTemporaryWords" }), tabId)).words, ["I am reading an article."]);
  console.log("PASS simultaneous saves and clear-library/session-deck separation");
  console.log(`Browser: ${await context.browser()?.version()} · all integration checks passed`);
} catch (error) {
  for (const page of context?.pages() || []) {
    console.error("DIAGNOSTIC", page.url(), await panel(page).catch(() => null));
    console.error(await page.evaluate(() => ({ selection: getSelection()?.toString(), hosts: document.querySelectorAll("[data-easydic-panel]").length, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, image: document.querySelector("canvas")?.getBoundingClientRect().toJSON() })).catch(() => null));
  }
  console.error("REQUESTS", await context?.serviceWorkers()[0]?.evaluate(() => globalThis.requests).catch(() => null));
  console.error("CAPTURE", await context?.serviceWorkers()[0]?.evaluate(() => globalThis.captureGeometry).catch(() => null));
  const screenshot = await context?.serviceWorkers()[0]?.evaluate(() => globalThis.lastCapture).catch(() => null);
  if (screenshot) await writeFile(join(tmpdir(), "easydic-capture-debug.png"), Buffer.from(screenshot.split(",")[1], "base64"));
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
