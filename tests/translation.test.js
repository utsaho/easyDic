import { test } from "node:test";
import assert from "node:assert/strict";
import { Translator, splitText, validateText, mergeWords } from "../translation.js";

const success = translatedText => ({ ok: true, status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText } }) });
function storage() {
  const data = {};
  return { data, get: async () => data, set: async value => Object.assign(data, structuredClone(value)) };
}

test("UTF-8 chunks respect limits without dropping Unicode, words, or punctuation", () => {
  for (const text of ["A sentence. ".repeat(150), "Here’s a sentence — with ‘quotes’. ".repeat(45), "বাংলা ".repeat(300), "😀".repeat(600), "x".repeat(1500)]) {
    const chunks = splitText(text);
    assert.ok(chunks.every(chunk => new TextEncoder().encode(chunk).length <= 500));
    assert.equal(chunks.join("").replace(/\s/gu, ""), text.replace(/\s/gu, ""));
    assert.ok(chunks.every(chunk => !chunk.includes("\uFFFD")));
  }
  assert.deepEqual(splitText("First sentence. Second longer sentence.", 25), ["First sentence.", "Second longer sentence."]);
});

test("empty and excessive selections are rejected; case is preserved", () => {
  assert.throws(() => validateText("  "), /Select some/);
  assert.throws(() => validateText("a".repeat(2001)), /2,000/);
  assert.equal(validateText(" The\nArticle’s TITLE! "), "The Article’s TITLE!");
  assert.equal(validateText("😀".repeat(2000)).length, 4000);
});

test("saved-word compatibility and deduplication preserve first-entry capitalization", () => {
  assert.deepEqual(mergeWords(["hello", "World", null], [" HELLO ", "My sentence.", "my sentence."]), ["hello", "World", "My sentence."]);
});

test("identical in-flight translations share one request and session cache survives recreation", async () => {
  const cache = storage();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get("langpair"), "en|bn");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    await new Promise(resolve => setTimeout(resolve, 10));
    return success("বাংলা");
  };
  const translator = new Translator({ fetcher, storage: cache });
  assert.deepEqual(await Promise.all([translator.translate("Hello"), translator.translate("Hello")]), ["বাংলা", "বাংলা"]);
  assert.equal(calls, 1);
  assert.equal(await new Translator({ fetcher, storage: cache }).translate("Hello"), "বাংলা");
  assert.equal(calls, 1);
});

test("retry reuses successful chunks after a partial failure", async () => {
  const calls = [];
  let fail = true;
  const translator = new Translator({ fetcher: async url => {
    const text = new URL(url).searchParams.get("q");
    calls.push(text);
    if (text.startsWith("B") && fail) { fail = false; throw new TypeError("offline"); }
    return success(text.startsWith("A") ? "প্রথম" : "দ্বিতীয়");
  } });
  const text = `${"A".repeat(450)}. ${"B".repeat(450)}.`;
  await assert.rejects(translator.translate(text), /internet/);
  assert.equal(await translator.translate(text), "প্রথম দ্বিতীয়");
  assert.equal(calls.filter(value => value.startsWith("A")).length, 1);
  assert.equal(calls.filter(value => value.startsWith("B")).length, 2);
});

test("cache is bounded to 100 successful chunks", async () => {
  const cache = storage();
  const translator = new Translator({ storage: cache, fetcher: async () => success("বাংলা") });
  for (let i = 0; i < 105; i++) await translator.translate(`word ${i}`);
  assert.equal(cache.data.translationCache.length, 100);
  assert.equal(translator.cache.has("word 0"), false);
});

test("quota, malformed response, HTTP failure, timeout and cancellation are actionable", async () => {
  const cases = [
    [async () => ({ ok: true, json: async () => ({ quotaFinished: true }) }), /allowance/],
    [async () => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: {} }) }), /No translation/],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }), /unreadable/],
    [async () => ({ ok: false, status: 429 }), /limit/],
    [async () => ({ ok: false, status: 503 }), /unavailable/],
    [async (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))), /timed out/]
  ];
  for (const [fetcher, pattern] of cases) {
    await assert.rejects(new Translator({ fetcher, timeout: 10 }).translate("test"), pattern);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new Translator({ fetcher: () => assert.fail("Should not fetch") }).translate("test", controller.signal), /abort/i);
});
