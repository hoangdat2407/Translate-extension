# WordDeck Translator

A personal Chrome/Edge extension for learning English while reading on the web.

Select an English word or phrase, click the floating translate button, and WordDeck will translate it to Vietnamese, save it to your deck, highlight it when it appears again, and let you review it as flashcards. The UI is intentionally plain, teal, and distraction-free.

## Features

- **Select-to-translate**: highlight a word or phrase, then click the floating `VI` button.
- **Auto-save**: clicking the translate button automatically saves the card to your deck.
- **Saved-word highlights**: saved words are highlighted again when they appear on other pages.
- **Click saved words**: click a highlighted word to reopen its saved meaning without calling the API again.
- **Review mode**: open flashcards from the extension popup.
- **Import/export deck**: backup or move your vocabulary list as JSON.
- **Google Drive sync**: sync deck data through Google OAuth and Drive `appDataFolder`.
- **Gemini dictionary cards**: use Gemini API for Vietnamese meanings, definitions, examples, and notes.
- **Fallback translation**: if Gemini fails, the extension falls back to Free Dictionary API + MyMemory.

## Quick start

1. Unzip this folder.
2. Open your browser extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder.
6. Reload the webpage you want to read.
7. Select an English word, click the floating `VI` button, and the card is saved automatically.

## Basic usage

### Translate and save a word

1. Select a word or phrase on any webpage.
2. Click the floating `VI` icon.
3. WordDeck shows the meaning and saves the card automatically.

### Reopen a saved meaning

When a saved word appears again, WordDeck highlights it. Click the highlighted word to reopen the saved meaning.

### Review your deck

Open the extension popup and click **Ôn tập deck** to review cards as flashcards.

### View, import, or export your deck

Open the extension popup. You can:

- view saved cards,
- delete cards,
- export JSON,
- import JSON,
- open review mode,
- sync with Google Drive.

## Gemini API setup

Gemini is recommended for better vocabulary cards.

1. Go to Google AI Studio.
2. Create a Gemini API key.
3. Open WordDeck **Options**.
4. Set translation provider to **Gemini API**.
5. Paste the API key into **Gemini API key**.
6. Set the model, for example:

```text
gemini-2.5-flash-lite
```

For personal use, saving the API key in extension storage is acceptable. Do not publish a public extension with your API key inside it.

## Google Drive sync setup

WordDeck syncs the deck through Google OAuth and stores the JSON in Google Drive `appDataFolder`.

### 1. Get the redirect URI

1. Open the WordDeck popup.
2. Click the gear icon.
3. Copy **Redirect URI**.

It looks like this:

```text
https://<extension-id>.chromiumapp.org/oauth2
```

### 2. Configure Google Cloud

1. Open Google Cloud Console.
2. Create or choose a project.
3. Enable **Google Drive API**.
4. Configure **OAuth consent screen**.
5. Add your Gmail as a **Test user** if the app is still in testing mode.
6. Create an OAuth client:
   - Application type: **Web application**
   - Authorized redirect URI: paste the redirect URI from WordDeck Options
7. Copy the OAuth **Client ID**.

The Client ID looks like this:

```text
xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

### 3. Paste the Client ID into WordDeck

1. Open WordDeck **Options**.
2. Paste the Client ID into **Google OAuth Client ID**.
3. Save.
4. Open the popup and click **Login & Sync Google**.

## Where data is stored

### Local storage

The deck and settings are stored locally in Chrome extension storage:

```text
chrome.storage.local
```

### Google Drive sync

When you sync, WordDeck uploads the deck JSON to Drive `appDataFolder`:

```text
worddeck-translator-deck.json
```

`appDataFolder` is hidden app storage. The file usually does not appear in normal **My Drive**.

### API key storage

The Gemini API key is saved locally in extension storage:

```text
settings.geminiApiKey
```

It is not hardcoded in the source code and is not uploaded to Google Drive by WordDeck.

## Supported import formats

WordDeck supports its native format:

```json
{
  "deck": [
    {
      "word": "immediately",
      "translation": "ngay lập tức"
    }
  ]
}
```

It also supports a compact deck format:

```json
{
  "name": "My Deck",
  "cards": [
    {
      "o": "immediately",
      "sl": "en",
      "t": ["ngay lập tức"],
      "tl": "vi"
    }
  ]
}
```

## Project structure

```text
manifest.json       Extension metadata, permissions, content scripts
background.js       Translation, Gemini calls, deck storage, OAuth, Drive sync
content.js          Selection icon, tooltip/panel, highlights on webpages
content.css         Highlight and content UI styling
popup.html          Popup UI
popup.js            Deck list, import/export, sync, quick settings
popup.css           Popup styling
options.html        Settings page
options.js          OAuth Client ID, Gemini key/model, redirect URI
options.css         Options styling
review.html         Flashcard review page
review.js           Review logic
review.css          Review page styling
```

## Troubleshooting

### `invalid_client`

The Google OAuth Client ID is wrong or the OAuth client type/redirect URI does not match. Use **Web application** and add the exact redirect URI from WordDeck Options.

### `access_denied`

Your OAuth app is in testing mode and your Gmail is not added as a test user. Add your Gmail in **OAuth consent screen → Test users**.

### `Google Drive API has not been used or is disabled`

Enable **Google Drive API** in the same Google Cloud project that contains your OAuth Client ID.

### Gemini returns `503` or `429`

The model is overloaded or rate-limited. Use `gemini-2.5-flash-lite`, wait a bit, or let WordDeck use the fallback translator.

### Highlight does not appear on ChatGPT

Reload the ChatGPT tab after installing or updating the extension. ChatGPT is a dynamic React/SPA page, so old content scripts may stay active until the tab is reloaded.

## Security notes

- The OAuth Client ID is not a secret.
- The Gemini API key is sensitive. Use it only for personal/local use.
- Do not publish this extension publicly with your API key bundled inside it.
- Drive sync uses the narrow scope:

```text
https://www.googleapis.com/auth/drive.appdata
```

- The extension uses `<all_urls>` so it can run on webpages you read. If you publish it, consider limiting allowed sites.

## Version

Current package: **v1.0.12**

This release mainly cleans up the README and fixes the manifest version label.
