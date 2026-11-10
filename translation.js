export const MAX_CHARACTERS = 2000;
const encoder = new TextEncoder();

export function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

export function validateText(value) {
  const text = normalizeText(value);
  if (!text) throw new Error("Select some English text first.");
  if ([...text].length > MAX_CHARACTERS) {
    throw new Error("Select less text — the limit is 2,000 characters.");
  }
  return text;
}

// Prefer sentence endings, then word boundaries. Never split a Unicode code point.
export function splitText(value, byteLimit = 500) {
  let remaining = validateText(value);
  const chunks = [];
  while (encoder.encode(remaining).length > byteLimit) {
    let prefix = "";
    let bytes = 0;
    for (const character of remaining) {
      bytes += encoder.encode(character).length;
      if (bytes > byteLimit) break;
      prefix += character;
    }
    if (!prefix) throw new Error("The translation chunk limit is too small.");
    const sentences = [...prefix.matchAll(/[.!?][”’"']?\s+/gu)];
    const sentence = sentences.at(-1);
    const wordBoundary = prefix.lastIndexOf(" ");
    const end = sentence ? sentence.index + sentence[0].length
      : wordBoundary > 0 ? wordBoundary + 1 : prefix.length;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function mergeWords(...lists) {
  const seen = new Set();
  return lists.flatMap(list => Array.isArray(list) ? list : []).filter(value => {
    const text = normalizeText(value);
    const key = text.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(normalizeText);
}

export class Translator {
  constructor({ fetcher = fetch, storage, timeout = 10000 } = {}) {
    this.fetcher = fetcher;
    this.storage = storage;
    this.timeout = timeout;
    this.cache = new Map();
    this.inflight = new Map();
    this.persist = Promise.resolve();
    this.ready = this.restore();
  }

  async restore() {
    try {
      const { translationCache } = await this.storage?.get("translationCache") || {};
      for (const entry of Array.isArray(translationCache) ? translationCache.slice(-100) : []) {
        if (Array.isArray(entry) && entry.length === 2 && entry.every(v => typeof v === "string")) {
          this.cache.set(...entry);
        }
      }
    } catch { /* Cache failure must not prevent translation. */ }
  }

  async translate(value, signal) {
    const chunks = splitText(value);
    const translations = [];
    await this.ready;
    for (const chunk of chunks) {
      signal?.throwIfAborted();
      translations.push(await this.chunk(chunk));
      signal?.throwIfAborted();
    }
    return translations.join(" ");
  }

  async chunk(text) {
    if (this.cache.has(text)) return this.cache.get(text);
    if (this.inflight.has(text)) return this.inflight.get(text);
    const promise = this.request(text).then(async translation => {
      this.cache.set(text, translation);
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      const snapshot = [...this.cache];
      this.persist = this.persist.catch(() => {}).then(() =>
        this.storage?.set({ translationCache: snapshot })).catch(() => {});
      await this.persist;
      return translation;
    }).finally(() => this.inflight.delete(text));
    this.inflight.set(text, promise);
    return promise;
  }

  async request(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text);
      url.searchParams.set("langpair", "en|bn");
      const response = await this.fetcher(url.href, {
        signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer"
      });
      if (response.status === 429) throw new Error("Translation limit reached. Please try again later.");
      if (!response.ok) throw new Error("Translation service is unavailable. Please retry.");
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The translation service returned an unreadable response. Please retry."); }
      if (data.quotaFinished || Number(data.responseStatus) === 429 || Number(data.responseStatus) === 403) {
        throw new Error("MyMemory's free translation allowance is exhausted. Please try again tomorrow.");
      }
      if (Number(data.responseStatus) !== 200 || typeof data.responseData?.translatedText !== "string" ||
          !data.responseData.translatedText.trim()) {
        throw new Error("No translation was returned. Please retry or select different text.");
      }
      return data.responseData.translatedText.trim();
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Translation timed out. Please retry.");
      if (error instanceof TypeError) throw new Error("Could not connect. Check your internet connection and retry.");
      throw error;
    } finally { clearTimeout(timer); }
  }
}
