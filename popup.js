let deck = [];
let settings = {};

const els = {
  summary: document.getElementById("summary"),
  openOptions: document.getElementById("openOptions"),
  selectionIconEnabled: document.getElementById("selectionIconEnabled"),
  selectionIconLabel: document.getElementById("selectionIconLabel"),
  translationProvider: document.getElementById("translationProvider"),
  clickTranslateEnabled: document.getElementById("clickTranslateEnabled"),
  highlightEnabled: document.getElementById("highlightEnabled"),
  autoSaveOnDoubleClick: document.getElementById("autoSaveOnDoubleClick"),
  clickMode: document.getElementById("clickMode"),
  syncGoogle: document.getElementById("syncGoogle"),
  logoutGoogle: document.getElementById("logoutGoogle"),
  syncStatus: document.getElementById("syncStatus"),
  translateClipboard: document.getElementById("translateClipboard"),
  clipboardStatus: document.getElementById("clipboardStatus"),
  search: document.getElementById("search"),
  openReview: document.getElementById("openReview"),
  exportDeck: document.getElementById("exportDeck"),
  importDeck: document.getElementById("importDeck"),
  deckList: document.getElementById("deckList")
};

init();

async function init() {
  await loadState();
  bindEvents();
  render();
}

async function loadState() {
  const state = await sendMessage({ type: "GET_STATE" });
  deck = state.deck || [];
  settings = state.settings || {};
}

function bindEvents() {
  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.selectionIconEnabled.addEventListener("change", () => updateSettings({ selectionIconEnabled: els.selectionIconEnabled.checked }));
  els.selectionIconLabel.addEventListener("change", () => updateSettings({ selectionIconLabel: normalizeIconLabel(els.selectionIconLabel.value) }));
  els.selectionIconLabel.addEventListener("blur", () => updateSettings({ selectionIconLabel: normalizeIconLabel(els.selectionIconLabel.value) }));
  els.translationProvider.addEventListener("change", () => updateSettings({ translationProvider: els.translationProvider.value }));
  els.clickTranslateEnabled.addEventListener("change", () => updateSettings({ clickTranslateEnabled: els.clickTranslateEnabled.checked }));
  els.highlightEnabled.addEventListener("change", () => updateSettings({ highlightEnabled: els.highlightEnabled.checked }));
  els.autoSaveOnDoubleClick.addEventListener("change", () => updateSettings({ autoSaveOnDoubleClick: els.autoSaveOnDoubleClick.checked }));
  els.clickMode.addEventListener("change", () => updateSettings({ clickMode: els.clickMode.value }));
  els.search.addEventListener("input", renderDeck);
  els.openReview.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }));
  if (els.translateClipboard) {
    els.translateClipboard.addEventListener("click", translateClipboardAndSave);
  }


  els.syncGoogle.addEventListener("click", async () => {
    els.syncGoogle.disabled = true;
    els.syncStatus.textContent = "Đang mở Google OAuth và sync...";
    try {
      const result = await sendMessage({ type: "GOOGLE_SYNC" });
      deck = result.deck || deck;
      els.syncStatus.textContent = `Sync xong: local ${result.localCountBefore}, remote ${result.remoteCountBefore}, merged ${result.mergedCount}.`;
      render();
    } catch (error) {
      els.syncStatus.textContent = error.message || "Sync lỗi";
    } finally {
      els.syncGoogle.disabled = false;
    }
  });

  els.logoutGoogle.addEventListener("click", async () => {
    await sendMessage({ type: "GOOGLE_LOGOUT" });
    els.syncStatus.textContent = "Đã xóa Google token local.";
  });

  els.exportDeck.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ deck, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worddeck-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  els.importDeck.addEventListener("change", async () => {
    const file = els.importDeck.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = extractImportCards(parsed);
      const result = await sendMessage({ type: "IMPORT_DECK", deck: incoming || [] });
      deck = result.deck || [];
      render();
    } catch (error) {
      alert(error.message || "Import lỗi");
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "DECK_CHANGED") {
      deck = message.deck || [];
      render();
    }
    if (message?.type === "AUTO_SYNC_STATUS") {
      if (message.ok) {
        els.syncStatus.textContent = `✓ Tự đồng bộ xong (${message.mergedCount} từ) — ${new Date().toLocaleTimeString("vi-VN")}`;
      } else {
        els.syncStatus.textContent = `⚠ Tự đồng bộ lỗi: ${message.error || "Không xác định"}`;
      }
    }
  });
}


async function translateClipboardAndSave() {
  if (!els.translateClipboard) return;
  els.translateClipboard.disabled = true;
  if (els.clipboardStatus) els.clipboardStatus.textContent = "Đang đọc clipboard...";

  try {
    const raw = await navigator.clipboard.readText();
    const word = normalizeClipboardText(raw);
    if (!word) {
      throw new Error("Clipboard chưa có từ/cụm tiếng Anh hợp lệ. Trong PDF: bôi đen → Ctrl+C → bấm lại.");
    }

    if (els.clipboardStatus) els.clipboardStatus.textContent = `Đang dịch: ${word}`;

    const translated = await sendMessage({ type: "TRANSLATE_WORD", word });
    let entry = translated.entry || null;

    if (!translated.fromDeck) {
      const saved = await sendMessage({
        type: "SAVE_WORD",
        payload: {
          word: translated.word || word,
          translation: translated.translation,
          meanings: translated.meanings || [],
          definitions: translated.definitions || [],
          provider: translated.provider || "clipboard",
          context: raw.slice(0, 500),
          sourceTitle: "Clipboard / PDF"
        }
      });
      entry = saved.entry || null;
      deck = saved.deck || deck;
    }

    if (els.clipboardStatus) {
      const meaning = entry?.translation || translated.translation || "";
      els.clipboardStatus.textContent = `${translated.fromDeck ? "Đã có trong deck" : "Đã dịch và lưu"}: ${word}${meaning ? " → " + meaning : ""}`;
    }

    els.search.value = word;
    render();
  } catch (error) {
    if (els.clipboardStatus) els.clipboardStatus.textContent = error.message || "Không đọc được clipboard.";
  } finally {
    els.translateClipboard.disabled = false;
  }
}

function normalizeClipboardText(input) {
  let text = String(input || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9_'’.\-/\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (!/[A-Za-z]/.test(text)) return "";

  const words = text.split(/\s+/).filter(Boolean).slice(0, 12);
  let phrase = words.join(" ");

  if (phrase.length > 120) {
    phrase = phrase.slice(0, 120).replace(/\s+\S*$/, "").trim() || phrase.slice(0, 120).trim();
  }

  return phrase.replace(/[’]/g, "'");
}


async function updateSettings(patch) {
  const result = await sendMessage({ type: "UPDATE_SETTINGS", patch });
  settings = result.settings || settings;
  renderControls();
}

function render() {
  renderControls();
  renderDeck();
}

function renderControls() {
  els.summary.textContent = `${deck.length} từ trong deck`;
  els.selectionIconEnabled.checked = settings.selectionIconEnabled !== false;
  els.selectionIconLabel.value = settings.selectionIconLabel || "VI";
  if (els.translationProvider) els.translationProvider.value = settings.translationProvider || "gemini";
  els.clickTranslateEnabled.checked = Boolean(settings.clickTranslateEnabled);
  els.highlightEnabled.checked = Boolean(settings.highlightEnabled);
  els.autoSaveOnDoubleClick.checked = settings.autoSaveOnDoubleClick !== false;
  els.clickMode.value = settings.clickMode || "single";
}

function renderDeck() {
  const query = els.search.value.trim().toLowerCase();
  const visible = deck.filter((item) => {
    if (!query) return true;
    return item.word.toLowerCase().includes(query)
      || item.translation.toLowerCase().includes(query)
      || (item.meanings || []).join(" ").toLowerCase().includes(query)
      || (item.definitions || []).map((d) => `${d.partOfSpeech || ""} ${d.viDefinition || ""} ${d.definition || ""}`).join(" ").toLowerCase().includes(query);
  });
  els.deckList.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = deck.length ? "Không tìm thấy từ nào." : "Chưa có từ nào. Bôi đen một từ, bấm icon VI để dịch rồi lưu.";
    els.deckList.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const card = document.createElement("article");
    card.className = "vocab-card";

    const top = document.createElement("div");
    top.className = "vocab-top";

    const wordBox = document.createElement("div");
    wordBox.className = "vocab-main";

    const word = document.createElement("div");
    word.className = "vocab-word";
    word.textContent = item.word;

    const translation = document.createElement("div");
    translation.className = "vocab-translation";
    translation.textContent = item.translation;

    wordBox.append(word, translation);

    const del = document.createElement("button");
    del.className = "delete";
    del.type = "button";
    del.textContent = "Xóa";
    del.title = `Xóa ${item.word}`;
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        const result = await sendMessage({
          type: "DELETE_WORD",
          id: item.id,
          normalized: item.normalized,
          word: item.word
        });
        deck = result.deck || [];
        render();
      } catch (error) {
        alert(error.message || "Xóa từ lỗi");
        del.disabled = false;
      }
    });

    top.append(wordBox, del);
    card.appendChild(top);

    const meaningItems = uniqueTexts(item.meanings || [])
      .filter((x) => x.toLowerCase() !== String(item.translation || "").toLowerCase())
      .slice(0, 4);

    if (meaningItems.length) {
      const meanings = document.createElement("div");
      meanings.className = "vocab-meanings";
      for (const value of meaningItems) {
        const chip = document.createElement("span");
        chip.className = "vocab-chip";
        chip.textContent = value;
        meanings.appendChild(chip);
      }
      card.appendChild(meanings);
    }

    const definitionItems = Array.isArray(item.definitions)
      ? item.definitions.filter((d) => d && (d.viDefinition || d.definition || d.example || d.exampleVi)).slice(0, 2)
      : [];

    if (definitionItems.length) {
      const defs = document.createElement("div");
      defs.className = "vocab-defs";
      for (const d of definitionItems) {
        const box = document.createElement("div");
        box.className = "vocab-def";

        const head = document.createElement("div");
        head.className = "vocab-def-head";

        const pos = String(d.partOfSpeech || "").trim();
        const viText = String(d.viDefinition || d.definition || "").trim();
        const example = String(d.exampleVi || d.example || "").trim();

        if (pos) {
          const posEl = document.createElement("span");
          posEl.className = "vocab-pos";
          posEl.textContent = pos;
          head.appendChild(posEl);
        }

        if (viText) {
          const defText = document.createElement("span");
          defText.className = "vocab-def-text";
          defText.textContent = viText;
          head.appendChild(defText);
        }

        if (head.childNodes.length) box.appendChild(head);

        if (example) {
          const exampleEl = document.createElement("div");
          exampleEl.className = "vocab-example";
          exampleEl.textContent = example;
          box.appendChild(exampleEl);
        }

        defs.appendChild(box);
      }
      card.appendChild(defs);
    }

    const noteText = String(item.noteVi || "").trim();
    if (noteText) {
      const note = document.createElement("div");
      note.className = "vocab-note";
      note.textContent = noteText;
      card.appendChild(note);
    }

    if (item.sourceTitle) {
      const source = document.createElement("div");
      source.className = "vocab-source";
      source.textContent = item.sourceTitle;
      card.appendChild(source);
    }

    els.deckList.appendChild(card);
  }
}

function uniqueTexts(items) {
  const seen = new Set();
  const out = [];
  for (const raw of items || []) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeIconLabel(input) {
  const text = String(input || "VI").trim().replace(/\s+/g, "").slice(0, 3);
  return text || "VI";
}

function extractImportCards(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed.deck)) return parsed.deck;
  if (parsed.deck && typeof parsed.deck === "object" && Array.isArray(parsed.deck.cards)) return parsed.deck.cards;
  if (Array.isArray(parsed.cards)) return parsed.cards;
  return [];
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || "Extension error"));
        return;
      }
      resolve(response || { ok: true });
    });
  });
}
