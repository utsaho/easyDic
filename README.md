# EasyDic 2.0

Read English articles with Bangla translations in a small panel at the bottom right. Highlight a word, phrase, or sentence and release the mouse: EasyDic translates it without opening a tab or moving you away from the article. Keyboard text selection works too.

## Install or upgrade in Chrome / Brave

1. Keep this entire folder, including `assets` and `vendor`, in a permanent location. Extract ZIP downloads first.
2. Open `chrome://extensions` or `brave://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose this folder (containing `manifest.json`) and pin EasyDic in the browser toolbar.
4. Refresh webpages that were already open before installation.

For an upgrade, keep using the same folder and extension, click **Reload** on its extension card, and refresh webpages. Existing saved words and the lookup preference remain compatible. Do not uninstall to upgrade: uninstalling removes the extension's saved data. No Node.js installation, compilation, API key, or account is needed to use the extension.

## Translate while reading

- Drag to highlight English text, or double-click a word. After selection settles for about 350 ms, the bottom-right panel shows the English text and Bangla translation.
- The panel stays visible while you read and scroll. Click anywhere outside it, or press **Escape** or **×**, to close it. Clicks inside the panel keep it open. Selecting new text closes the old result and shows the new translation when selection finishes.
- **Copy translation** copies Bangla text. If clipboard access is unavailable on a page, select and copy the result manually.
- The checkbox beside **EasyDic** controls automatic translation. Search and image scanning remain available when it is off.
- Type or paste text in the toolbar popup to translate it on the page. On protected pages, or pages awaiting refresh after installation, the translation appears inside the popup instead.

Editable fields and selections inside EasyDic are ignored. Selections can contain up to **2,000 characters**. Longer selections show a message rather than being silently cut off.

## Scan text in an image

1. Press **Alt+Shift+X**, or open EasyDic and click **Scan area**.
2. Drag a box around visible, printed English text in an image or webpage.
3. EasyDic captures the visible tab, crops the selected region, reads it locally, and translates the extracted text in the panel.
4. If recognition is imperfect, click **Edit text**, correct the English text, and choose **Translate again**.

Escape, scrolling, resizing, or changing tabs cancels an active scan. Tiny rectangles are rejected. Clear, sufficiently large text works best; handwriting and low-resolution text may not be recognized accurately. Scan only the visible region, without scrolling during capture.

If another extension uses the shortcut, assign a different shortcut at `chrome://extensions/shortcuts` or `brave://extensions/shortcuts`. The popup button also works. Scanning requires an ordinary HTTP/HTTPS webpage with the content script loaded; browser settings pages, extension stores, built-in PDF viewers, and full-page stitched scans are outside this version.

## Save vocabulary explicitly

Translation never automatically adds vocabulary. Click **Save** in the result panel to save its English source text permanently and add it to the current page's session deck. Words, phrases, and sentences are supported; Bangla translations are not stored in the vocabulary library.

- **Prev / Next** cycle through the deck; **Random** picks a different entry when possible.
- The search icon translates the current entry on the page.
- **Load saved words** replaces the displayed deck with the permanent library.
- **Save all words** merges the current deck into the permanent library.
- **Clear saved words** clears the permanent library after confirmation. It leaves the current page's session deck available to save again.
- Reopening the popup returns to entries saved from the active page. Refreshing or closing that page clears its session deck, but keeps the permanent library.

Duplicates are compared case-insensitively. The first saved spelling, capitalization, and punctuation are retained. Each browser profile has its own library and preference; there is no cloud synchronization.

## Translation service and privacy

English-to-Bangla translation uses [MyMemory](https://mymemory.translated.net/). Only selected or extracted text is sent to its API; EasyDic does not send the article's URL or surrounding content. The provider processes that text under its own service terms. There is no analytics or tracking code in EasyDic.

MyMemory's documented anonymous allowance is **5,000 characters per day**, and each request supports at most **500 UTF-8 bytes**. EasyDic splits long selections at sentence or word boundaries and reassembles their translations in order. Free service availability and translation accuracy can vary. This provides translation, not a dictionary entry listing every meaning.

Successful translation chunks are cached for the browser session, up to 100 entries. Repeated text reuses that cache; retrying after a partial failure reuses completed chunks. The session cache clears on a browser restart. Uncached translation needs internet access. Quota exhaustion, timeouts, and connection errors are shown in the panel; no alternate service is used automatically.

Image reading uses bundled Tesseract.js and English recognition data. Screenshots and cropped images stay in temporary memory, are not uploaded, and are not saved to storage. The packaged OCR assets add approximately 15 MB. OCR scripts and language data are never fetched from a CDN at runtime.

References: [API specification](https://mymemory.translated.net/doc/spec.php), [usage limits](https://mymemory.translated.net/doc/usagelimits.php), [provider terms](https://mymemory.translated.net/terms-and-conditions).

## Permissions and implementation

- `storage`: persistent vocabulary/preference and temporary translation cache.
- `activeTab`: user-invoked visible-tab capture for scanning.
- `offscreen`: a hidden extension document for local OCR and image cropping; it opens no visible window or tab.
- `https://api.mymemory.translated.net/*`: translation requests from the background service worker.
- Content scripts run on ordinary HTTP/HTTPS top-level documents. OCR can capture visible embedded image/text regions, but automatic text selection inside nested frames is not supported.

The extension uses Manifest V3 and plain JavaScript. `content.js` handles selection and scanning, `panel.js` provides the shared translation interface, `background.js` coordinates messaging and storage, `translation.js` handles translation/chunking/cache, and `offscreen.js` runs OCR. No hosted backend is required. Minimum declared Chromium version: 116; use a current desktop Chrome or Brave release.

## Development and checks

After source edits, reload the extension and refresh test pages. Runtime OCR files are already bundled; development dependencies are only needed for browser tests.

```sh
npm test
npm install --ignore-scripts
npx playwright install chromium
npm run test:browser
```

The unit suite checks UTF-8 chunking, input limits, vocabulary compatibility, request deduplication, cache persistence/eviction, partial retries, and errors. The browser suite uses an isolated profile and a local article, with mocked translation responses and real bundled OCR, so it does not consume the translation allowance. It exercises selection, saving, cancellation, scan capture, correction, responsive layout, and popup fallback. Set `BROWSER_EXECUTABLE` to a compatible Chrome for Testing or Brave executable to test a particular browser; `HEADED=1` enables a visible test window. It never uses your normal browser profile.

Third-party versions, license notices, and checksums are in `vendor/ocr/`. See `THIRD_PARTY_NOTICES.md` for attribution.
