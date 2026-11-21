import { SpeechEngine, pcmToWav } from "./speech.js";

// Audio lives in the extension document so article CSP and system voices do not affect it.
(() => {
  let active = null;
  const cancelled = new Set();
  const engine = new SpeechEngine();
  function play(message) {
    active?.finish(new Error("Cancelled."));
    if (cancelled.has(message.id)) return Promise.reject(new Error("Cancelled."));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const audio = document.createElement("audio");
      audio.dataset.pronunciation = message.id;
      audio.preload = "auto";
      document.body.append(audio);
      let objectURL;
      let timer;
      let settled = false;
      const heartbeat = setInterval(() => chrome.runtime.sendMessage({ target: "background", type: "pronunciationHeartbeat" }).catch(() => state.finish(new Error("Pronunciation was disconnected. Try again."))), 15000);
      const state = { id: message.id, finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        controller.abort();
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.remove();
        if (objectURL) URL.revokeObjectURL(objectURL);
        if (active === state) active = null;
        error ? reject(error) : resolve();
      } };
      active = state;
      audio.onended = () => state.finish();
      audio.onerror = () => state.finish(new Error("Could not play pronunciation. Check your browser audio output and try again."));
      audio.onplaying = () => {
        clearTimeout(timer);
        chrome.runtime.sendMessage({ target: "background", type: "pronunciationPlaying", id: message.id })
          .catch(() => state.finish(new Error("Pronunciation was disconnected. Try again.")));
      };
      (async () => {
        try {
          const { samples, sampleRate } = await engine.synthesize(message.text, controller.signal, status => {
            chrome.runtime.sendMessage({ target: "background", type: "pronunciationProgress", id: message.id, status }).catch(() => {});
          });
          if (settled) return;
          const blob = pcmToWav(samples, sampleRate);
          objectURL = URL.createObjectURL(blob);
          audio.src = objectURL;
          timer = setTimeout(() => state.finish(new Error("Pronunciation playback timed out. Try again.")), 10000);
          await audio.play();
        } catch (error) {
          if (settled) return;
          state.finish(error);
        }
      })();
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== "offscreen") return;
    if (message.type === "stopPronunciation") {
      cancelled.add(message.id);
      setTimeout(() => cancelled.delete(message.id), 60000);
      if (active?.id === message.id) active.finish(new Error("Cancelled."));
      respond({ ok: true });
    }
    if (message.type === "playPronunciation") {
      play(message).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
      return true;
    }
  });
})();
