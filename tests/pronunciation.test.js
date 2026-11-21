import test from "node:test";
import assert from "node:assert/strict";
import { SpeechEngine, pcmToWav } from "../speech.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const workers = [];
  const engine = new SpeechEngine({
    createWorker: () => {
      const worker = { messages: [], terminated: false,
        postMessage(message) { this.messages.push(message); },
        terminate() { this.terminated = true; },
        send(data) { this.onmessage({ data }); }
      };
      workers.push(worker);
      return worker;
    }, ...options
  });
  return { engine, workers };
}
const samples = { type: "samples", id: 1, samples: new Int16Array([0, -32768, 32767]), sampleRate: 22050 };

test("PCM produces a standard mono little-endian WAV", async () => {
  const blob = pcmToWav(samples.samples, samples.sampleRate);
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  assert.equal(blob.type, "audio/wav");
  assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
  assert.throws(() => pcmToWav(new Int16Array(), 22050), /invalid audio/);
});

test("initializes lazily, preserves text, reuses worker and releases it when idle", async () => {
  const { engine, workers } = setup({ idleTimeout: 10 });
  assert.equal(workers.length, 0);
  const phases = [];
  const job = engine.synthesize("  It's NASA's state-of-the-art\nengine! ", new AbortController().signal, p => phases.push(p));
  workers[0].send({ type: "ready" }); await tick();
  assert.equal(workers[0].messages[1].text, "It's NASA's state-of-the-art engine!");
  workers[0].send(samples); assert.equal((await job).sampleRate, 22050);
  const next = engine.synthesize("Hello", new AbortController().signal); await tick();
  assert.equal(workers.length, 1);
  workers[0].send({ ...samples, id: 2 }); await next;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(phases, ["initializing", "synthesizing"]);
});

for (const stage of ["initializing", "synthesizing"]) {
  test(`abort during ${stage} terminates worker, ignores late messages, and permits retry`, async () => {
    const { engine, workers } = setup();
    const controller = new AbortController();
    const job = engine.synthesize("Hello", controller.signal);
    if (stage === "synthesizing") { workers[0].send({ type: "ready" }); await tick(); }
    const rejected = assert.rejects(job, { name: "AbortError" });
    controller.abort(); await rejected;
    assert.equal(workers[0].terminated, true);
    const retry = engine.synthesize("World", new AbortController().signal);
    workers[0].send({ type: "error", error: "obsolete" });
    workers[1].send({ type: "ready" }); await tick();
    workers[1].send({ ...samples, id: workers[1].messages[1].id });
    await retry; engine.reset();
  });
}

test("worker failure and initialization/synthesis timeouts can be retried", async () => {
  const { engine, workers } = setup({ initTimeout: 10, synthTimeout: 10 });
  await assert.rejects(engine.synthesize("Hello", new AbortController().signal), /too long to load/);
  const job = engine.synthesize("Hello", new AbortController().signal);
  workers.at(-1).send({ type: "ready" });
  await assert.rejects(job, /Pronunciation took too long/);
  const failure = engine.synthesize("Hello", new AbortController().signal);
  workers.at(-1).onerror({ preventDefault() {} });
  await assert.rejects(failure, /offline English voice failed/);
  const retry = engine.synthesize("Hello", new AbortController().signal);
  workers.at(-1).send({ type: "ready" }); await tick();
  workers.at(-1).send({ ...samples, id: workers.at(-1).messages[1].id });
  await retry; engine.reset();
});

test("rejects invalid and oversized input without starting a worker", async () => {
  const { engine, workers } = setup();
  for (const input of ["", "  ", null, "a".repeat(2001)]) {
    await assert.rejects(engine.synthesize(input, new AbortController().signal));
  }
  assert.equal(workers.length, 0);
});

test("replacement owns the worker even if the obsolete caller aborts immediately", async () => {
  const { engine, workers } = setup();
  const old = new AbortController();
  const first = engine.synthesize("First", old.signal);
  const rejected = assert.rejects(first, /Cancelled/);
  const second = engine.synthesize("Second", new AbortController().signal);
  old.abort();
  workers[1].send({ type: "ready" }); await tick();
  workers[1].send({ ...samples, id: workers[1].messages[1].id });
  await second; await rejected;
  assert.equal(workers[1].terminated, false);
  engine.reset();
});
