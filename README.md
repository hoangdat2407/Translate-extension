# WordDeck Translator

Version: v1.0.11 — Gemini retry + fallback models for 503/overload. Extension

MVP Chrome/Edge extension:

- Click an English word on a webpage -> translate to Vietnamese.
- Double-click an English word -> translate and auto-save into deck.
- Save word manually into a local deck.
- Highlight saved words when they appear on other pages.
- Sync deck through Google OAuth opened in browser, using Google Drive `appDataFolder`.

## 1. Load extension

1. Unzip this folder.
2. Open Chrome/Edge extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Choose this folder: `worddeck-browser-oauth-extension`.

## 2. Configure Google OAuth browser login

This extension uses `chrome.identity.launchWebAuthFlow`, so when you click **Login & Sync Google**, it opens the Google OAuth login/consent flow in a browser window.

### Step A — Get Redirect URI

1. Open extension popup.
2. Click gear icon ⚙.
3. Copy the **Redirect URI**. It looks like:

```text
https://<extension-id>.chromiumapp.org/oauth2
```

### Step B — Google Cloud setup

1. Go to Google Cloud Console.
2. Create or choose a project.
3. Enable **Google Drive API**.
4. Configure OAuth consent screen.
5. Create OAuth Client ID.
   - Recommended for this MVP: **Web application**.
   - Add the Redirect URI copied from Options into **Authorized redirect URIs**.
6. Copy the Client ID, which looks like:

```text
xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

### Step C — Paste Client ID

1. Open extension Options again.
2. Paste the Client ID into **Google OAuth Client ID**.
3. Save.
4. Open popup -> click **Login & Sync Google**.

If you get `redirect_uri_mismatch`, copy the Redirect URI from the extension Options page again and add exactly that URI to Google Cloud.

## 3. How to use

- Default: click normal text on a page to translate.
- Double-click normal text to translate and auto-save. You can turn this off in popup/options.
- Click outside the tooltip to close it.
- The extension ignores inputs, buttons, and links in single-click mode to avoid breaking pages.
- You can change mode in popup:
  - `Click thường trên chữ`
  - `Alt + Click`
  - `Double click`

### Note for ChatGPT and other dynamic pages

After installing or updating the extension, reload the ChatGPT tab once. ChatGPT is a very dynamic React/SPA page, so this version uses selected-text fallback on double-click and throttled highlighting to avoid breaking the page DOM.

## 4. Data storage

Local deck is stored in:

```text
chrome.storage.local
```

Google sync stores this JSON file in Drive `appDataFolder`:

```text
worddeck-translator-deck.json
```

`appDataFolder` is private app storage. It normally does not appear as a normal visible file in your Google Drive.

## 5. Translation provider

This MVP uses MyMemory public translation API. It is enough for testing, but quality/rate limits are not production-grade.

For a real product, replace `translateWordToVietnamese()` in `background.js` with one of these:

- Your own backend endpoint.
- Google Cloud Translation API.
- DeepL API.
- A local dictionary dataset.

## 6. Main files

```text
manifest.json      Extension permissions and entrypoints
background.js      Translation, deck storage, Google OAuth, Drive sync
content.js         Click word, tooltip, page highlights
content.css        Tooltip/highlight styling
popup.html/js/css  Deck UI, sync button, settings toggle
options.html/js/css Google OAuth Client ID setup
```

## 7. Security notes

- The OAuth Client ID is not a secret, but do not put API keys/secrets in extension source.
- Do not request broad Drive scope. This MVP only requests:

```text
https://www.googleapis.com/auth/drive.appdata
```

- If you publish this, consider reducing `<all_urls>` usage or adding an allowlist.

## v1.0.2 behavior

Default interaction is now: select/highlight an English word on any page, a small **VI** icon appears near the selection, and the extension translates only after you click that icon. This avoids accidental translation while reading or clicking normal links.

The old single-click / Alt-click / double-click modes are still in Popup/Options under “Dịch bằng click cũ”, but selection-icon mode disables those old modes by default.

## v1.0.3

- Selection icon is forced into a black pill/circle style using isolated CSS so page styles are less likely to distort it.
- Popup/Options now include **Chữ/icon nổi**. You can use `VI`, `V`, `🌐`, `📘`, etc.
- Popup has an **Ôn tập deck** button that opens `review.html` with flashcard mode.
- Existing deck list is still visible directly in the extension popup.

If you see another green/turquoise floating button next to the black `VI` button, that is usually another translation extension or an old content script still active in the tab. Reload the page after updating WordDeck, or disable the other translator extension.

## v1.0.8

- Click vào từ đã highlight để mở lại nghĩa đã lưu, không gọi API dịch lại.
- Từ đã lưu được highlight lại ở trang khác, kể cả ChatGPT/SPA nếu highlight đang bật.
- Click icon sau khi bôi đen vẫn tự dịch + tự lưu.

## v1.0.6

- Translation provider mặc định vẫn là MyMemory free, nên bản dịch có thể chưa thông minh như Google/DeepL.
- Panel dịch giờ hiển thị thêm nhiều nghĩa/translation alternatives từ MyMemory `matches`.
- Lấy thêm định nghĩa theo loại từ từ Free Dictionary API, rồi dịch nhanh định nghĩa sang tiếng Việt để học nghĩa dễ hơn.
- Deck lưu thêm `meanings`, `definitions`, `provider`; dữ liệu cũ vẫn tương thích.


## Gemini API cho dịch thông minh hơn

Bản v1.0.6 hỗ trợ Gemini API để tạo thẻ từ vựng tiếng Việt: nhiều nghĩa, loại từ, ví dụ, ghi chú dễ nhầm.

1. Vào Google AI Studio và tạo Gemini API key.
2. Mở Options của extension.
3. Chọn nguồn dịch **Gemini API**.
4. Dán API key vào ô **Gemini API key**.
5. Model mặc định: `gemini-2.5-flash`.

Lưu ý: dán key trực tiếp trong extension chỉ nên dùng cá nhân, không publish public. Nếu Gemini lỗi hoặc hết quota, extension sẽ tự fallback sang Dictionary/MyMemory.


## v1.0.9
- Import hỗ trợ thêm format `{ "name":"My Deck", "cards":[{"o":"word","t":["nghĩa"],"sl":"en","tl":"vi"}] }`.
- Import vẫn hỗ trợ format native `{ "deck": [...] }`.
