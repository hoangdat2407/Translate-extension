const STORAGE_KEYS = {
  DECK: "wordDeck",
  SETTINGS: "settings",
  GOOGLE_TOKEN: "googleAccessToken",
  GOOGLE_TOKEN_EXPIRES_AT: "googleTokenExpiresAt"
};


const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";

const DEFAULT_SETTINGS = {
  selectionIconEnabled: true,
  clickTranslateEnabled: false,
  clickMode: "single", // single | alt | double
  googleClientId: "",
  myMemoryEmail: "",
  geminiApiKey: "",
  geminiModel: GEMINI_DEFAULT_MODEL,
  translationProvider: "gemini", // gemini | dictionary
  highlightEnabled: true,
  autoSaveOnDoubleClick: true,
  selectionIconLabel: "VI",
  customIconDataUrl: ""
};

const DRIVE_DECK_FILE_NAME = "worddeck-translator-deck.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

// Use alarms to run sync reliably — MV3 service workers can be suspended
// before a fire-and-forget promise completes. Alarms wake the SW up.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pendingSync") {
    tryAutoSync();
  }
});

function scheduleSyncAlarm() {
  // delayInMinutes must be >= 1/60 (about 1 second) per Chrome spec
  chrome.alarms.create("pendingSync", { delayInMinutes: 1 / 60 });
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GET_STATE": {
      const [deck, settings] = await Promise.all([getDeck(), getSettings()]);
      const isExtensionPage = !sender?.tab || (sender?.tab?.url && sender.tab.url.startsWith("chrome-extension://"));
      if (isExtensionPage) {
        tryAutoSync(15000); // 15s cooldown
      }
      return { ok: true, deck, settings, redirectUri: chrome.identity.getRedirectURL("oauth2") };
    }
    case "GET_DECK": {
      return { ok: true, deck: await getDeck() };
    }
    case "TRANSLATE_WORD": {
      const word = normalizeWord(message.word);
      if (!word) throw new Error("No word to translate");
      const rawDeck = await getRawDeck();
      const existingIndex = rawDeck.findIndex((item) => item.normalized === word.toLowerCase());
      const existing = existingIndex >= 0 ? rawDeck[existingIndex] : null;
      if (existing?.translation && !existing.deleted) {
        // Cập nhật timesSeen và updatedAt mỗi khi xem lại từ đã lưu
        const now = new Date().toISOString();
        rawDeck[existingIndex] = {
          ...existing,
          timesSeen: (existing.timesSeen || 0) + 1,
          updatedAt: now
        };
        await setRawDeck(rawDeck);
        await broadcastDeckChanged();
        tryAutoSync();
        return {
          ok: true,
          word,
          translation: existing.translation,
          meanings: existing.meanings || [existing.translation],
          definitions: existing.definitions || [],
          provider: existing.provider || "deck",
          fromDeck: true,
          entry: rawDeck[existingIndex]
        };
      }
      const translated = await translateWordToVietnamese(word);
      return {
        ok: true,
        word,
        translation: translated.primary,
        meanings: translated.meanings,
        definitions: translated.definitions,
        provider: translated.provider,
        fromDeck: false
      };
    }
    case "SAVE_WORD": {
      const entry = await saveWord(message.payload || {}, sender?.tab || null);
      await broadcastDeckChanged();
      scheduleSyncAlarm();
      return { ok: true, entry, deck: await getDeck() };
    }
    case "DELETE_WORD": {
      const rawDeck = await getRawDeck();
      const targets = buildDeleteTargets(message);
      if (!targets.size) throw new Error("Missing word to delete");

      let removedCount = 0;
      const now = new Date().toISOString();
      const nextRawDeck = rawDeck.map((item) => {
        if (matchesDeleteTarget(item, targets)) {
          if (!item.deleted) {
            removedCount++;
            return { ...item, deleted: true, updatedAt: now };
          }
        }
        return item;
      });

      await setRawDeck(nextRawDeck);
      await broadcastDeckChanged();
      scheduleSyncAlarm();

      const activeDeck = nextRawDeck.filter((item) => !item.deleted);
      return {
        ok: true,
        deck: activeDeck,
        removedCount
      };
    }
    case "CLEAR_DECK": {
      const rawDeck = await getRawDeck();
      const now = new Date().toISOString();
      const nextRawDeck = rawDeck.map((item) => ({
        ...item,
        deleted: true,
        updatedAt: now
      }));
      await setRawDeck(nextRawDeck);
      await broadcastDeckChanged();
      scheduleSyncAlarm();
      return { ok: true, deck: [] };
    }
    case "IMPORT_DECK": {
      const incoming = Array.isArray(message.deck) ? message.deck : [];
      const merged = mergeDecks(await getRawDeck(), sanitizeDeck(incoming));
      await setRawDeck(merged);
      await broadcastDeckChanged();
      scheduleSyncAlarm();
      return { ok: true, deck: merged.filter((item) => !item.deleted) };
    }
    case "UPDATE_SETTINGS": {
      const settings = await updateSettings(message.patch || {});
      await broadcastSettingsChanged();
      return { ok: true, settings, redirectUri: chrome.identity.getRedirectURL("oauth2") };
    }
    case "GOOGLE_LOGIN": {
      const token = await getGoogleAccessToken(true);
      return { ok: true, hasToken: Boolean(token) };
    }
    case "GOOGLE_LOGOUT": {
      await clearGoogleToken();
      return { ok: true };
    }
    case "GOOGLE_SYNC": {
      const result = await syncDeckWithGoogleDrive(true);
      await broadcastDeckChanged();
      await chrome.storage.local.set({ lastSyncTime: Date.now() });
      return { ok: true, ...result };
    }
    case "WORDDECK_OPEN_OPTIONS": {
      chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    case "WORDDECK_OPEN_REVIEW": {
      chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
      return { ok: true };
    }
    default:
      throw new Error("Unknown message type");
  }
}


function buildDeleteTargets(message = {}) {
  const values = [
    message.id,
    message.normalized,
    message.word,
    message.term,
    message.original,
    message.entry?.id,
    message.entry?.normalized,
    message.entry?.word
  ];

  const targets = new Set();

  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    targets.add(raw.toLowerCase());

    const normalized = normalizeWord(raw);
    if (normalized) targets.add(normalized.toLowerCase());
  }

  return targets;
}

function matchesDeleteTarget(item, targets) {
  if (!item || !targets?.size) return false;

  const values = [
    item.id,
    item.normalized,
    item.word,
    item.o,
    item.original,
    item.term
  ];

  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    if (targets.has(raw.toLowerCase())) return true;

    const normalized = normalizeWord(raw);
    if (normalized && targets.has(normalized.toLowerCase())) return true;
  }

  return false;
}


async function getRawDeck() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.DECK);
  return Array.isArray(data[STORAGE_KEYS.DECK]) ? sanitizeDeck(data[STORAGE_KEYS.DECK]) : [];
}

async function setRawDeck(deck) {
  await chrome.storage.local.set({ [STORAGE_KEYS.DECK]: sanitizeDeck(deck) });
}

async function getDeck() {
  const rawDeck = await getRawDeck();
  return rawDeck.filter((item) => !item.deleted);
}

async function setDeck(deck) {
  await setRawDeck(deck);
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) });
}

function normalizeSettings(settings) {
  settings.clickMode = ["single", "alt", "double"].includes(settings.clickMode) ? settings.clickMode : "single";
  settings.selectionIconEnabled = settings.selectionIconEnabled !== false;
  settings.clickTranslateEnabled = Boolean(settings.clickTranslateEnabled);
  settings.highlightEnabled = settings.highlightEnabled !== false;
  settings.autoSaveOnDoubleClick = Boolean(settings.autoSaveOnDoubleClick);
  settings.selectionIconLabel = normalizeIconLabel(settings.selectionIconLabel || "VI");
  settings.customIconDataUrl = typeof settings.customIconDataUrl === "string" ? settings.customIconDataUrl : "";
  settings.geminiApiKey = String(settings.geminiApiKey || "").trim();
  settings.geminiModel = normalizeGeminiModel(settings.geminiModel);
  settings.translationProvider = ["gemini", "dictionary"].includes(settings.translationProvider) ? settings.translationProvider : "gemini";

  // Default mode is selection icon. Keep old click/double-click mode only when the user explicitly enables it.
  if (settings.selectionIconEnabled) settings.clickTranslateEnabled = false;
  return settings;
}

function normalizeGeminiModel(model) {
  const value = String(model || "").trim();


  if (
    !value ||
    value === "gemini-3.5-flash" ||
    value === "gemini-2.5-flash" ||
    value === "gemini-2.0-flash" ||
    value === "gemini-2.0-flash-lite"
  ) {
    return GEMINI_DEFAULT_MODEL;
  }

  return value;
}

async function updateSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };

  // These two modes are mutually exclusive, so pages do not translate accidentally.
  if (patch.selectionIconEnabled === true) settings.clickTranslateEnabled = false;
  if (patch.clickTranslateEnabled === true) settings.selectionIconEnabled = false;

  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: normalized });
  return normalized;
}

async function translateWordToVietnamese(word) {
  const settings = await getSettings();

  // Cá nhân dùng thì Gemini API key trong extension là cách đơn giản nhất.
  // Nếu chưa có key hoặc Gemini lỗi/rate-limit, rơi về Dictionary API + MyMemory để extension vẫn dùng được.
  if (settings.translationProvider === "gemini" && settings.geminiApiKey) {
    try {
      return await translateViaGemini(word, settings);
    } catch (error) {
      console.warn("Gemini translation failed, falling back", error);
      return await translateViaDictionaryAndMemory(word);
    }
  }

  return translateViaDictionaryAndMemory(word);
}

async function translateViaDictionaryAndMemory(word) {
  const [memoryResult, dictionaryResult] = await Promise.allSettled([
    translateViaMyMemory(word),
    fetchDictionaryDefinitions(word)
  ]);

  const memory = memoryResult.status === "fulfilled" ? memoryResult.value : { primary: "", meanings: [] };
  const definitions = dictionaryResult.status === "fulfilled" ? dictionaryResult.value : [];
  const meanings = uniqueClean([memory.primary, ...(memory.meanings || [])])
    .filter((x) => x && x.toLowerCase() !== word.toLowerCase())
    .slice(0, 8);

  const primary = meanings[0] || memory.primary || word;
  return {
    primary,
    meanings: meanings.length ? meanings : [primary],
    definitions,
    provider: "Free Dictionary API + MyMemory fallback"
  };
}

async function translateViaGemini(word, settings) {
  const modelName = normalizeGeminiModel(settings.geminiModel);
  return translateViaGeminiModel(word, settings, modelName);
}

async function translateViaGeminiModel(word, settings, modelName) {
  const prompt = `You are a compact English-Vietnamese vocabulary dictionary for a Vietnamese cybersecurity/IELTS learner.
Analyze this English word or phrase: "${word}".
Return ONLY one valid JSON object. Do not use markdown. Do not add prose before or after JSON.
Use exactly these top-level keys: primary, meanings, definitions, notes.
Meanings must be natural Vietnamese, context-aware, and common meanings first.
Keep the output compact: max 5 meanings, max 3 definitions.
For technical/security/legal meanings, mention the domain briefly in viDefinition or notes.
If the phrase is a command, idiom, phrasal verb, or fixed expression, explain the whole phrase instead of translating word-by-word.
Never return malformed JSON. Every key and string must use double quotes.`;

  const model = encodeURIComponent(modelName || GEMINI_DEFAULT_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 700,
      responseMimeType: "application/json",
      responseSchema: geminiDictionarySchema()
    }
  };

  const response = await geminiFetchWithRetry(url, settings.geminiApiKey, requestBody);

  const data = await response.json();
  const text = extractGeminiText(data);
  const parsed = parseGeminiDictionaryOutput(text, word);

  const primary = cleanTranslation(parsed?.primary || parsed?.primaryVi || parsed?.meaning || "");
  const meanings = uniqueClean([
    primary,
    ...(Array.isArray(parsed?.meanings) ? parsed.meanings : [])
  ]).slice(0, 5);

  const definitions = sanitizeDefinitions(
    Array.isArray(parsed?.definitions) ? parsed.definitions : []
  );

  const notes = cleanTranslation(parsed?.notes || parsed?.noteVi || "");
  if (notes) {
    definitions.push({
      partOfSpeech: "note",
      definition: "",
      viDefinition: notes,
      example: "",
      exampleVi: "",
      synonyms: []
    });
  }

  const finalPrimary = meanings[0] || definitions[0]?.viDefinition || word;

  return {
    primary: finalPrimary,
    meanings: meanings.length ? meanings : [finalPrimary],
    definitions,
    provider: `Gemini (${modelName})`
  };
}


async function geminiFetchWithRetry(url, apiKey, requestBody) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  }, 18000);

  if (response.ok) return response;

  const text = await response.text().catch(() => "");
  throw new Error(`Gemini API failed ${response.status}: ${text.slice(0, 220)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geminiDictionarySchema() {
  return {
    type: "OBJECT",
    properties: {
      primary: { type: "STRING" },
      meanings: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      definitions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            partOfSpeech: { type: "STRING" },
            definition: { type: "STRING" },
            viDefinition: { type: "STRING" },
            example: { type: "STRING" },
            synonyms: {
              type: "ARRAY",
              items: { type: "STRING" }
            }
          },
          required: [
            "partOfSpeech",
            "definition",
            "viDefinition",
            "example",
            "synonyms"
          ]
        }
      },
      notes: { type: "STRING" }
    },
    required: ["primary", "meanings", "definitions", "notes"]
  };
}
function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("\n").trim();
  if (text) return text;
  const reason = data?.candidates?.[0]?.finishReason;
  if (reason) throw new Error(`Gemini returned empty text; finishReason=${reason}`);
  throw new Error("Gemini returned empty text");
}

function parseGeminiDictionaryOutput(text, word) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Gemini returned empty text");

  const parsed = tryParseJsonObject(raw) || tryParseJsonObject(repairLooseGeminiJson(raw));
  if (parsed) return parsed;

  // Do not save a broken pseudo-JSON answer to the deck.
  // If Gemini ignores structured JSON, let the caller fall back to Dictionary/MyMemory.
  console.warn("Gemini non-JSON output ignored", raw.slice(0, 500));
  throw new Error("Gemini did not return valid JSON");
}

function repairLooseGeminiJson(raw) {
  let text = String(raw || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  // Strip duplicated leading braces caused by truncated/model text.
  text = text.replace(/^\s*\{\s*\{+/, "{");

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);

  // Quote common unquoted keys from Gemini-ish pseudo JSON.
  text = text.replace(/([{,]\s*)(primary|primaryVi|meanings|definitions|notes|noteVi|partOfSpeech|definition|viDefinition|example|exampleVi|synonyms|domain|pos)\s*:/g, '$1"$2":');

  // Remove semicolons that sometimes appear after lines.
  text = text.replace(/;\s*([}\],])/g, "$1").replace(/;\s*$/g, "");

  return text;
}

function tryParseJsonObject(raw) {
  try { return JSON.parse(raw); } catch (_) { }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch (_) { }
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) { }
  }

  return null;
}

async function translateViaMyMemory(text) {
  const settings = await getSettings();
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|vi");
  if (settings.myMemoryEmail) url.searchParams.set("de", settings.myMemoryEmail);

  const response = await fetchWithTimeout(url.toString(), {}, 9000);
  if (!response.ok) throw new Error(`Translation API failed: ${response.status}`);
  const data = await response.json();

  const primary = cleanTranslation(data?.responseData?.translatedText || "");
  const fromMatches = Array.isArray(data?.matches)
    ? data.matches
      .map((item) => cleanTranslation(item?.translation || ""))
      .filter(Boolean)
    : [];

  return {
    primary,
    meanings: uniqueClean([primary, ...fromMatches]).slice(0, 10)
  };
}

async function fetchDictionaryDefinitions(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`;
  const response = await fetchWithTimeout(url, {}, 8000);
  if (!response.ok) return [];
  const entries = await response.json();
  if (!Array.isArray(entries)) return [];

  const raw = [];
  for (const entry of entries) {
    for (const meaning of entry.meanings || []) {
      const partOfSpeech = String(meaning.partOfSpeech || "").trim();
      for (const def of (meaning.definitions || []).slice(0, 2)) {
        const definition = String(def.definition || "").trim();
        if (!definition) continue;
        raw.push({
          partOfSpeech,
          definition,
          example: String(def.example || "").trim(),
          synonyms: Array.isArray(def.synonyms) ? def.synonyms.slice(0, 5) : []
        });
        if (raw.length >= 5) break;
      }
      if (raw.length >= 5) break;
    }
    if (raw.length >= 5) break;
  }

  // Dịch nhanh định nghĩa sang tiếng Việt để panel có “các nghĩa” dễ học hơn.
  const translated = [];
  for (const item of raw.slice(0, 4)) {
    let viDefinition = "";
    try {
      viDefinition = (await translateViaMyMemory(item.definition)).primary;
    } catch (_) { }
    translated.push({ ...item, viDefinition: viDefinition || item.definition });
  }
  return translated;
}

function uniqueClean(items) {
  const seen = new Set();
  const out = [];
  for (const raw of items || []) {
    const text = cleanTranslation(raw)
      .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function cleanTranslation(text) {
  let value = String(text || "");

  // Some translation APIs return HTML/XML-ish fragments like:
  //   Ch&#7881; m&#7897;t ...
  //   Sự tò<ex id="_1"/>
  // Decode numeric entities and remove markup before saving/displaying.
  value = value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  value = value.replace(/&?#(x?[0-9a-fA-F]+);/g, (_, code) => {
    const base = String(code).toLowerCase().startsWith("x") ? 16 : 10;
    const raw = String(code).replace(/^x/i, "");
    const point = parseInt(raw, base);
    if (!Number.isFinite(point)) return "";
    try {
      return String.fromCodePoint(point);
    } catch (_) {
      return "";
    }
  });

  value = value
    .replace(/<\/?(?:ex|mrk|ph|bpt|ept|it|x)[^>]*>/gi, "")
    .replace(/<[^>]{1,80}>/g, "")
    .replace(/[{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function sanitizeMeanings(meanings, translation = "") {
  return uniqueClean([...(Array.isArray(meanings) ? meanings : []), translation]).slice(0, 8);
}

function sanitizeDefinitions(definitions) {
  if (!Array.isArray(definitions)) return [];
  return definitions.slice(0, 6).map((item) => ({
    partOfSpeech: cleanTranslation(item?.partOfSpeech || item?.pos || "").slice(0, 30),
    definition: cleanTranslation(item?.definition || item?.enDefinition || "").slice(0, 400),
    viDefinition: cleanTranslation(item?.viDefinition || item?.viExplanation || item?.noteVi || "").slice(0, 500),
    example: cleanTranslation(item?.example || item?.exampleEn || "").slice(0, 300),
    exampleVi: cleanTranslation(item?.exampleVi || "").slice(0, 300),
    synonyms: Array.isArray(item?.synonyms) ? item.synonyms.map(cleanTranslation).filter(Boolean).slice(0, 5) : []
  })).filter((item) => item.definition || item.viDefinition || item.example || item.exampleVi);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function saveWord(payload, tab) {
  const word = normalizeWord(payload.word);
  const translation = cleanTranslation(payload.translation || "");
  if (!word) throw new Error("Missing word");
  if (!translation) throw new Error("Missing translation");

  const now = new Date().toISOString();
  const normalized = word.toLowerCase();
  const rawDeck = await getRawDeck();
  const existingIndex = rawDeck.findIndex((item) => item.normalized === normalized);

  const entry = {
    id: existingIndex >= 0 ? rawDeck[existingIndex].id : crypto.randomUUID(),
    word,
    normalized,
    translation,
    meanings: sanitizeMeanings(payload.meanings, translation),
    definitions: sanitizeDefinitions(payload.definitions),
    provider: String(payload.provider || "").slice(0, 80),
    context: cleanTranslation(payload.context || "").slice(0, 500),
    sourceUrl: String(payload.sourceUrl || tab?.url || ""),
    sourceTitle: String(payload.sourceTitle || tab?.title || ""),
    createdAt: existingIndex >= 0 ? rawDeck[existingIndex].createdAt : now,
    updatedAt: now,
    timesSeen: existingIndex >= 0 ? (rawDeck[existingIndex].timesSeen || 0) + 1 : 1,
    deleted: false
  };

  if (existingIndex >= 0) rawDeck[existingIndex] = { ...rawDeck[existingIndex], ...entry };
  else rawDeck.unshift(entry);

  await setRawDeck(rawDeck);
  return entry;
}

function normalizeImportedTranslation(value) {
  if (Array.isArray(value)) {
    return uniqueClean(value)
      .slice(0, 5)
      .join("; ");
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.t)) return normalizeImportedTranslation(value.t);
    if (Array.isArray(value.translations)) return normalizeImportedTranslation(value.translations);
    if (value.text) return cleanTranslation(value.text);
  }
  return cleanTranslation(value);
}

function sanitizeDeck(deck) {
  const seen = new Map();
  for (const raw of deck) {
    if (!raw || typeof raw !== "object") continue;
    const word = normalizeWord(raw.word || raw.normalized || raw.o || raw.original || raw.term);
    const rawTranslation = raw.translation ?? raw.vi ?? raw.meaning ?? raw.definition ?? raw.t ?? raw.translations;
    const translation = normalizeImportedTranslation(rawTranslation);
    if (!word || !translation) continue;
    const normalized = word.toLowerCase();
    const item = {
      id: String(raw.id || crypto.randomUUID()),
      word,
      normalized,
      translation,
      meanings: sanitizeMeanings(raw.meanings, translation),
      definitions: sanitizeDefinitions(raw.definitions),
      provider: cleanTranslation(raw.provider || raw.source || (raw.sl || raw.tl ? `${raw.sl || "?"}->${raw.tl || "?"}` : "import")).slice(0, 80),
      context: cleanTranslation(raw.context || "").slice(0, 500),
      sourceUrl: String(raw.sourceUrl || ""),
      sourceTitle: cleanTranslation(raw.sourceTitle || ""),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
      timesSeen: Number.isFinite(Number(raw.timesSeen)) ? Number(raw.timesSeen) : 1,
      deleted: Boolean(raw.deleted)
    };
    const old = seen.get(normalized);
    if (!old || new Date(item.updatedAt) > new Date(old.updatedAt)) {
      seen.set(normalized, item);
    }
  }
  return [...seen.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function mergeDecks(localDeck, remoteDeck) {
  return sanitizeDeck([...(remoteDeck || []), ...(localDeck || [])]);
}

function normalizeIconLabel(input) {
  const text = String(input || "VI").trim();
  const cleaned = text.replace(/\s+/g, "").slice(0, 3);
  return cleaned || "VI";
}

function normalizeWord(input) {
  let text = String(input || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9_'’.\-/\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (!/[A-Za-z]/.test(text)) return "";

  // Support short phrases like "OpenID Connect", "claims and scopes",
  // "authorization code flow". Cap long selections to avoid saving whole paragraphs.
  const words = text.split(/\s+/).filter(Boolean).slice(0, 12);
  let phrase = words.join(" ");

  if (phrase.length > 120) {
    phrase = phrase.slice(0, 120).replace(/\s+\S*$/, "").trim() || phrase.slice(0, 120).trim();
  }

  return phrase.replace(/[’]/g, "'");
}

async function broadcastDeckChanged() {
  const deck = await getDeck();
  chrome.runtime.sendMessage({ type: "DECK_CHANGED", deck }).catch(() => { });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !isInjectableUrl(tab.url)) continue;
    chrome.tabs.sendMessage(tab.id, { type: "DECK_CHANGED", deck }).catch(() => { });
  }
}

async function broadcastSettingsChanged() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !isInjectableUrl(tab.url)) continue;
    chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_CHANGED", settings }).catch(() => { });
  }
}

function isInjectableUrl(url = "") {
  return /^https?:\/\//i.test(url);
}

function decksAreIdentical(deckA, deckB) {
  if (deckA.length !== deckB.length) return false;
  for (let i = 0; i < deckA.length; i++) {
    const a = deckA[i];
    const b = deckB[i];
    if (
      a.id !== b.id ||
      a.updatedAt !== b.updatedAt ||
      a.deleted !== b.deleted ||
      a.translation !== b.translation
    ) {
      return false;
    }
  }
  return true;
}

async function getGoogleAccessToken(interactive = true) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.GOOGLE_TOKEN,
    STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT
  ]);
  const token = stored[STORAGE_KEYS.GOOGLE_TOKEN];
  const expiresAt = Number(stored[STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT] || 0);
  if (token && Date.now() < expiresAt - 60_000) return token;

  const settings = await getSettings();
  const clientId = String(settings.googleClientId || "").trim();
  if (!clientId || !clientId.endsWith(".apps.googleusercontent.com")) {
    throw new Error("Missing Google OAuth Client ID. Open Options and paste your client ID first.");
  }

  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", DRIVE_SCOPE);
  authUrl.searchParams.set("include_granted_scopes", "true");
  // silent: prompt=none so Google returns token if session exists, no popup
  // interactive: no extra prompt param — Google shows account picker only if needed
  if (!interactive) {
    authUrl.searchParams.set("prompt", "none");
  }

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: interactive
    });

    if (!responseUrl) throw new Error("OAuth flow did not return a URL");
    const parsed = new URL(responseUrl);
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const error = hash.get("error");
    if (error) throw new Error(`Google OAuth error: ${error}`);

    const accessToken = hash.get("access_token");
    const expiresIn = Number(hash.get("expires_in") || 3600);
    if (!accessToken) throw new Error("No Google access token returned");

    await chrome.storage.local.set({
      [STORAGE_KEYS.GOOGLE_TOKEN]: accessToken,
      [STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT]: Date.now() + expiresIn * 1000
    });
    return accessToken;
  } catch (err) {
    if (!interactive) {
      console.warn("Silent OAuth flow failed:", err?.message || err);
      return null;
    }
    throw err;
  }
}

async function clearGoogleToken() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.GOOGLE_TOKEN);
  const token = data[STORAGE_KEYS.GOOGLE_TOKEN];
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
    } catch (_) { }
  }
  await chrome.storage.local.remove([
    STORAGE_KEYS.GOOGLE_TOKEN,
    STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT
  ]);
}

async function driveFetch(path, options = {}, interactive = true) {
  const token = await getGoogleAccessToken(interactive);
  if (!token) throw new Error("No Google access token available");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    await clearGoogleToken();
    throw new Error("Google token expired. Please sync again and login.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Drive API failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

async function findDriveDeckFile(interactive = true) {
  const q = encodeURIComponent(`name='${DRIVE_DECK_FILE_NAME}'`);
  const fields = encodeURIComponent("files(id,name,modifiedTime)");
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=${fields}&pageSize=1`;
  const response = await driveFetch(url, {}, interactive);
  const data = await response.json();
  return data?.files?.[0] || null;
}

async function downloadDriveDeck(fileId, interactive = true) {
  if (!fileId) return [];
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await driveFetch(url, {}, interactive);
  const text = await response.text();
  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return sanitizeDeck(parsed);
  return sanitizeDeck(parsed.deck || []);
}

async function uploadDriveDeck(deck, existingFileId = null, interactive = true) {
  const metadata = existingFileId
    ? { name: DRIVE_DECK_FILE_NAME, mimeType: "application/json" }
    : { name: DRIVE_DECK_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
  const content = JSON.stringify({ deck: sanitizeDeck(deck), updatedAt: new Date().toISOString() }, null, 2);
  const boundary = `worddeck_boundary_${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const response = await driveFetch(url, {
    method: existingFileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  }, interactive);
  return response.json();
}

async function syncDeckWithGoogleDrive(interactive = true) {
  const localDeck = await getRawDeck();
  const remoteFile = await findDriveDeckFile(interactive);
  const remoteDeck = remoteFile ? await downloadDriveDeck(remoteFile.id, interactive) : [];
  const mergedDeck = mergeDecks(localDeck, remoteDeck);

  let uploaded = null;
  const remoteChanged = !decksAreIdentical(mergedDeck, remoteDeck);
  if (remoteChanged || !remoteFile) {
    uploaded = await uploadDriveDeck(mergedDeck, remoteFile?.id || null, interactive);
  }

  await setRawDeck(mergedDeck);
  return {
    deck: mergedDeck.filter((item) => !item.deleted),
    localCountBefore: localDeck.filter((item) => !item.deleted).length,
    remoteCountBefore: remoteDeck.filter((item) => !item.deleted).length,
    mergedCount: mergedDeck.filter((item) => !item.deleted).length,
    driveFileId: uploaded?.id || remoteFile?.id || null
  };
}

async function hasValidGoogleToken() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.GOOGLE_TOKEN,
    STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT
  ]);
  const token = stored[STORAGE_KEYS.GOOGLE_TOKEN];
  const expiresAt = Number(stored[STORAGE_KEYS.GOOGLE_TOKEN_EXPIRES_AT] || 0);
  return !!token && Date.now() < expiresAt - 60_000;
}

async function hasLoggedInBefore() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.GOOGLE_TOKEN);
  return !!stored[STORAGE_KEYS.GOOGLE_TOKEN];
}

async function tryAutoSync(cooldownMs = 0) {
  try {
    const settings = await getSettings();
    const clientId = String(settings.googleClientId || "").trim();
    if (!clientId) return;

    const loggedIn = await hasLoggedInBefore();
    if (!loggedIn) return;

    if (cooldownMs > 0) {
      const stored = await chrome.storage.local.get("lastSyncTime");
      const lastSync = Number(stored.lastSyncTime || 0);
      if (Date.now() - lastSync < cooldownMs) return;
    }

    // If token is still valid, sync straight away.
    // If expired, attempt a silent OAuth refresh. If that also fails,
    // skip quietly — the user will need to click "Login & Sync" once.
    const tokenValid = await hasValidGoogleToken();
    if (!tokenValid) {
      const silentToken = await getGoogleAccessToken(false).catch(() => null);
      if (!silentToken) return; // can't renew silently, skip
    }

    await syncDeckWithGoogleDrive(false);
    await broadcastDeckChanged();
    await chrome.storage.local.set({ lastSyncTime: Date.now() });
  } catch (error) {
    console.warn("Auto sync failed:", error);
    broadcastAutoSyncStatus({ ok: false, error: error?.message || String(error) });
  }
}

// Schedule a sync shortly after service worker boots
scheduleSyncAlarm();
