// Real packaged engine and browser audio, with the browser network disabled.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const profile = await mkdtemp(join(tmpdir(), "easydic-offline-audio-"));
let context;
try {
  const extension = resolve(import.meta.dirname, "..");
  context = await chromium.launchPersistentContext(profile, {
    headless: process.env.HEADED !== "1", channel: process.env.BROWSER_EXECUTABLE ? undefined : "chromium",
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-first-run", "--disable-component-update"]
  });
  await context.setOffline(true);
  const external = [];
  context.on("request", request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await context.route(/^https?:/, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 20000 });
  const id = new URL(worker.url()).hostname;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ savedWords: ["Hello, world!"] });
    globalThis.played = false;
    chrome.runtime.onMessage.addListener(message => { if (message.type === "pronunciationPlaying") globalThis.played = true; });
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const corpus = ["hello", "world", "pronunciation", "queue", "rhythm", "through", "though", "thought", "tough", "colonel", "entrepreneur", "ubiquitous", "serendipity", "antidisestablishmentarianism", "electroencephalogram", "can't", "it's", "children's", "state-of-the-art", "co-operate", "NASA", "HTML", "CPU", "2026", "3.14", "£25.50", "Brave", "Parrot", "Utsho", "Bangladesh", "OpenAI", "déjà vu", "naïve", "Hello, world!", "What is your name?", "I am reading an article.", "The quick brown fox jumps over the lazy dog.", "Read this sentence; then pause—and continue.", "Speak clearly. ".repeat(133).trim()];
  const results = await page.evaluate(async corpus => {
    const { SpeechEngine, pcmToWav } = await import("./speech.js");
    const engine = new SpeechEngine();
    const results = [];
    try {
      for (const text of corpus) {
        const started = performance.now();
        const { samples, sampleRate } = await engine.synthesize(text, new AbortController().signal);
        const blob = pcmToWav(samples, sampleRate);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        results.push({ text: text.slice(0, 60), samples: samples.length, sampleRate, peak, bytes: blob.size, ms: Math.round(performance.now() - started) });
      }
      return results;
    } finally { engine.reset(); }
  }, corpus);
  for (const result of results) {
    assert.equal(result.sampleRate, 22050);
    assert.ok(result.samples > 1000 && result.peak > 100, `Non-silent speech: ${result.text}`);
    assert.equal(result.bytes, 44 + result.samples * 2);
  }
  console.log(`PASS ${results.length} offline synthesis cases, including ${corpus.at(-1).length} characters; longest synthesis ${Math.max(...results.map(r => r.ms))} ms`);
  await page.locator("#word-speaker").click();
  const deadline = Date.now() + 45000;
  let completed = false;
  while (Date.now() < deadline) {
    const status = await page.locator("#word-speech-status").textContent();
    if (await page.locator("#word-speech-status").evaluate(element => element.classList.contains("error"))) throw new Error(status);
    if (await worker.evaluate(() => played) && status === "") { completed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(completed, "Offline speech should decode, play and end");
  assert.deepEqual(external, [], "Pronunciation must not make external requests");
  console.log("PASS real offline speaker playback and completion without external requests");
  console.log("Physical speaker output and Parrot OS playback require a check on that system.");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
