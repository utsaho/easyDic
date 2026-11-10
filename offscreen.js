let worker;
let workerCreation;
let workerGeneration = 0;
let queue = Promise.resolve();
let idleTimer;
const cancelled = new Set();

async function getWorker() {
  if (worker) return worker;
  if (!workerCreation) {
    const generation = workerGeneration;
    const creation = Tesseract.createWorker("eng", 1, {
      workerPath: chrome.runtime.getURL("vendor/ocr/worker.min.js"),
      corePath: chrome.runtime.getURL("vendor/ocr/core"),
      langPath: chrome.runtime.getURL("vendor/ocr/lang"),
      workerBlobURL: false, legacyCore: false, legacyLang: false,
      cacheMethod: "none"
    }).then(async created => {
      if (generation !== workerGeneration) {
        await created.terminate();
        throw new Error("Image reader was reset. Please scan again.");
      }
      worker = created;
      return created;
    }).finally(() => { if (workerCreation === creation) workerCreation = null; });
    workerCreation = creation;
  }
  return workerCreation;
}

async function releaseWorker() {
  workerGeneration++;
  const instance = worker;
  worker = null;
  workerCreation = null;
  if (instance) await instance.terminate();
}

async function readImage(message) {
  clearTimeout(idleTimer);
  if (cancelled.has(message.id)) {
    message.screenshot = null;
    cancelled.delete(message.id);
    throw new Error("Scan cancelled.");
  }
  // Offscreen messages keep the service worker alive during slower OCR jobs.
  const heartbeat = setInterval(() => {
    chrome.runtime.sendMessage({ target: "background", type: "ocrHeartbeat" }).catch(() => {});
  }, 15000);
  let bitmap;
  let canvas;
  let timeout;
  try {
    const blob = await (await fetch(message.screenshot)).blob();
    message.screenshot = null;
    bitmap = await createImageBitmap(blob);
    const { rect, viewport } = message;
    const scaleX = bitmap.width / viewport.width;
    const scaleY = bitmap.height / viewport.height;
    const x = Math.max(0, Math.floor(rect.x * scaleX));
    const y = Math.max(0, Math.floor(rect.y * scaleY));
    const width = Math.min(bitmap.width - x, Math.ceil(rect.width * scaleX));
    const height = Math.min(bitmap.height - y, Math.ceil(rect.height * scaleY));
    if (width < 1 || height < 1 || width * height > 24000000) throw new Error("Select a smaller, readable image area.");
    canvas = document.createElement("canvas");
    // Modest upscaling improves small printed text without unbounded memory use.
    const upscale = width < 1000 && height < 600 ? 2 : 1;
    canvas.width = width * upscale;
    canvas.height = height * upscale;
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    bitmap.close(); bitmap = null;
    const recognition = (async () => {
      const instance = await getWorker();
      if (cancelled.has(message.id)) throw new Error("Scan cancelled.");
      await instance.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
      const result = await instance.recognize(canvas);
      if (cancelled.has(message.id)) throw new Error("Scan cancelled.");
      const text = result.data.text.replace(/\s+/gu, " ").trim();
      if (!text) throw new Error("No English text found. Select a clearer or larger text area.");
      return text;
    })();
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        cancelled.add(message.id);
        releaseWorker().catch(() => {});
        reject(new Error("Image reading timed out. Try a smaller or clearer area."));
      }, 45000);
    });
    return await Promise.race([recognition, timedOut]);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    message.screenshot = null;
    cancelled.delete(message.id);
    idleTimer = setTimeout(() => { releaseWorker().catch(() => {}); }, 60000);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen") return;
  if (message.type === "cancelOCR") {
    cancelled.add(message.id);
    // Let an active recognition settle and discard its result; destroying a worker
    // mid-recognition leaves Tesseract's pending promise unresolved.
    setTimeout(() => cancelled.delete(message.id), 60000);
    respond({ ok: true });
    return;
  }
  if (message.type !== "readImage") return;
  const job = queue.catch(() => {}).then(() => readImage(message));
  queue = job;
  job.then(text => respond({ ok: true, text }), error => respond({ ok: false, error: error.message }));
  return true;
});
