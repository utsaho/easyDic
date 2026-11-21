// Runs only inside the extension's dedicated pronunciation worker.
importScripts("vendor/speech/espeak.js");
let engine;
let sampleRate;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      engine = await createSpeechEngine({ locateFile: name => new URL(`vendor/speech/${name}`, self.location.href).href });
      sampleRate = engine._speech_init();
      if (!sampleRate) throw new Error("Could not initialize the English voice.");
      self.postMessage({ type: "ready" });
    } else if (data.type === "synthesize" && engine) {
      if (!engine.ccall("speech_synthesize", "number", ["string"], [data.text])) throw new Error("Could not pronounce this text. Try a shorter selection.");
      const start = engine._speech_pcm() / 2;
      const samples = engine.HEAP16.slice(start, start + engine._speech_length());
      self.postMessage({ type: "samples", id: data.id, sampleRate, samples }, [samples.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "The English voice could not start. Try again." });
  }
};
