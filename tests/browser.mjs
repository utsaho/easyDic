import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, cp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const testFiles = await mkdtemp(join(tmpdir(), "easydic-test-extension-"));
const extension = join(testFiles, "extension");
await cp(resolve(import.meta.dirname, ".."), extension, { recursive: true,
  filter: path => !/(?:^|\/)(?:node_modules|\.git|\.agents|\.codex)(?:\/|$)/.test(path) });
// Expose the production router only in the disposable test copy. Service workers
// prohibit dynamic imports, and native OS shortcut delivery needs a separate test.
await appendFile(join(extension, "background.js"), "\nglobalThis.testInvokeShortcut = invokeShortcut;\nglobalThis.testRunShortcut = runShortcut;\n");
const profile = await mkdtemp(join(tmpdir(), "easydic-browser-"));
const fixture = `<!doctype html><html><head><title>Reading fixture</title><style>
body{font:20px/1.8 system-ui;margin:40px;background:#fff;color:#111}p{max-width:620px}canvas{display:block;border:1px solid #aaa}.space{height:1500px}
</style></head><body><h1>Keep reading</h1><p id="one">I am reading an article.</p><p id="two">A new sentence has a different meaning.</p><p id="slow">Slow translation.</p><p id="fail">Retry translation.</p><p id="multiline">First line.<br>Second line.</p><input value="Editable text"><canvas width="600" height="100"></canvas><div class="space"></div></body></html>`;
const server = createServer((_, response) => {
  response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'none'; img-src 'self' data:; worker-src 'none'" });
  response.end(fixture);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let context;
const sessions = new WeakMap();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await pause(70); }
  throw new Error(`Timed out: ${label}`);
}
async function session(target) {
  if (target.send) return target;
  if (!sessions.has(target)) sessions.set(target, await context.newCDPSession(target));
  return sessions.get(target);
}
async function shadow(target, selector, fn, args = []) {
  const cdp = await session(target);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  function find(node) {
    if (node.shadowRoots?.length && (node.attributes || []).includes(selector)) return node;
    for (const child of [...node.children || [], ...node.shadowRoots || []]) { const match = find(child); if (match) return match; }
  }
  const host = find(root);
  if (!host) return null;
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: host.shadowRoots[0].backendNodeId });
  const result = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const panel = (target, mount = "data-easydic-panel") => shadow(target, mount, function () {
  return { source: this.querySelector(".source").textContent, result: this.querySelector(".translation").textContent,
    status: this.querySelector(".status").textContent, hidden: this.host.style.display === "none", edit: !this.querySelector(".edit").hidden,
    save: this.querySelector(".save").textContent, saveDisabled: this.querySelector(".save").disabled,
    headerHidden: this.querySelector("header").hidden, sourceHidden: this.querySelector(".source-block").hidden, removedControls: this.querySelectorAll(".copy,.info-button,.info-details").length };
});
const click = async (page, selector, mount = "data-easydic-panel") => {
  await shadow(page, mount, function (selector) { this.querySelector(selector).scrollIntoView({ block: "nearest" }); }, [selector]);
  const point = await shadow(page, mount, function (selector) { const r = this.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [selector]);
  await page.mouse.click(point.x, point.y);
};
const select = (page, selector) => page.evaluate(selector => {
  document.activeElement?.blur();
  const range = document.createRange(); range.selectNodeContents(document.querySelector(selector));
  getSelection().removeAllRanges(); getSelection().addRange(range);
}, selector);
const launch = () => chromium.launchPersistentContext(profile, {
  headless: process.env.HEADED !== "1", channel: process.env.BROWSER_EXECUTABLE ? undefined : "chromium",
  executablePath: process.env.BROWSER_EXECUTABLE || undefined, viewport: { width: 1100, height: 850 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-first-run", "--disable-component-update", "--enable-unsafe-extension-debugging"]
});
async function mockTranslation(worker) {
  await worker.evaluate(() => {
    globalThis.requests = [];
    globalThis.failOnce = true;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://api.mymemory.translated.net/get?")) return original(url, options);
      const text = new URL(url).searchParams.get("q"); requests.push(text);
      if (text.startsWith("Slow")) await new Promise(resolve => setTimeout(resolve, 1100));
      if (text.startsWith("Retry") && failOnce) { failOnce = false; throw new TypeError("Offline"); }
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: text === "I am reading an article." ? "আমি একটি নিবন্ধ পড়ছি।" : `বাংলা: ${text}` } }), { headers: { "Content-Type": "application/json" } });
    };
  });
}
// Native toolbar popups are CDP targets, not Playwright pages. This adapter lets
// the same DOM inspection exercise the real popup without opening another tab.
async function attachPopup(browserCDP, targetId) {
  const { sessionId } = await browserCDP.send("Target.attachToTarget", { targetId, flatten: false });
  let counter = 0;
  const pending = new Map();
  browserCDP.on("Target.receivedMessageFromTarget", event => {
    if (event.sessionId !== sessionId) return;
    const response = JSON.parse(event.message);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    clearTimeout(waiter.timer); pending.delete(response.id);
    response.error ? waiter.reject(new Error(response.error.message)) : waiter.resolve(response.result);
  });
  return { async send(method, params = {}) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Popup command timed out: ${method}`)); }, 7000);
      pending.set(id, { resolve, reject, timer });
      browserCDP.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  } };
}
async function evaluateTarget(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

try {
  context = await launch();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  await mockTranslation(worker);
  await worker.evaluate(() => {
    globalThis.speechCalls = [];
    globalThis.speechStops = 0;
    globalThis.voiceMode = "normal";
    chrome.tts.getVoices = async () => {
      if (voiceMode === "delayed") await new Promise(resolve => setTimeout(resolve, 500));
      return voiceMode === "missing" ? [] : [
        { voiceName: "Remote", lang: "en-US", remote: true },
        { voiceName: "British", lang: "en-GB", remote: false },
        { voiceName: "Local", lang: "en-US", remote: false }
      ];
    };
    chrome.tts.speak = async (text, options) => {
      speechCalls.push({ text, voiceName: options.voiceName, lang: options.lang, rate: options.rate, enqueue: options.enqueue });
      globalThis.speechEvent = options.onEvent;
      if (voiceMode === "error") throw new Error("Simulated speech failure");
      options.onEvent({ type: "start" });
    };
    chrome.tts.stop = () => { speechStops++; };
  });
  await worker.evaluate(() => chrome.storage.local.set({ savedWords: ["Legacy", "hello"], enabled: false }));
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const articleUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(articleUrl);
  await page.evaluate(() => {
    const c = document.querySelector("canvas").getContext("2d"); c.fillStyle = "white"; c.fillRect(0, 0, 600, 100);
    c.fillStyle = "black"; c.font = "32px Arial"; c.fillText("Reading makes life better.", 20, 60);
  });
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
  await until(async () => {
    try { return (await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: "canScan" }), tab.id)).ok; } catch { return false; }
  }, "content script ready");
  // Calls the production command router. Does NOT claim to simulate OS key delivery.
  const invoke = (command = "scan-area") => worker.evaluate(({ tab, command }) => testInvokeShortcut(tab, command), { tab, command });
  const deliver = (command = "scan-area") => worker.evaluate(({ tab, command }) => testRunShortcut(command, tab), { tab, command });
  const saved = () => worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords);
  assert.deepEqual(await worker.evaluate(() => {
    const commands = chrome.runtime.getManifest().commands;
    return [commands["scan-area"].suggested_key.linux, commands["capture-area"].suggested_key.linux,
      commands["scan-area"].suggested_key.mac, commands["capture-area"].suggested_key.mac];
  }), ["Ctrl+Shift+X", "Ctrl+Shift+E", "Alt+Shift+X", "Alt+Shift+A"]);

  await select(page, "#one"); await pause(500);
  assert.equal(await page.locator("[data-easydic-panel]").count(), 0);
  await page.keyboard.press("Shift+ArrowLeft"); await pause(100);
  assert.deepEqual(await worker.evaluate(() => requests), []);
  await page.locator("input").focus(); await page.locator("input").evaluate(input => input.select()); await pause(100);
  assert.deepEqual(await worker.evaluate(() => requests), []);
  await select(page, "#one"); await invoke();
  await until(async () => (await panel(page))?.result === "আমি একটি নিবন্ধ পড়ছি।", "command-selected translation");
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
  assert.deepEqual(await saved(), ["Legacy", "hello"]);
  assert.equal((await panel(page)).removedControls, 0);
  await page.screenshot({ path: join(tmpdir(), "easydic-page-result.png") });
  console.log("PASS native selection remains passive; selection command translates; old enabled preference ignored");
  assert.deepEqual(await worker.evaluate(() => speechCalls), []);
  await click(page, ".source");
  await click(page, ".translation");
  assert.deepEqual(await worker.evaluate(() => speechCalls), []);
  await click(page, ".speaker");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) === 1, "page pronunciation");
  assert.deepEqual(await worker.evaluate(() => speechCalls[0]), { text: "I am reading an article.", voiceName: "Local", lang: "en-US", rate: 1, enqueue: false });
  await click(page, ".speaker");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) === 2, "replay pronunciation");
  assert.ok(await worker.evaluate(() => speechStops > 0));
  let stops = await worker.evaluate(() => speechStops);
  await page.keyboard.press("Escape");
  await until(async () => (await worker.evaluate(() => speechStops)) > stops, "closing result stops speech");
  await select(page, "#one"); await invoke();
  await until(async () => (await panel(page))?.result, "result reopened");
  await worker.evaluate(() => { voiceMode = "missing"; });
  await click(page, ".speaker");
  await until(async () => (await shadow(page, "data-easydic-panel", function () { return this.querySelector(".speech-status").textContent; }))?.includes("No local English voice"), "missing English voice guidance");
  assert.equal((await panel(page)).result, "আমি একটি নিবন্ধ পড়ছি।");
  await worker.evaluate(() => { voiceMode = "error"; });
  await click(page, ".speaker");
  await until(async () => (await shadow(page, "data-easydic-panel", function () { return this.querySelector(".speech-status").textContent; }))?.includes("Simulated speech failure"), "speech rejection");
  await worker.evaluate(() => { voiceMode = "normal"; });
  await click(page, ".speaker");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) === 4, "speech recovery");
  await worker.evaluate(() => speechEvent({ type: "error" }));
  await until(async () => (await shadow(page, "data-easydic-panel", function () { return this.querySelector(".speech-status").textContent; }))?.includes("Could not play pronunciation"), "asynchronous speech error");
  console.log("PASS speaker-only pronunciation, local English voice, replay, close, and speech errors");


  await worker.evaluate(() => {
    globalThis.originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    globalThis.rejectSave = true;
    chrome.storage.local.set = async value => {
      if (value.savedWords) {
        if (globalThis.rejectSave) { globalThis.rejectSave = false; throw new Error("Simulated storage failure"); }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return originalSet(value);
    };
  });
  await click(page, ".save");
  await until(async () => (await panel(page))?.status.includes("Could not save"), "save failure");
  assert.deepEqual(await saved(), ["Legacy", "hello"]);
  await click(page, ".save");
  assert.equal((await panel(page)).save, "Saving…");
  await until(async () => (await panel(page))?.save === "Saved ✓", "confirmed persistent save");
  assert.equal((await panel(page)).status, "");
  assert.deepEqual(await saved(), ["Legacy", "hello", "I am reading an article."]);
  await worker.evaluate(() => { chrome.storage.local.set = originalSet; });
  await page.evaluate(() => { document.querySelector("#one").textContent = "I AM READING AN ARTICLE."; });
  await select(page, "#one"); await invoke();
  await until(async () => (await panel(page))?.source === "I AM READING AN ARTICLE.", "duplicate source");
  assert.equal((await panel(page)).save, "Saved ✓");
  assert.equal((await panel(page)).saveDisabled, true);
  assert.equal((await saved()).length, 3);
  console.log("PASS shared local saving, write failure/retry, Saving/Saved feedback, and duplicate recognition");

  await page.locator("input").focus();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#two"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "INPUT");
  assert.equal(await deliver(), "started");
  await until(async () => (await panel(page))?.result.includes("different meaning"), "article selection after input focus");
  assert.equal((await worker.evaluate(async () => (await chrome.storage.session.get("lastShortcut")).lastShortcut.status)), "started");
  await page.locator("input").evaluate(input => input.select());
  assert.equal(await deliver(), "no-selection");
  assert.equal((await worker.evaluate(async () => (await chrome.storage.session.get("lastShortcut")).lastShortcut.status)), "no-selection");
  await page.evaluate(() => { document.activeElement?.blur(); getSelection().removeAllRanges(); });
  console.log("PASS article selection after input focus, editable exclusion, and shortcut diagnostic");

  await select(page, "#slow"); await invoke(); await invoke(); await invoke();
  assert.equal(await page.locator("[data-easydic-panel]").count(), 1);
  await until(async () => (await worker.evaluate(() => requests)).includes("Slow translation."), "pending request");
  assert.equal((await worker.evaluate(() => requests)).filter(text => text === "Slow translation.").length, 1);
  await worker.evaluate(() => { voiceMode = "missing"; });
  await click(page, ".speaker");
  await until(async () => (await shadow(page, "data-easydic-panel", function () { return this.querySelector(".speech-status").textContent; }))?.includes("No local English voice"), "speech error during translation");
  assert.equal((await panel(page)).status, "Translating…");
  await worker.evaluate(() => { voiceMode = "normal"; });
  await page.mouse.click(950, 80); assert.equal((await panel(page)).hidden, true);
  await pause(1300); assert.equal((await panel(page)).hidden, true);
  await select(page, "#two"); await pause(450); assert.equal((await panel(page)).hidden, true);
  await invoke(); await until(async () => (await panel(page))?.result.includes("different meaning"), "new command");
  await click(page, ".source"); assert.equal((await panel(page)).hidden, false);
  const textPoint = await shadow(page, "data-easydic-panel", function () { const r = this.querySelector(".translation").getBoundingClientRect(); return { x: r.x + 24, y: r.y + 14 }; });
  await page.mouse.dblclick(textPoint.x, textPoint.y);
  assert.equal((await panel(page)).hidden, false);
  assert.ok(await shadow(page, "data-easydic-panel", function () { return this.getSelection().toString().length > 0; }));
  await page.evaluate(() => scrollTo(0, 80)); await pause(100); assert.equal((await panel(page)).hidden, false);
  await page.evaluate(() => scrollTo(0, 0));
  await page.keyboard.press("Escape"); assert.equal((await panel(page)).hidden, true);
  await select(page, "#fail"); await invoke();
  await until(async () => (await panel(page))?.status.includes("internet"), "translation error");
  await click(page, ".retry"); await until(async () => (await panel(page))?.result.includes("Retry translation"), "retry");
  await page.evaluate(() => { document.querySelector("#two").textContent = "x".repeat(2001); });
  await select(page, "#two"); await invoke();
  assert.match((await panel(page)).status, /2,000/);
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);
  console.log("PASS duplicate command suppression, outside/Escape dismissal, scrolling, error/retry, and oversized selection");
  await page.evaluate(() => { document.querySelector("#two").textContent = "A new sentence has a different meaning."; });

  await page.evaluate(() => { document.activeElement?.blur(); getSelection().removeAllRanges(); });
  const unchangedPanel = await panel(page);
  const unchangedRequests = await worker.evaluate(() => requests.length);
  await invoke(); await invoke();
  assert.deepEqual(await panel(page), unchangedPanel);
  assert.equal(await worker.evaluate(() => requests.length), unchangedRequests);
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);
  await select(page, "#one"); await invoke("capture-area"); await invoke("capture-area");
  assert.equal(await page.locator("[data-easydic-scan]").count(), 1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => getSelection().removeAllRanges()); await invoke("capture-area");
  assert.equal(await page.locator("[data-easydic-scan]").count(), 1);
  await page.keyboard.press("Escape"); await invoke();
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);
  assert.equal((await panel(page)).hidden, true);
  assert.equal(await deliver("capture-area"), "started");
  assert.equal((await worker.evaluate(async () => (await chrome.storage.session.get("lastShortcut")).lastShortcut.status)), "started");
  await page.keyboard.press("Escape");
  console.log("PASS separate command routing: X without selection does nothing; A scans with or without selection");

  // Exercise an actual toolbar popup while an ordinary article is active.
  const browserCDP = await context.browser().newBrowserCDPSession();
  const targets = await browserCDP.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  await browserCDP.send("Extensions.triggerAction", { id: extensionId, targetId: targets.targetInfos.find(t => t.url === page.url()).targetId });
  const popupTarget = await until(async () => (await browserCDP.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.url === `chrome-extension://${extensionId}/popup.html`), "native toolbar popup");
  const toolbar = await attachPopup(browserCDP, popupTarget.targetId);
  await until(async () => await evaluateTarget(toolbar, 'document.readyState === "complete" && document.getElementById("word-card").textContent === "Legacy"'), "all saved default");
  assert.equal(await evaluateTarget(toolbar, 'document.body.getBoundingClientRect().width'), 450);
  assert.equal(await evaluateTarget(toolbar, 'document.documentElement.scrollWidth <= innerWidth'), true);
  const initialReview = await evaluateTarget(toolbar, `(() => {
    const left = document.querySelector('.word-card').getBoundingClientRect();
    const right = document.querySelector('.result-card').getBoundingClientRect();
    return { leftWidth: left.width, rightWidth: right.width, gap: right.x - left.right,
      height: document.querySelector('main').getBoundingClientRect().height,
      navY: document.querySelector('.card-controls').getBoundingClientRect().y,
      blank: document.getElementById('translation-result').childElementCount === 0,
      inputTag: document.getElementById('dictionary-search-input').tagName,
      viewport: innerHeight, screenHeight: screen.height, bodyClient: document.body.clientHeight,
      bodyScroll: document.body.scrollHeight, docScroll: document.documentElement.scrollHeight };
  })()`);
  assert.equal(initialReview.leftWidth, initialReview.rightWidth);
  assert.equal(initialReview.gap, 12);
  assert.equal(initialReview.blank, true);
  assert.equal(initialReview.inputTag, "INPUT");
  assert.ok(initialReview.height < 590, JSON.stringify(initialReview));
  // The default headless display is only 600 px tall and limits native popups
  // to 498 px. Smaller displays may scroll; the normal desktop must fit.
  const fullHeightAvailable = initialReview.screenHeight >= 700;
  assert.ok(initialReview.bodyScroll <= initialReview.bodyClient + 1);
  if (fullHeightAvailable) await until(async () => await evaluateTarget(toolbar, 'document.documentElement.scrollHeight <= innerHeight + 1'), "no initial native popup scrollbar");
  await evaluateTarget(toolbar, 'document.getElementById("search-word").click()');
  await until(async () => (await panel(toolbar, "translation-result"))?.result.includes("Legacy"), "native toolbar saved lookup");
  assert.equal((await panel(toolbar, "translation-result")).headerHidden, true);
  assert.equal((await panel(toolbar, "translation-result")).sourceHidden, true);
  assert.equal(await evaluateTarget(toolbar, 'document.querySelector(".card-controls").getBoundingClientRect().y'), initialReview.navY);
  assert.ok(await evaluateTarget(toolbar, 'document.querySelector("main").getBoundingClientRect().height < 590'));
  if (fullHeightAvailable) await until(async () => await evaluateTarget(toolbar, 'document.documentElement.scrollHeight <= innerHeight + 1 && document.body.scrollHeight <= document.body.clientHeight + 1'), "no scrollbar for a translated word");
  console.log(`PASS native equal-column layout: ${Math.round(initialReview.height)} px content, ${initialReview.viewport} px available (${fullHeightAvailable ? "no scrollbar" : "small-screen scrolling allowed"})`);
  assert.equal((await panel(page)).hidden, true);
  assert.ok((await browserCDP.send("Target.getTargets", { filter: [{}] })).targetInfos.some(t => t.targetId === popupTarget.targetId));
  await evaluateTarget(toolbar, 'document.getElementById("dictionary-search-input").value="Toolbar translation."; document.getElementById("dictionary-search-input").dispatchEvent(new Event("input")); document.getElementById("dictionary-search-button").click()');
  await until(async () => (await panel(toolbar, "translation-result"))?.result.includes("Toolbar translation"), "native toolbar typed lookup");
  assert.equal((await panel(page)).hidden, true);
  const beforeClear = await saved();
  await evaluateTarget(toolbar, 'document.getElementById("library-view").value="page"; document.getElementById("library-view").dispatchEvent(new Event("change"))');
  assert.equal(await evaluateTarget(toolbar, 'document.getElementById("word-card").textContent'), "I am reading an article.");
  assert.equal(await evaluateTarget(toolbar, 'document.getElementById("save-words").hidden'), false);
  await evaluateTarget(toolbar, 'window.confirm=()=>false; document.getElementById("remove-words").click()');
  assert.deepEqual(await saved(), beforeClear);
  await evaluateTarget(toolbar, 'window.confirm=()=>true; document.getElementById("remove-words").click()');
  await until(async () => (await saved()).length === 0, "confirmed clear library");
  assert.equal(await evaluateTarget(toolbar, 'document.getElementById("word-card").textContent'), "I am reading an article.");
  await until(async () => await evaluateTarget(toolbar, '!document.getElementById("save-words").disabled'), "bulk save available");
  await evaluateTarget(toolbar, 'document.getElementById("save-words").click()');
  await until(async () => (await saved()).length === 1, "restore page deck to library");
  await worker.evaluate(savedWords => chrome.storage.local.set({ savedWords }), beforeClear);
  console.log("PASS This page deck, clear confirmation/cancellation, and bulk restoration");
  await evaluateTarget(toolbar, 'document.getElementById("scan-area").click()').catch(error => {
    if (!/closed|timed out|target/i.test(error.message)) throw error;
  });
  await until(async () => await page.locator("[data-easydic-scan]").count(), "scan after popup closes");
  assert.ok(!(await browserCDP.send("Target.getTargets", { filter: [{}] })).targetInfos.some(t => t.targetId === popupTarget.targetId));
  console.log("PASS real toolbar saved and typed results stay inline; only Scan area closes it");

  async function dragCanvas() {
    const rect = await page.locator("canvas").boundingBox();
    await page.mouse.move(rect.x + 2, rect.y + 2); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 2, rect.y + rect.height - 2, { steps: 8 }); await page.mouse.up();
    await until(async () => { const state = await panel(page); return state?.edit && !state.hidden && state.result; }, "real OCR", 55000);
    assert.match((await panel(page)).source, /Reading makes life better/i);
  }
  await dragCanvas();
  await click(page, ".edit");
  await shadow(page, "data-easydic-panel", function () { this.querySelector("textarea").value = "Corrected image text."; });
  await click(page, ".again"); await until(async () => (await panel(page))?.result.includes("Corrected image text"), "OCR correction");
  await worker.evaluate(id => chrome.tabs.setZoom(id, 1.25), tab.id); await pause(250);
  await page.locator("canvas").scrollIntoViewIfNeeded();
  await page.evaluate(() => { document.activeElement?.blur(); getSelection().removeAllRanges(); });
  await invoke("capture-area"); await dragCanvas();
  await worker.evaluate(id => chrome.tabs.setZoom(id, 1), tab.id); await page.evaluate(() => scrollTo(0, 0)); await pause(250);
  await page.evaluate(() => getSelection().removeAllRanges()); await invoke("capture-area");
  await page.mouse.move(800, 100); await page.mouse.down(); await page.mouse.move(1000, 220, { steps: 5 }); await page.mouse.up();
  await until(async () => (await panel(page))?.status.includes("No English text found"), "blank image error", 55000);
  await invoke("capture-area"); await page.evaluate(() => scrollTo(0, 100));
  await until(async () => !await page.locator("[data-easydic-scan]").count(), "scroll cancels scan");
  await page.evaluate(() => scrollTo(0, 0));
  console.log("PASS real local OCR, correction, 125% zoom, blank-image error, and scan cancellation");

  // Run viewport emulation after native capture checks: CDP-emulated resizing
  // does not resize the native tab surface used by captureVisibleTab.
  await page.setViewportSize({ width: 320, height: 480 });
  await select(page, "#one"); await invoke();
  await until(async () => (await panel(page))?.result, "small-screen result");
  const panelBounds = await page.locator("[data-easydic-panel]").boundingBox();
  assert.ok(panelBounds.x >= 0 && panelBounds.y >= 0 && panelBounds.x + panelBounds.width <= 320 && panelBounds.y + panelBounds.height <= 480);
  await page.keyboard.press("Escape");

  // A full-page extension view gives stable screenshots and precise interaction tests.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 450, height: 600 });
  popup.on("pageerror", error => errors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await until(async () => await popup.locator("#word-card").textContent() === "Legacy", "saved default in extension view");
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.equal(await popup.locator("#shortcut-key").textContent(), commands.find(c => c.name === "scan-area").shortcut);
  assert.equal(await popup.locator("#scan-shortcut-key").textContent(), commands.find(c => c.name === "capture-area").shortcut);
  assert.match(await popup.locator("#shortcut-diagnostic").textContent(), /Scan at .*received; sent to the page/);
  assert.equal(await popup.locator('[role="tab"]').count(), 0);
  assert.equal(await popup.locator("#shortcut-key").isVisible(), false);
  assert.equal(await popup.locator(".result-card").isVisible(), true);
  assert.equal(await popup.locator("#translation-result").textContent(), "");
  assert.equal(await popup.locator("#dictionary-search-input").evaluate(element => element.tagName), "INPUT");
  await popup.screenshot({ path: join(tmpdir(), "easydic-toolbar-light.png") });
  await popup.locator("#search-word").click();
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("Legacy"), "inline saved result");
  assert.equal((await panel(popup, "translation-result")).source, "Legacy");
  assert.equal((await panel(popup, "translation-result")).sourceHidden, true);
  assert.equal((await panel(popup, "translation-result")).save, "Saved ✓");
  assert.equal((await panel(popup, "translation-result")).removedControls, 0);
  assert.equal(await popup.evaluate(() => document.activeElement.id), "search-word");
  await popup.screenshot({ path: join(tmpdir(), "easydic-saved.png") });
  for (const control of ["next-word", "previous-word", "random-word"]) {
    await popup.locator(`#${control}`).click();
    assert.equal((await panel(popup, "translation-result")).hidden, true);
    assert.equal(await popup.locator(".result-card").isVisible(), true);
    await popup.locator("#search-word").click();
    await until(async () => !(await panel(popup, "translation-result"))?.hidden && (await panel(popup, "translation-result"))?.result, "explicit translation after navigation");
  }
  await popup.locator("#dictionary-search-input").fill("Hello");
  await popup.locator("#dictionary-search-input").press("Enter");
  await until(async () => (await panel(popup, "translation-result"))?.source === "Hello" && (await panel(popup, "translation-result"))?.result, "single-line Enter submits");
  assert.equal((await panel(popup, "translation-result")).sourceHidden, false);
  assert.equal(await popup.evaluate(() => document.activeElement.id), "dictionary-search-input");
  assert.equal(await popup.evaluate(() => document.body.scrollHeight <= document.body.clientHeight + 1 && document.querySelector("main").getBoundingClientRect().height < 590), true);
  await popup.locator("#next-word").click(); assert.equal((await panel(popup, "translation-result")).hidden, true);
  let selectedEntry = await popup.locator("#word-card").textContent();
  await popup.locator("#dictionary-search-input").fill("A word worth remembering.");
  await popup.locator("#dictionary-search-button").click();
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("worth remembering"), "typed result");
  assert.equal((await panel(popup, "translation-result")).source, "A word worth remembering.");
  assert.equal((await panel(popup, "translation-result")).sourceHidden, false);
  assert.equal(await popup.evaluate(() => document.activeElement.id), "dictionary-search-button");
  assert.equal(await popup.locator("[data-easydic-panel]").count(), 1);
  await click(popup, ".save", "translation-result");
  await until(async () => (await panel(popup, "translation-result"))?.save === "Saved ✓", "typed persistent save");
  assert.equal(await popup.locator("#word-card").textContent(), selectedEntry);
  assert.match(await popup.locator("#word-position").textContent(), /of 4/);
  assert.equal(await popup.locator("#dictionary-search-input").inputValue(), "A word worth remembering.");
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.screenshot({ path: join(tmpdir(), "easydic-result-dark.png") });
  await popup.evaluate(() => { document.body.scrollTop = 0; window.scrollTo(0, 0); });
  await popup.screenshot({ path: join(tmpdir(), "easydic-toolbar-dark.png") });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await popup.locator("#dictionary-search-input").fill("Slow obsolete popup result.");
  await popup.locator("#dictionary-search-button").click();
  await popup.locator("#next-word").click(); await pause(1300);
  assert.equal((await panel(popup, "translation-result")).hidden, true);
  assert.equal(await popup.locator("#dictionary-search-input").inputValue(), "Slow obsolete popup result.");
  selectedEntry = await popup.locator("#word-card").textContent();
  await popup.locator("#dictionary-search-input").fill("Slow superseded by entry.");
  await popup.locator("#dictionary-search-button").click();
  await popup.locator("#search-word").click();
  await until(async () => (await panel(popup, "translation-result"))?.source === selectedEntry && (await panel(popup, "translation-result"))?.result, "entry replaces typed operation");
  const entryResult = await panel(popup, "translation-result"); await pause(1300);
  assert.deepEqual(await panel(popup, "translation-result"), entryResult);
  await worker.evaluate(() => { failOnce = true; });
  await popup.locator("#dictionary-search-input").fill("Retry toolbar error.");
  await popup.locator("#dictionary-search-button").click();
  await until(async () => (await panel(popup, "translation-result"))?.status.includes("internet"), "inline error");
  await click(popup, ".retry", "translation-result");
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("Retry toolbar"), "inline retry");
  await popup.locator("#dictionary-search-input").fill("Long sentence with punctuation… ".repeat(35));
  await popup.locator("#dictionary-search-button").click();
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("Long sentence"), "long inline result");
  await popup.setViewportSize({ width: 320, height: 480 });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
  await popup.locator("#dictionary-search-input").fill("x".repeat(2001));
  assert.equal(await popup.locator("#dictionary-search-button").isDisabled(), true);
  assert.equal((await panel(popup, "translation-result")).hidden, true);
  await popup.setViewportSize({ width: 450, height: 600 });
  console.log("PASS equal columns, blank result reservation, Enter search, compact source/result, manual selection, focus retention, navigation, errors/retry, stale cancellation, and narrow/long/dark layouts");

  // Pronunciation in both toolbar sources, including keyboard activation.
  await popup.locator("#word-speaker").focus();
  let speechCount = await worker.evaluate(() => speechCalls.length);
  await popup.keyboard.press("Enter");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) > speechCount, "saved entry pronunciation");
  assert.equal(await worker.evaluate(() => speechCalls.at(-1).text), await popup.locator("#word-card").textContent());
  stops = await worker.evaluate(() => speechStops);
  await popup.locator("#next-word").click();
  await until(async () => (await worker.evaluate(() => speechStops)) > stops, "navigation stops saved entry speech");
  await popup.locator("#previous-word").click();
  await popup.locator("#dictionary-search-input").fill("Pronounce this phrase.");
  await popup.locator("#dictionary-search-button").click();
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("Pronounce"), "typed speech source");
  speechCount = await worker.evaluate(() => speechCalls.length);
  await click(popup, ".speaker", "translation-result");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) > speechCount, "typed result pronunciation");
  assert.equal(await worker.evaluate(() => speechCalls.at(-1).text), "Pronounce this phrase.");

  // Setting write failure keeps the confirmed state and permits a retry.
  await popup.evaluate(() => {
    globalThis.originalSettingSet = chrome.storage.local.set;
    chrome.storage.local.set = async () => { throw new Error("Simulated setting failure"); };
  });
  await popup.locator("#extension-toggle").click();
  await until(async () => (await popup.locator("#app-status").textContent()).includes("Could not save"), "toggle failure");
  assert.equal(await popup.locator("#extension-toggle").getAttribute("aria-checked"), "true");
  await popup.evaluate(() => { chrome.storage.local.set = originalSettingSet; });
  stops = await worker.evaluate(() => speechStops);
  await popup.locator("#extension-toggle").focus(); await popup.keyboard.press("Space");
  await until(async () => await popup.locator("#extension-toggle").getAttribute("aria-checked") === "false", "toggle off");
  await until(async () => (await worker.evaluate(() => speechStops)) > stops, "off stops speech");
  assert.equal((await panel(popup, "translation-result")).hidden, true);
  for (const id of ["dictionary-search-input", "dictionary-search-button", "search-word", "scan-area", "word-speaker"]) assert.equal(await popup.locator(`#${id}`).isDisabled(), true);
  assert.equal(await popup.locator("#next-word").isDisabled(), false);
  const requestsBeforeOff = await worker.evaluate(() => requests.length);
  const speechBeforeOff = await worker.evaluate(() => speechCalls.length);
  await page.bringToFront(); await select(page, "#one");
  assert.equal(await deliver(), "disabled");
  assert.equal(await invoke("capture-area"), "disabled");
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);
  const denied = await popup.evaluate(async () => {
    const results = [];
    for (const type of ["translate", "readImage", "startScan"]) results.push(await chrome.runtime.sendMessage({ target: "background", type, text: "Disabled text", id: type }));
    return results;
  });
  assert.ok(denied.every(result => !result.ok && /off/i.test(result.error)));
  const directPage = await worker.evaluate(async tabId => {
    const results = [];
    for (const type of ["invokeSelection", "beginScan", "showTranslation", "canScan"]) results.push(await chrome.tabs.sendMessage(tabId, { type, text: "Disabled text" }));
    return results;
  }, tab.id);
  assert.ok(directPage.every(result => result.status === "disabled"));
  const speechDenied = await popup.evaluate(() => new Promise(resolve => {
    const port = chrome.runtime.connect({ name: "pronunciation" });
    port.onMessage.addListener(result => { port.disconnect(); resolve(result); });
    port.postMessage({ text: "Do not speak while off" });
  }));
  assert.match(speechDenied.error, /off/);
  assert.equal(await worker.evaluate(() => requests.length), requestsBeforeOff);
  assert.equal(await worker.evaluate(() => speechCalls.length), speechBeforeOff);
  await popup.reload();
  await until(async () => !await popup.locator("#extension-toggle").isDisabled(), "off state after reopening");
  assert.equal(await popup.locator("#extension-toggle").getAttribute("aria-checked"), "false");
  assert.match(await popup.locator("#shortcut-diagnostic").textContent(), /EasyDic is off/);
  await popup.locator("#extension-toggle").click();
  await until(async () => await popup.locator("#extension-toggle").getAttribute("aria-checked") === "true", "toggle on");
  await page.bringToFront(); await select(page, "#one"); await invoke();
  await until(async () => !(await panel(page))?.hidden && (await panel(page))?.result, "enabled without page refresh");

  // A newer view owns speech; dismissing an older source must not stop it.
  speechCount = await worker.evaluate(() => speechCalls.length);
  await click(page, ".speaker");
  await until(async () => (await worker.evaluate(() => speechCalls.length)) > speechCount, "page speech before replacement");
  await popup.locator("#word-speaker").click();
  await until(async () => (await worker.evaluate(() => speechCalls.length)) > speechCount + 1, "toolbar replaces page speech");
  stops = await worker.evaluate(() => speechStops);
  await page.keyboard.press("Escape"); await pause(100);
  assert.equal(await worker.evaluate(() => speechStops), stops);
  await popup.reload();
  await until(async () => (await worker.evaluate(() => speechStops)) > stops, "closing toolbar document stops its speech");

  // Delayed voice discovery cannot speak after disabling, even if re-enabled.
  await worker.evaluate(() => { voiceMode = "delayed"; });
  speechCount = await worker.evaluate(() => speechCalls.length);
  await popup.locator("#word-speaker").click();
  await popup.locator("#extension-toggle").click();
  await until(async () => await popup.locator("#extension-toggle").getAttribute("aria-checked") === "false", "off during voice discovery");
  await popup.locator("#extension-toggle").click(); await pause(650);
  assert.equal(await worker.evaluate(() => speechCalls.length), speechCount);
  await worker.evaluate(() => { voiceMode = "normal"; });

  // Pending page and toolbar translations are both discarded on disable.
  await page.bringToFront();
  await page.locator("#slow").evaluate(element => { element.textContent = "Slow disabled page result."; });
  await select(page, "#slow"); await invoke();
  await popup.locator("#dictionary-search-input").fill("Slow disabled toolbar result.");
  await popup.locator("#dictionary-search-button").click();
  await until(async () => await worker.evaluate(() => requests.includes("Slow disabled toolbar result.")), "pending toolbar request");
  await popup.locator("#extension-toggle").click();
  await until(async () => (await panel(page))?.hidden && (await panel(popup, "translation-result"))?.hidden, "off closes all results");
  await popup.locator("#extension-toggle").click(); await pause(1300);
  assert.equal((await panel(page)).hidden, true);
  assert.equal((await panel(popup, "translation-result")).hidden, true);
  await page.bringToFront(); await invoke("capture-area");
  assert.equal(await page.locator("[data-easydic-scan]").count(), 1);
  await popup.locator("#extension-toggle").click();
  await until(async () => !await page.locator("[data-easydic-scan]").count(), "off removes scan selector");
  await popup.locator("#extension-toggle").click();
  // A prepared toolbar scan must not start after an Off/On cycle.
  await page.bringToFront();
  await popup.evaluate(() => new Promise((resolve, reject) => {
    globalThis.preparedScan = chrome.runtime.connect({ name: "scan-area" });
    preparedScan.onMessage.addListener(result => result.ok ? resolve() : reject(new Error(result.error)));
    preparedScan.postMessage({ type: "prepare" });
  }));
  await worker.evaluate(() => chrome.storage.local.set({ extensionEnabled: false }));
  await until(async () => await popup.locator("#extension-toggle").getAttribute("aria-checked") === "false", "off after scan preparation");
  await worker.evaluate(() => chrome.storage.local.set({ extensionEnabled: true }));
  await until(async () => await popup.locator("#extension-toggle").getAttribute("aria-checked") === "true", "on after scan preparation");
  await popup.evaluate(() => preparedScan.disconnect()); await pause(150);
  assert.equal(await page.locator("[data-easydic-scan]").count(), 0);

  // Hold an OCR response after capture so cancellation is deterministic.
  await worker.evaluate(() => {
    globalThis.originalRuntimeSend = chrome.runtime.sendMessage;
    globalThis.originalCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = async () => "data:image/png;base64,test";
    chrome.runtime.sendMessage = message => {
      if (message.target === "offscreen" && message.type === "readImage") {
        globalThis.ocrWaiting = true;
        return new Promise(resolve => { globalThis.finishOCR = () => resolve({ ok: true, text: "Discarded image result." }); });
      }
      return originalRuntimeSend(message);
    };
  });
  await page.bringToFront(); await invoke("capture-area");
  await page.mouse.move(20, 20); await page.mouse.down(); await page.mouse.move(100, 100, { steps: 4 }); await page.mouse.up();
  await until(async () => await worker.evaluate(() => globalThis.ocrWaiting), "OCR in flight");
  const beforeLateOCR = await worker.evaluate(() => requests.length);
  await popup.locator("#extension-toggle").click();
  await until(async () => (await panel(page))?.hidden, "off hides OCR progress");
  await popup.locator("#extension-toggle").click();
  await worker.evaluate(() => finishOCR()); await pause(200);
  assert.equal((await panel(page)).hidden, true);
  assert.equal(await worker.evaluate(() => requests.length), beforeLateOCR);
  await worker.evaluate(() => { chrome.runtime.sendMessage = originalRuntimeSend; chrome.tabs.captureVisibleTab = originalCapture; });
  console.log("PASS disabling prepared scans and discarding delayed OCR after re-enabling");

  // Restore the entry expected by the original persistence assertions.
  await until(async () => !await popup.locator("#next-word").isDisabled(), "library ready");
  while (await popup.locator("#word-card").textContent() !== selectedEntry) await popup.locator("#next-word").click();
  console.log("PASS toolbar speech, global toggle, failed writes, disabled entry points, cross-view cancellation, and late responses");

  const writes = await popup.evaluate(() => Promise.all([
    chrome.runtime.sendMessage({ target: "background", type: "saveWords", words: ["Concurrent one"] }),
    chrome.runtime.sendMessage({ target: "background", type: "saveWords", words: ["Concurrent two"] })
  ]));
  assert.ok(writes.every(result => result.ok));
  await until(async () => (await popup.locator("#word-position").textContent()).includes("of 6"), "live concurrent updates");
  assert.equal(await popup.locator("#word-card").textContent(), selectedEntry);
  await popup.locator("#help-toggle").click();
  await popup.evaluate(() => {
    chrome.commands.getAll = async () => [{ name: "scan-area", shortcut: "" }, { name: "capture-area", shortcut: "Alt+Shift+A" }]; window.dispatchEvent(new Event("focus"));
  });
  await until(async () => await popup.locator("#shortcut-key").textContent() === "Not assigned", "missing shortcut guidance");
  assert.equal(await popup.locator("#shortcut-notice").isVisible(), true);
  await popup.evaluate(() => {
    chrome.commands.getAll = async () => [{ name: "scan-area", shortcut: "Ctrl+Shift+Y" }, { name: "capture-area", shortcut: "Ctrl+Shift+Z" }]; window.dispatchEvent(new Event("focus"));
  });
  await until(async () => await popup.locator("#shortcut-key").textContent() === "Ctrl+Shift+Y", "custom shortcut display");
  assert.equal(await popup.locator("#shortcut-notice").isVisible(), false);
  assert.equal(await popup.locator("#scan-shortcut-key").textContent(), "Ctrl+Shift+Z");
  for (const colorScheme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme });
    assert.equal(await popup.locator("#help-panel").isVisible(), true);
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
    await popup.locator("#help-toggle").scrollIntoViewIfNeeded();
    await popup.screenshot({ path: join(tmpdir(), `easydic-help-${colorScheme}.png`) });
  }
  await popup.locator("#help-toggle").click();
  await popup.evaluate(() => {
    chrome.commands.getAll = async () => [{ name: "scan-area", shortcut: "Ctrl+Shift+Y" }, { name: "capture-area", shortcut: "" }]; window.dispatchEvent(new Event("focus"));
  });
  await until(async () => await popup.locator("#scan-shortcut-key").textContent() === "Not assigned", "missing scan shortcut");
  assert.match(await popup.locator("#shortcut-notice").textContent(), /Scanning shortcut not assigned/);
  const libraryBeforeEmpty = await saved();
  await worker.evaluate(() => chrome.storage.local.set({ savedWords: [] }));
  await until(async () => await popup.locator("#word-card").textContent() === "No saved entries yet", "empty library");
  assert.equal(await popup.locator("#search-word").isDisabled(), true);
  assert.equal(await popup.locator(".result-card").isVisible(), true);
  await popup.locator("#dictionary-search-input").fill("First saved word");
  await popup.locator("#dictionary-search-input").press("Enter");
  await until(async () => (await panel(popup, "translation-result"))?.result.includes("First saved word"), "typed lookup with empty library");
  await click(popup, ".save", "translation-result");
  await until(async () => await popup.locator("#word-card").textContent() === "First saved word", "first save populates left column");
  assert.equal((await panel(popup, "translation-result")).hidden, false);
  await worker.evaluate(savedWords => chrome.storage.local.set({ savedWords }), libraryBeforeEmpty);
  await page.reload();
  assert.ok((await saved()).includes("I am reading an article."));
  await popup.close();
  assert.deepEqual(errors, []);
  const expectedSaved = await saved();
  await worker.evaluate(() => chrome.storage.local.set({ extensionEnabled: false }));
  console.log("PASS simultaneous saves, shortcut assignment/remapping display, and page-refresh persistence");

  const version = context.browser().version();
  await context.close();
  context = await launch();
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const reopened = context.pages()[0] || await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await until(async () => await reopened.locator("#word-card").textContent() === "Legacy", "library after browser restart");
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("savedWords")).savedWords), expectedSaved);
  assert.match(await reopened.locator("#word-position").textContent(), /of 6/);
  await until(async () => !await reopened.locator("#extension-toggle").isDisabled(), "setting restored after browser restart");
  assert.equal(await reopened.locator("#extension-toggle").getAttribute("aria-checked"), "false");
  assert.equal(await reopened.locator("#search-word").isDisabled(), true);
  await reopened.locator("#extension-toggle").click();
  await until(async () => !await reopened.locator("#search-word").isDisabled(), "enabled after restart");
  console.log(`PASS browser-restart persistence · ${version} · all integration checks passed`);
  console.log("Native Windows/Linux shortcut key delivery is NOT verified by this suite.");
} catch (error) {
  for (const page of context?.pages() || []) console.error("DIAGNOSTIC", page.url(), await panel(page).catch(() => null));
  console.error("REQUESTS", await context?.serviceWorkers()[0]?.evaluate(() => globalThis.requests).catch(() => null));
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
  await rm(testFiles, { recursive: true, force: true });
}
