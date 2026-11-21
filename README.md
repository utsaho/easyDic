# EasyDic 2.2.1

Read English articles with Bangla translations without leaving the page. Select a word, phrase, or sentence, then press your EasyDic translation shortcut (**Ctrl+Shift+X** on Linux; **Alt+Shift+X** on macOS and Windows) to translate it in a small bottom-right panel. Selecting, copying, and dragging text alone behave normally and never request a translation. Searches started in the toolbar stay inside the toolbar.

## Install or upgrade in Chrome / Brave

1. Keep this entire folder, including `assets` and `vendor`, in a permanent location. Extract ZIP downloads first.
2. Open `chrome://extensions` or `brave://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose this folder (containing `manifest.json`) and pin EasyDic in the browser toolbar.
4. Refresh webpages that were already open before installation.

For an upgrade, keep using the same folder and extension, click **Reload** on its extension card, and refresh webpages. Existing saved words remain intact. The old automatic-translation preference is still ignored. The new On / Off switch has its own setting and starts On after an upgrade. Do not uninstall to upgrade: uninstalling removes the extension's saved data. No Node.js installation, compilation, API key, or account is needed to use the extension.

## Translate while reading

- Select English text with the mouse or keyboard, then press **Ctrl+Shift+X** on Linux or **Alt+Shift+X** on macOS/Windows (or your assigned shortcut). Selection alone does nothing in EasyDic.
- The bottom-right panel shows a muted English source and a larger Bangla translation. Translation does not change the article's scroll position or keyboard focus.
- Click outside the panel, press **Escape**, or use **×** to close it. Clicks inside keep it open. Scrolling keeps completed results visible. A dismissed result cannot reopen when a delayed request finishes.
- Selecting another passage closes the old result. Press the shortcut again to translate the new selection. Repeating the shortcut for the same pending text does not send duplicate requests.
- **Save** stores the English source. To copy a translation, select its text and use your usual copy shortcut or context menu. Translation-service and privacy information is available in toolbar **Help**; result views contain no Copy or Information buttons.

Editable fields and selections inside EasyDic are excluded from article-text lookup. Selections can contain up to **2,000 characters**. Longer selections show an error rather than being silently cut off. With no eligible article text selected, the translation shortcut does nothing, including leaving an existing result unchanged. The scan shortcut starts scanning independently.

## Hear English pronunciation

Click the speaker beside English text in a page result, toolbar search result, or saved vocabulary card to hear the full word, phrase, or sentence. Clicking or selecting the result text does not start speech. Click the speaker again to replay from the beginning. Closing or changing the source result, navigating saved entries, or closing its page/toolbar stops that pronunciation.

Pronunciation uses a local English speech voice through the browser, preferring US English at normal speed. No external speech service is used. If no local English voice is available, install one through your operating system's speech settings and try again. A speech error leaves the translation available.

## Turn EasyDic on or off

Use **On / Off** in the toolbar header to pause or resume EasyDic across all tabs in this browser profile. Off disables both shortcuts, scanning, toolbar translation, and pronunciation. It closes results and scan selectors, cancels pending requests, and stops speech. Already-running OCR may finish internally, but its result is discarded. Saved vocabulary browsing, library management, and Help remain available.

The setting survives popup reopening and browser restarts. Turning On works on already-loaded webpages without refreshing them and does not restart cancelled work. This pauses EasyDic's features; the extension stays installed and the toolbar remains accessible.

## Use the toolbar

The toolbar is **450 px wide**, with a single-line English search above two equal-width cards. The left card shows the saved English entry, count, and **Translate entry** button. The right card starts blank and displays Bangla after an explicit translation. **Previous / Random / Next** stay below both cards. **All saved entries** is selected when opened, including after a page refresh or browser restart.

Ordinary word lookups fit without an outer scrollbar, targeting a content height below 590 px. The browser caps toolbar popups at 600 px. Long text, expanded Help, or a smaller viewport can still scroll so no content is clipped. Actual shortcut assignments and troubleshooting are available inside **Help**.

- Type an English word and click **Translate** or press **Enter**. The single-line input also accepts phrases and sentences up to 2,000 characters.
- **Previous / Random / Next** navigate saved vocabulary. Click **Translate entry** to translate the displayed saved entry.
- Both actions use the right-hand result card. Saved-entry translations omit the repeated English source; typed searches show their source above Bangla. **Save** stores that result's English source. The empty right column stays reserved when a result is cleared.
- Browsing vocabulary preserves your typed input. Changing the input, entry, or library view clears the old result and cancels obsolete operations; navigation does not translate automatically.
- Choose **This page** to review entries saved from the current page's session. **Save this page's entries** merges that deck into the permanent library. Refreshing or closing the page clears its session deck.
- **Clear library** clears permanent entries after confirmation. The current page's session deck remains available to save again.

**All toolbar translations stay in the open toolbar**, including saved-entry lookups, loading, errors, retries, and saving. They never open a page panel or another tab. Toolbar translation also works on protected pages where article panels cannot run. The browser still closes its toolbar popup normally when you click outside it. Only **Scan area** intentionally closes the toolbar before opening the page selector.

## Scan text in an image

1. Press **Ctrl+Shift+E** on Linux or **Alt+Shift+A** on macOS/Windows (or your assigned scan shortcut), or open EasyDic and click **Scan area**. Both always scan, even when article text is selected.
2. Drag a box around visible, printed English text in an image or webpage.
3. EasyDic captures the visible tab, crops the selected region, reads it locally, and translates the extracted text in the bottom-right panel.
4. If recognition is imperfect, click **Edit text**, correct the English text, and choose **Translate again**.

Escape, scrolling, resizing, or changing tabs cancels an active scan. Tiny rectangles are rejected. Clear, sufficiently large text works best; handwriting and low-resolution text may not be recognized accurately. Scan only the visible region, without scrolling during capture.

Scanning requires an ordinary HTTP/HTTPS webpage with the content script loaded. Browser settings pages, extension stores, built-in PDF viewers, and full-page stitched scans are outside this version.

## Shortcut setup and troubleshooting

Toolbar **Help** displays **both actual assigned shortcuts** from the browser, including custom remappings. Defaults:

| Action | Linux | macOS / Windows |
| --- | --- | --- |
| Translate selected text | Ctrl+Shift+X | Alt+Shift+X |
| Scan image area | Ctrl+Shift+E | Alt+Shift+A |

The existing `scan-area` command identifier means **Translate selected text** and `capture-area` handles scanning. Existing assignments are never overwritten. After upgrading on Linux, **open `brave://extensions/shortcuts` and manually replace any old Alt+Shift assignments** with Ctrl+Shift+X and Ctrl+Shift+E. Reload EasyDic and refresh open articles. A browser may also leave a conflicting shortcut unassigned.

If a shortcut shows **Not assigned**, open `chrome://extensions/shortcuts` or `brave://extensions/shortcuts` and assign the keys above, or choose other available keys. On Parrot OS, check the desktop's keyboard shortcuts if a combination never reaches Brave. Brave's own custom shortcuts at `brave://settings/system/shortcuts` may also claim the same keys.

Help also shows the **last shortcut event** and time, stored only for the current browser session without selected text. After trying a shortcut on a webpage, reopen Help:

1. If no new event appears, confirm the assigned keys in Brave, then check Brave's own shortcuts, competing extensions, and Parrot OS keyboard shortcuts. Alt+Shift may switch input language on Linux.
2. If it says **no selected article text found**, select text on an ordinary webpage and retry. Editable fields and embedded frames are excluded.
3. If it says **page unavailable**, reload EasyDic and refresh the article. Protected browser pages cannot host the panel or scanner; use the toolbar's English input there.

**Scan area** is also available in the toolbar. Both shortcuts use the browser Commands API, which grants temporary tab access for capture; there is no page-level listener pretending to handle the browser shortcut. Browser or OS conflicts can still prevent delivery, and a system-reserved shortcut cannot be overridden. See [Chrome Commands](https://developer.chrome.com/docs/extensions/reference/api/commands) and [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## Save vocabulary explicitly

Translation never automatically adds vocabulary. **Save** in either result view uses the same background storage handler and writes the English source to `chrome.storage.local.savedWords`. Page-panel saves also add the entry to the current page's session deck. Bangla translations are not stored in the vocabulary library.

The button shows **Saving…**, then **Saved ✓** only after a successful write. A failed save shows an error and remains available to retry. Already-saved entries show Saved ✓. An open library refreshes when saved storage changes, preserving the current entry when it still exists.

Duplicates are compared case-insensitively. The first saved spelling, capitalization, and punctuation are retained. Existing string-array vocabulary remains compatible; no migration is needed. Each browser profile has its own local library; there is no cloud synchronization.

## Translation service and privacy

English-to-Bangla translation uses [MyMemory](https://mymemory.translated.net/). Only text you explicitly submit, select for translation, or extract through scanning is sent to its API; EasyDic does not send the article's URL or surrounding content. The provider processes that text under its own service terms. There is no analytics or tracking code in EasyDic.

MyMemory's documented anonymous allowance is **5,000 characters per day**, and each request supports at most **500 UTF-8 bytes**. EasyDic splits long selections at sentence or word boundaries and reassembles their translations in order. Free service availability and translation accuracy can vary. This provides translation, not a dictionary entry listing every meaning.

Successful translation chunks are cached for the browser session, up to 100 entries. Repeated text reuses that cache; retrying after a partial failure reuses completed chunks. The session cache clears on a browser restart. Uncached translation needs internet access. Quota exhaustion, timeouts, and connection errors are shown in the panel; no alternate service is used automatically.

Image reading uses bundled Tesseract.js and English recognition data. Screenshots and cropped images stay in temporary memory, are not uploaded, and are not saved to storage. The packaged OCR assets add approximately 15 MB. OCR scripts and language data are never fetched from a CDN at runtime.

References: [API specification](https://mymemory.translated.net/doc/spec.php), [usage limits](https://mymemory.translated.net/doc/usagelimits.php), [provider terms](https://mymemory.translated.net/terms-and-conditions).

## Permissions and implementation

- `storage`: persistent vocabulary, the On / Off preference, and temporary translation cache.
- `tts`: pronunciation using local English speech voices.
- `activeTab`: user-invoked visible-tab capture for scanning.
- `offscreen`: a hidden extension document for local OCR and image cropping; it opens no visible window or tab.
- `https://api.mymemory.translated.net/*`: translation requests from the background service worker.
- Content scripts run on ordinary HTTP/HTTPS top-level documents. OCR can capture visible embedded image/text regions, but shortcut lookup of selections inside nested frames is not supported.

The extension uses Manifest V3 and plain JavaScript. `controls.js` shares enabled state and speaker controls, `content.js` handles selection and scanning, `panel.js` provides the shared translation interface, `background.js` coordinates messaging and storage, `translation.js` handles translation/chunking/cache, and `offscreen.js` runs OCR. No hosted backend is required. Minimum declared Chromium version: 116; use a current desktop Chrome or Brave release.

## Development and checks

After source edits, reload the extension and refresh test pages. Runtime OCR files are already bundled; development dependencies are only needed for browser tests.

```sh
npm test
npm install --ignore-scripts
npx playwright install chromium
npm run test:browser
```

The unit suite also verifies request cancellation and safe retries after disabling. The browser suite verifies speaker-only pronunciation with mocked speech, voice failures, replay and cancellation, persistent enabled state, disabled entry points, failed setting writes, and late responses. Actual audible output still needs a manual check with an installed local English voice.

The unit suite checks UTF-8 chunking, input limits, vocabulary compatibility, request deduplication, cache persistence/eviction, partial retries, and errors. The browser suite uses an isolated profile and a local article, with mocked translation responses and real bundled OCR, so it does not consume the translation allowance. It exercises passive selection, separate translation/scanning command routing, no-selection behavior, real toolbar lookups staying inline, shared result sources, saved-entry navigation, manual result selection, save failures and retries, concurrent writes, page-refresh/browser-restart persistence, scan capture, OCR correction, cancellation, and equal-width light/dark cards with empty libraries, Enter submission, no outer scrollbar for ordinary words, narrow viewports, and long results. It also checks selected text when an input retains focus and the session-only shortcut diagnostic. A disposable extension copy exposes the production command router to the tests; translation responses are mocked, while capture and OCR are real. Set `BROWSER_EXECUTABLE` to a compatible Chrome for Testing or Brave executable to test a particular browser; `HEADED=1` enables a visible test window. It never uses your normal browser profile.

**Native shortcut delivery on Parrot OS remains unverified in this macOS workspace.** Routing tests and simulated browser input do not establish that Ctrl+Shift+X or Ctrl+Shift+E reaches Brave on Linux. Actual keypress checks on Parrot OS Brave are still required.

Third-party versions, license notices, and checksums are in `vendor/ocr/`. See `THIRD_PARTY_NOTICES.md` for attribution.
