import { validateText } from "./translation.js";

// One worker per offscreen document, separate from OCR. Terminating it interrupts
// synchronous Wasm synthesis; a cancelled worker is never reused.
export class SpeechEngine {
  constructor({ createWorker = () => new Worker(chrome.runtime.getURL("speech-worker.js")), initTimeout = 30000, synthTimeout = 15000, idleTimeout = 60000 } = {}) {
    Object.assign(this, { createWorker, initTimeout, synthTimeout, idleTimeout });
    this.sequence = 0;
  }
  reset(error = new Error("Cancelled.")) {
    clearTimeout(this.idleTimer);
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.operation = null;
    this.initializing?.reject(error);
    this.pending?.reject(error);
    this.initializing = this.pending = null;
  }
  initialize() {
    if (this.ready) return this.ready;
    const worker = this.createWorker();
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => { this.initializing = { resolve, reject }; });
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      if (data.type === "error") { this.reset(new Error(data.error)); return; }
      if (data.type === "ready" && this.initializing) {
        clearTimeout(this.timer);
        this.initializing.resolve();
        this.initializing = null;
      }
      if (data.type === "samples" && data.id === this.pending?.id) {
        clearTimeout(this.timer);
        this.pending.resolve(data);
        this.pending = null;
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      if (this.worker === worker) this.reset(new Error("The offline English voice failed. Click the speaker to retry."));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.reset(new Error("Could not read pronunciation audio. Try again."));
    };
    this.timer = setTimeout(() => this.reset(new Error("The English voice took too long to load. Try again.")), this.initTimeout);
    const ready = this.ready;
    try { worker.postMessage({ type: "init" }); } catch (error) { this.reset(error); }
    return ready;
  }
  async synthesize(input, signal, onPhase = () => {}) {
    const text = validateText(input);
    signal.throwIfAborted();
    if (this.operation) this.reset();
    const operation = {};
    this.operation = operation;
    clearTimeout(this.idleTimer);
    const abort = () => { if (this.operation === operation) this.reset(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      onPhase(this.worker ? "synthesizing" : "initializing");
      await this.initialize();
      signal.throwIfAborted();
      onPhase("synthesizing");
      return await new Promise((resolve, reject) => {
        const id = ++this.sequence;
        this.pending = { id, resolve, reject };
        this.timer = setTimeout(() => this.reset(new Error("Pronunciation took too long. Try a shorter selection.")), this.synthTimeout);
        try { this.worker.postMessage({ type: "synthesize", id, text }); } catch (error) { this.reset(error); }
      });
    } finally {
      signal.removeEventListener("abort", abort);
      // A newer request may already own the worker after an abort.
      if (this.operation === operation) {
        this.operation = null;
        this.idleTimer = setTimeout(() => this.reset(), this.idleTimeout);
      }
    }
  }
}

export function pcmToWav(samples, sampleRate) {
  if (!(samples instanceof Int16Array) || !samples.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error("The English voice returned invalid audio. Try again.");
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return new Blob([buffer], { type: "audio/wav" });
}
