# Changelog

## v1.0.25

- Fixed garbled HTML numeric entities in translations, for example `Ch#7881;` now displays as Vietnamese text.
- Strips XML-like tags from translation APIs, for example `<ex id="_1"/>`.
- Cleans imported cards, saved meanings, definitions, examples, notes, context, and source titles before rendering.




## v1.0.24

- Fixed delete actions in popup cards and the on-page meaning panel.
- Delete now matches by id, normalized word, and raw word, so phrases and older imported cards delete reliably.
- The on-page panel now shows a clearer delete status and refreshes highlights after deletion.




## v1.0.23

- Added Clipboard/PDF translate mode in the popup.
- You can select text in a PDF, press Ctrl+C, then use “Dịch & lưu” to translate and save it to the deck.
- Added clipboardRead permission for the popup action.




## v1.0.22

- Fixed v1.0.21 loading failure caused by a broken multiline regex in phrase normalization.
- Kept phrase translation support for short selections such as OpenID Connect, ID token, and authorization code flow.
- Repacked the extension cleanly without nested old version folders.




## v1.0.20

- Added a delete button directly inside the on-page meaning popup for saved/highlighted words.
- Deleting a word from the on-page popup removes it from the deck and refreshes highlights immediately.




## v1.0.19

- Softened saved-word highlights on webpages.
- Switched the highlight style to a subtle underline with a very light hover tint, so it adapts better to different site text and backgrounds.




## v1.0.18

- Matched the on-page translation popup to the updated popup card style.
- Darkened the popup content background and definition blocks for better readability.
- Increased contrast for translation text, meaning chips, and notes inside the on-page panel.




## v1.0.17

- Darkened the deck card backgrounds in the popup for better text contrast.
- Increased contrast for chips, definition panels, note text, and source text.




## v1.0.16

- Fixed popup card styling mismatch so the deck list no longer looks messy.
- Improved contrast for word, translation, and definition text.
- Reorganized popup cards into cleaner blocks: word, main meaning, chips, definitions, note, and source.




## v1.0.16

- Fixed popup vocabulary card layout after CSS class mismatch.
- Made saved words render as clean cards with word, main meaning, compact chips, one short note, and delete action.
- Removed noisy source/context text from the popup deck list.



## v1.0.15

- Refined the visual theme to a softer jade palette.
- Reduced the "AI-looking" feel by simplifying buttons, borders, and shadows.
- Updated popup, options, review, highlights, and the floating panel to a cleaner monochrome style.



## v1.0.14

- Cleaned up popup deck card layout.
- Hid raw page context from the popup list; source title is now shown as a short single-line hint.
- Widened popup slightly and made vocabulary cards easier to scan.

## v1.0.13

- Fixed malformed Gemini JSON handling so broken pseudo-JSON is not saved into the deck.
- Increased Gemini output limit slightly to avoid truncated JSON while keeping quota usage reasonable.
- Simplified provider/status text in the translation panel.
- Switched UI to a cleaner monochrome teal style across popup, options, review, highlights, and translation panel.
- Added a simple bundled icon file at `icon/image.png`.

# Changelog

## v1.0.12

- Rewrote README with clear setup, usage, OAuth, Gemini, storage, import, and troubleshooting sections.
- Fixed `manifest.json` version label.

## v1.0.11

- Added Gemini retry/fallback behavior for overloaded models.

## v1.0.10

- Improved Gemini structured JSON output parsing.

## v1.0.9

- Added support for importing compact deck JSON format.

## v1.0.8

- Widened the translation panel.
- Removed fake/non-functional panel icons.
- Made panel icons perform real actions.

## v1.0.7

- Click highlighted saved words to reopen saved meanings.
- Highlight saved words across pages.

## v1.0.6

- Added Gemini API support.

## v1.0.5

- Added multiple meanings and dictionary fallback support.
