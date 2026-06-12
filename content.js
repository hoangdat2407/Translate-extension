let deck = [];
let settings = {
  selectionIconEnabled: true,
  clickTranslateEnabled: false,
  clickMode: "single",
  highlightEnabled: true,
  autoSaveOnDoubleClick: false,
  selectionIconLabel: "VI"
};

let lastDoubleClickAt = 0;
let highlightTimer = null;
let observer = null;
let highlightRunning = false;
let lastHighlightAt = 0;
let selectionDebounce = null;
let pendingSelection = null;
let lastPointer = { x: 16, y: 16 };
let uiHost = null;
let uiRoot = null;

const CHATGPT_HOST_RE = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i;
const isChatGptPage = CHATGPT_HOST_RE.test(location.hostname);

init();

async function init() {
  try {
    const state = await sendMessage({ type: "GET_STATE" });
    deck = state.deck || [];
    settings = { ...settings, ...(state.settings || {}) };
    installShadowUi();
    installListeners();
    scheduleHighlight();
    installMutationObserver();
  } catch (error) {
    console.warn("WordDeck init failed", error);
  }
}

function installListeners() {
  document.addEventListener("pointerdown", onPagePointerDown, true);
  document.addEventListener("pointerup", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    setTimeout(updateSelectionIconFromSelection, 60);
  }, true);

  document.addEventListener("selectionchange", scheduleSelectionIconUpdate, true);
  document.addEventListener("mouseup", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    setTimeout(updateSelectionIconFromSelection, 70);
  }, true);
  document.addEventListener("keyup", () => setTimeout(updateSelectionIconFromSelection, 70), true);

  // Click saved highlighted words to reopen their saved meaning without calling the translate API.
  document.addEventListener("click", onSavedHighlightClick, true);

  // Old click modes still exist, but selection-icon mode is the default.
  document.addEventListener("click", onPageClick, true);
  document.addEventListener("dblclick", onPageDoubleClick, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideAllUi();
  });

  document.addEventListener("scroll", () => hideSelectionIcon(), true);
}

function installMutationObserver() {
  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target;
      if (target?.nodeType === Node.ELEMENT_NODE) {
        if (target.closest?.("#worddeck-ui-root, .worddeck-highlight")) return false;
      }
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType === Node.ELEMENT_NODE && node.closest?.("#worddeck-ui-root, .worddeck-highlight")) return false;
      }
      return true;
    });
    if (relevant) scheduleHighlight();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: false });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DECK_CHANGED") {
    deck = message.deck || [];
    scheduleHighlight(true);
  }
  if (message?.type === "SETTINGS_CHANGED") {
    settings = { ...settings, ...(message.settings || {}) };
    applySelectionIconSettings();
    if (!settings.selectionIconEnabled) hideSelectionIcon();
    scheduleHighlight(true);
  }
});

function installShadowUi() {
  if (document.getElementById("worddeck-ui-root")) return;

  uiHost = document.createElement("div");
  uiHost.id = "worddeck-ui-root";
  uiHost.style.position = "fixed";
  uiHost.style.left = "0";
  uiHost.style.top = "0";
  uiHost.style.zIndex = "2147483647";
  uiHost.style.pointerEvents = "none";
  uiHost.style.all = "initial";
  document.documentElement.appendChild(uiHost);

  uiRoot = uiHost.attachShadow({ mode: "open" });
  uiRoot.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .hidden { display: none !important; }
      #selectionIcon {
        position: fixed;
        min-width: 34px;
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: linear-gradient(135deg, #27c7b8, #14b8a6);
        color: white;
        box-shadow: 0 12px 28px rgba(20, 184, 166, .38), 0 3px 9px rgba(0,0,0,.18);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
        pointer-events: auto;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: -.02em;
        transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
      }
      #selectionIcon:hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 16px 32px rgba(20, 184, 166, .42), 0 4px 12px rgba(0,0,0,.18); }
      #selectionIcon .spark { font-size: 14px; line-height: 1; }

      #panel {
        position: fixed;
        width: 440px;
        max-width: calc(100vw - 18px);
        border: 1px solid rgba(15, 118, 110, .34);
        border-radius: 12px;
        overflow: hidden;
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 20px 52px rgba(15, 23, 42, .24);
        pointer-events: auto;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .bar {
        min-height: 38px;
        background: linear-gradient(90deg, #2dd4bf, #14b8a6);
        color: #ffffff;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 9px;
      }
      .icon-btn, .close {
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.18);
        color: white;
        cursor: pointer;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        transition: transform .12s ease, background .12s ease;
      }
      .icon-btn:hover, .close:hover { transform: translateY(-1px); background: rgba(255,255,255,.28); }
      .close { margin-left: auto; font-size: 20px; background: transparent; }
      .lang-pill {
        height: 24px;
        min-width: 54px;
        border-radius: 7px;
        border: 1px solid rgba(255,255,255,.5);
        background: #ffffff;
        color: #0f766e;
        font-size: 12px;
        font-weight: 900;
        padding: 2px 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .arrow { font-weight: 900; opacity: .95; }
      .body { padding: 11px 14px 13px; background: #fff; }
      .brand {
        display: flex;
        align-items: center;
        gap: 9px;
        color: #334155;
        font-size: 16px;
        font-style: italic;
        margin-bottom: 9px;
      }
      .review-btn {
        width: 27px;
        height: 27px;
        border: 1px solid #99f6e4;
        background: #ecfeff;
        color: #14b8a6;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        cursor: pointer;
      }
      .review-btn:hover { filter: brightness(.98); transform: translateY(-1px); }
      .divider { border-top: 1px dotted #9ca3af; margin: 0 -14px 10px; }
      .result {
        display: grid;
        grid-template-columns: 1fr 40px;
        gap: 12px;
        align-items: start;
        min-height: 50px;
      }
      .word-row { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
      .bullet { color: #0f172a; font-weight: 900; }
      #panelWord { font-size: 16px; font-weight: 900; color: #0f172a; overflow-wrap: anywhere; }
      #panelTranslation { margin: 2px 0 0 18px; color: #0f766e; font-size: 14px; font-style: italic; overflow-wrap: anywhere; }
      #panelMeanings { margin: 8px 0 0 18px; display: flex; flex-wrap: wrap; gap: 6px; }
      .meaning-chip { max-width: 100%; border-radius: 999px; background: #ecfeff; border: 1px solid #99f6e4; color: #0f766e; padding: 4px 8px; font-size: 12px; font-weight: 800; overflow-wrap: anywhere; }
      #panelDefinitions { margin: 9px 0 0 18px; color: #475569; font-size: 13px; line-height: 1.45; }
      .definition-line { margin-top: 5px; }
      .pos { color: #0f766e; font-weight: 900; }
      .check {
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 999px;
        background: #2dd4bf;
        color: white;
        font-size: 19px;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(20,184,166,.28);
      }
      .check:hover { transform: translateY(-1px); }
      .auto {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        color: #0f766e;
        font-size: 12px;
        font-weight: 900;
      }
      .auto-dot {
        width: 15px;
        height: 15px;
        border-radius: 4px;
        background: #2dd4bf;
        color: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 900;
      }
      .note {
        margin: 8px -14px -13px;
        padding: 9px 14px;
        background: #fff7df;
        border-top: 1px solid #f8d77b;
        color: #6b4e00;
        font-size: 12px;
        line-height: 1.4;
      }
      .error .check { background: #fb7185; }
      .error #panelTranslation { color: #be123c; }
    </style>
    <button id="selectionIcon" class="hidden" type="button" title="Dịch và tự lưu vào WordDeck"><span class="spark">☻</span><span id="iconLabel">VI</span></button>
    <section id="panel" class="hidden" role="dialog" aria-label="WordDeck translation">
      <div class="bar">
        <button id="settingsBtn" class="icon-btn" title="Mở cài đặt WordDeck">⚙</button>
        <span class="lang-pill" title="Ngôn ngữ nguồn">en</span>
        <span class="arrow">»</span>
        <span class="lang-pill" title="Ngôn ngữ đích">vi</span>
        <button id="closeBtn" class="close" title="Đóng">×</button>
      </div>
      <div class="body">
        <div class="brand"><button id="reviewBtn" class="review-btn" title="Mở ôn tập deck">▶</button><span>WordDeck</span></div>
        <div class="divider"></div>
        <div class="result">
          <div>
            <div class="word-row"><span class="bullet">•</span><span id="panelWord">word</span></div>
            <div id="panelTranslation">Đang dịch...</div>
            <div id="panelMeanings"></div>
            <div id="panelDefinitions"></div>
          </div>
          <button class="check" id="savedMark" title="Đã lưu — mở ôn tập deck">✓</button>
        </div>
        <div class="auto"><span class="auto-dot">✓</span><span>Auto-saved to deck</span></div>
        <div class="note" id="panelStatus">Click icon là tự dịch và tự lưu vào deck.</div>
      </div>
    </section>
  `;

  const icon = uiRoot.getElementById("selectionIcon");
  const closeBtn = uiRoot.getElementById("closeBtn");
  const settingsBtn = uiRoot.getElementById("settingsBtn");
  const reviewBtn = uiRoot.getElementById("reviewBtn");
  const savedMark = uiRoot.getElementById("savedMark");

  icon.addEventListener("mousedown", preserveSelectionEvent, true);
  icon.addEventListener("pointerdown", preserveSelectionEvent, true);
  icon.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const info = pendingSelection || getSelectedWordInfo(true);
    if (!info?.word) return hideSelectionIcon();
    hideSelectionIcon();
    await translateAndAutoSaveSelection(info);
  });

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    hidePanel();
  });

  settingsBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openWordDeckOptions();
  });

  reviewBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openWordDeckReview();
  });

  savedMark.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openWordDeckReview();
  });

  applySelectionIconSettings();
}

function openWordDeckOptions() {
  try {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
  } catch (_) {}
  try { window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener"); } catch (_) {}
}

function openWordDeckReview() {
  try { window.open(chrome.runtime.getURL("review.html"), "_blank", "noopener"); } catch (_) {}
}

function preserveSelectionEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

function isInsideWordDeckUi(event) {
  const path = event.composedPath?.() || [];
  return Boolean(uiHost && path.includes(uiHost));
}

function onPagePointerDown(event) {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (isInsideWordDeckUi(event)) return;
  hideAllUi();
}

function scheduleSelectionIconUpdate() {
  if (!settings.selectionIconEnabled) return;
  clearTimeout(selectionDebounce);
  selectionDebounce = setTimeout(updateSelectionIconFromSelection, 120);
}

function updateSelectionIconFromSelection() {
  if (!settings.selectionIconEnabled || !uiRoot) return;

  const selectionInfo = getSelectedWordInfo(true);
  if (!selectionInfo?.word) {
    hideSelectionIcon();
    return;
  }

  pendingSelection = selectionInfo;
  showSelectionIcon(selectionInfo);
}

function showSelectionIcon(selectionInfo) {
  const icon = uiRoot?.getElementById("selectionIcon");
  if (!icon) return;
  applySelectionIconSettings();

  const rect = selectionInfo.rect || { left: lastPointer.x, right: lastPointer.x, top: lastPointer.y, bottom: lastPointer.y, width: 1, height: 1 };
  const iconWidth = Math.max(34, 22 + getSelectionIconLabel().length * 8);
  const iconHeight = 34;
  const margin = 7;
  let left = rect.right + margin;
  let top = rect.bottom + margin;

  if (left + iconWidth + 8 > window.innerWidth) left = Math.max(8, rect.left - iconWidth - margin);
  if (top + iconHeight + 8 > window.innerHeight) top = Math.max(8, rect.top - iconHeight - margin);

  icon.style.left = `${Math.round(left)}px`;
  icon.style.top = `${Math.round(top)}px`;
  icon.classList.remove("hidden");
}

function getSelectionIconLabel() {
  const text = String(settings.selectionIconLabel || "VI").trim().replace(/\s+/g, "").slice(0, 3);
  return text || "VI";
}

function applySelectionIconSettings() {
  const label = uiRoot?.getElementById("iconLabel");
  if (label) label.textContent = getSelectionIconLabel();
}

function hideSelectionIcon() {
  const icon = uiRoot?.getElementById("selectionIcon");
  if (icon) icon.classList.add("hidden");
  pendingSelection = null;
}

function hidePanel() {
  const panel = uiRoot?.getElementById("panel");
  if (panel) panel.classList.add("hidden");
}

function hideAllUi() {
  hideSelectionIcon();
  hidePanel();
}

async function translateAndAutoSaveSelection(selectionInfo) {
  const { word, context, rect } = selectionInfo;
  const point = getPanelPoint(rect);

  showPanel({
    x: point.x,
    y: point.y,
    word,
    translation: "Đang dịch...",
    status: "Đang gọi API dịch, xong sẽ tự lưu vào deck.",
    loading: true
  });

  try {
    const result = await sendMessage({ type: "TRANSLATE_WORD", word });
    if (!result.ok) throw new Error(result.error || "Translate failed");

    const saveResult = await sendMessage({
      type: "SAVE_WORD",
      payload: {
        word: result.word,
        translation: result.translation,
        meanings: result.meanings || [],
        definitions: result.definitions || [],
        provider: result.provider || "",
        context,
        sourceUrl: location.href,
        sourceTitle: document.title
      }
    });
    if (!saveResult.ok) throw new Error(saveResult.error || "Save failed");

    deck = saveResult.deck || deck;
    scheduleHighlight(true);

    showPanel({
      x: point.x,
      y: point.y,
      word: result.word,
      translation: result.translation,
      meanings: result.meanings || [],
      definitions: result.definitions || [],
      provider: result.provider || "",
      status: result.fromDeck ? "Từ này đã có trong deck, vừa cập nhật số lần gặp." : "Đã tự lưu vào deck. Mở popup extension để xem list/ôn tập.",
      saved: true
    });
  } catch (error) {
    showPanel({
      x: point.x,
      y: point.y,
      word,
      translation: error.message || "Không dịch được",
      status: "Lỗi dịch/lưu. Kiểm tra mạng hoặc API dịch.",
      error: true
    });
  }
}

function getPanelPoint(rect) {
  const fallbackX = lastPointer.x || 16;
  const fallbackY = lastPointer.y || 16;
  if (!rect) return { x: fallbackX, y: fallbackY };
  return {
    x: Math.min(rect.right + 10, window.innerWidth - 20),
    y: Math.min(rect.bottom + 12, window.innerHeight - 20)
  };
}

function showPanel({ x, y, word, translation, meanings = [], definitions = [], provider = "", status, loading = false, saved = false, error = false }) {
  const panel = uiRoot?.getElementById("panel");
  if (!panel) return;

  uiRoot.getElementById("panelWord").textContent = word || "";
  uiRoot.getElementById("panelTranslation").textContent = translation || "";
  uiRoot.getElementById("panelStatus").textContent = provider && !error ? `${status || ""} · ${provider}` : (status || "");
  uiRoot.getElementById("savedMark").textContent = loading ? "…" : error ? "!" : saved ? "✓" : "✓";
  renderPanelMeanings(meanings, translation);
  renderPanelDefinitions(definitions);

  panel.classList.toggle("error", Boolean(error));
  panel.classList.remove("hidden");
  positionPanel(panel, x, y);
}

function renderPanelMeanings(meanings, translation) {
  const box = uiRoot?.getElementById("panelMeanings");
  if (!box) return;
  box.innerHTML = "";
  const items = uniqueTexts([...(Array.isArray(meanings) ? meanings : []), translation]).slice(0, 8);
  for (const text of items) {
    if (!text || text === translation && items.length <= 1) continue;
    const chip = document.createElement("span");
    chip.className = "meaning-chip";
    chip.textContent = text;
    box.appendChild(chip);
  }
}

function renderPanelDefinitions(definitions) {
  const box = uiRoot?.getElementById("panelDefinitions");
  if (!box) return;
  box.innerHTML = "";
  const items = Array.isArray(definitions) ? definitions.slice(0, 5) : [];
  for (const item of items) {
    const text = String(item.viDefinition || item.definition || "").trim();
    if (!text) continue;
    const div = document.createElement("div");
    div.className = "definition-line";
    const pos = item.partOfSpeech ? `<span class="pos">${escapeHtml(item.partOfSpeech)}</span>: ` : "";
    div.innerHTML = `${pos}${escapeHtml(text)}`;
    box.appendChild(div);
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

function escapeHtml(text) {
  return String(text || "").replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[ch]));
}

function positionPanel(panel, x, y) {
  const margin = 10;
  const panelWidth = Math.min(440, Math.max(300, window.innerWidth - 18));
  const panelHeight = 340;
  let left = x + margin;
  let top = y + margin;

  if (left + panelWidth + 8 > window.innerWidth) left = Math.max(8, window.innerWidth - panelWidth - 8);
  if (top + panelHeight + 8 > window.innerHeight) top = Math.max(8, y - panelHeight - margin);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}


function onSavedHighlightClick(event) {
  const target = event.target?.closest?.(".worddeck-highlight");
  if (!target) return;

  // Let the user select/copy text without the popup fighting the selection.
  const selected = window.getSelection?.().toString().trim();
  if (selected && selected.length > 1) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const word = target.dataset.worddeckWord || target.textContent || "";
  const entry = findDeckEntry(word);
  if (!entry) return;

  hideSelectionIcon();
  const rect = target.getBoundingClientRect?.() || makeFallbackRect(event.clientX, event.clientY);
  const point = getPanelPoint(rect);
  showPanel({
    x: point.x,
    y: point.y,
    word: entry.word || target.textContent || word,
    translation: entry.translation || "Đã lưu trong deck",
    meanings: entry.meanings || [],
    definitions: entry.definitions || [],
    provider: entry.provider || "deck",
    status: "Từ đã lưu trong deck. Click từ highlight ở trang khác cũng hiện nghĩa như này.",
    saved: true
  });
}

function findDeckEntry(word) {
  const normalized = String(word || "").toLowerCase().trim();
  if (!normalized) return null;
  return deck.find((item) => item.normalized === normalized || String(item.word || "").toLowerCase() === normalized) || null;
}

async function onPageDoubleClick(event) {
  lastDoubleClickAt = Date.now();
  if (settings.selectionIconEnabled) {
    setTimeout(updateSelectionIconFromSelection, 60);
    return;
  }
  if (!settings.clickTranslateEnabled) return;
  if (shouldIgnoreTarget(event.target)) return;

  await handleTranslateEvent(event, {
    useSelection: true,
    autoSave: Boolean(settings.autoSaveOnDoubleClick),
    forceHandle: true
  });
}

function onPageClick(event) {
  if (settings.selectionIconEnabled) return;
  if (!settings.clickTranslateEnabled) return;
  if (isInsideWordDeckUi(event)) return;

  if (settings.clickMode === "double") return;
  if (Date.now() - lastDoubleClickAt < 350) return;
  if (settings.clickMode === "alt" && !event.altKey) return;

  handleTranslateEvent(event, { useSelection: false, autoSave: false, forceHandle: false });
}

async function handleTranslateEvent(event, options = {}) {
  if (!settings.clickTranslateEnabled) return;
  if (!options.forceHandle && shouldIgnoreTarget(event.target)) return;

  if (settings.clickMode === "alt" || settings.clickMode === "double" || options.autoSave) {
    event.preventDefault();
    event.stopPropagation();
  }

  const wordInfo = await getBestWordInfo(event, options.useSelection);
  if (!wordInfo?.word) return;

  const { word, context, rect } = wordInfo;
  const point = rect ? getPanelPoint(rect) : { x: event.clientX, y: event.clientY };
  showPanel({ x: point.x, y: point.y, word, translation: "Đang dịch...", status: "Đang dịch...", loading: true });

  try {
    const result = await sendMessage({ type: "TRANSLATE_WORD", word });
    if (!result.ok) throw new Error(result.error || "Translate failed");

    let saved = Boolean(result.fromDeck);
    if (options.autoSave || !result.fromDeck) {
      const saveResult = await sendMessage({
        type: "SAVE_WORD",
        payload: {
          word: result.word,
          translation: result.translation,
          meanings: result.meanings || [],
          definitions: result.definitions || [],
          provider: result.provider || "",
          context,
          sourceUrl: location.href,
          sourceTitle: document.title
        }
      });
      if (!saveResult.ok) throw new Error(saveResult.error || "Save failed");
      deck = saveResult.deck || deck;
      saved = true;
      scheduleHighlight(true);
    }

    showPanel({
      x: point.x,
      y: point.y,
      word: result.word,
      translation: result.translation,
      meanings: result.meanings || [],
      definitions: result.definitions || [],
      provider: result.provider || "",
      status: saved ? "Đã tự lưu vào deck." : "Đã dịch.",
      saved
    });
  } catch (error) {
    showPanel({ x: point.x, y: point.y, word, translation: error.message || "Không dịch được", status: "Lỗi dịch/lưu.", error: true });
  }
}

function shouldIgnoreTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
  const el = target;
  if (el.closest("#worddeck-ui-root, .worddeck-highlight")) return true;
  if (el.closest("input, textarea, select, button, option, [contenteditable='true'], [role='textbox']")) return true;
  if (settings.clickMode === "single" && el.closest("a")) return true;
  return false;
}

async function getBestWordInfo(event, useSelection) {
  if (useSelection) {
    await delay(35);
    const selected = getSelectedWordInfo(false);
    if (selected?.word) return selected;
  }

  return getWordAtPoint(event.clientX, event.clientY);
}

function getSelectedWordInfo(requireVisibleRange = false) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const selectedText = selection.toString().trim();
  const word = normalizeWord(selectedText);
  if (!word || word.length < 2) return null;

  let range;
  let rect;
  let context = selectedText;
  try {
    range = selection.getRangeAt(0).cloneRange();
    rect = getVisibleRangeRect(range) || makeFallbackRect(lastPointer.x, lastPointer.y);
    const containerText = getNearestReadableText(range.commonAncestorContainer);
    if (containerText) context = makeContext(containerText, word);
  } catch (_) {
    rect = makeFallbackRect(lastPointer.x, lastPointer.y);
  }

  if (requireVisibleRange && !rect) return null;
  return { word, context, rect };
}

function getVisibleRangeRect(range) {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length) return rects[rects.length - 1];
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  return null;
}

function makeFallbackRect(x, y) {
  return { left: x, right: x, top: y, bottom: y, width: 1, height: 1 };
}

function getNearestReadableText(node) {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current && current !== document.body && current.nodeType === Node.ELEMENT_NODE) {
    const text = (current.innerText || current.textContent || "").replace(/\s+/g, " ").trim();
    if (text && text.length >= 8 && text.length <= 1600) return text;
    current = current.parentElement;
  }
  return "";
}

function getWordAtPoint(x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }

  if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const textNode = range.startContainer;
  const text = textNode.nodeValue || "";
  let offset = range.startOffset;

  if (offset >= text.length) offset = text.length - 1;
  if (offset > 0 && !isWordChar(text[offset]) && isWordChar(text[offset - 1])) offset -= 1;
  if (!isWordChar(text[offset])) return null;

  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;

  const rawWord = text.slice(start, end);
  const word = normalizeWord(rawWord);
  if (!word || word.length < 2) return null;

  const contextStart = Math.max(0, start - 80);
  const contextEnd = Math.min(text.length, end + 80);
  const context = text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();
  const rect = range.getBoundingClientRect?.() || makeFallbackRect(x, y);
  return { word, context, rect };
}

function makeContext(text, word) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(String(word).toLowerCase());
  if (idx < 0) return clean.slice(0, 220);
  const start = Math.max(0, idx - 90);
  const end = Math.min(clean.length, idx + word.length + 90);
  return clean.slice(start, end).trim();
}

function isWordChar(ch) {
  return Boolean(ch && /[A-Za-z'’-]/.test(ch));
}

function normalizeWord(input) {
  const match = String(input || "").trim().match(/[A-Za-z][A-Za-z'’-]{0,48}/);
  return match ? match[0].replace(/[’]/g, "'") : "";
}

function scheduleHighlight(force = false) {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (!settings.highlightEnabled) {
      if (force) unwrapHighlights();
      return;
    }
    highlightSavedWords(force);
  }, force ? 140 : 850);
}

function highlightSavedWords(force = false) {
  if (highlightRunning) return;
  if (!document.body || !deck.length) {
    if (force) unwrapHighlights();
    return;
  }

  const now = Date.now();
  if (!force && now - lastHighlightAt < 1800) return;
  lastHighlightAt = now;

  highlightRunning = true;
  try {
    if (force) unwrapHighlights();

    const words = [...new Set(deck.map((item) => item.normalized).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .slice(0, 300);
    if (!words.length) return;

    const escaped = words.map(escapeRegex).join("|");
    const regex = new RegExp(`\\b(${escaped})\\b`, "gi");

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("#worddeck-ui-root, .worddeck-highlight, script, style, textarea, input, select, button, [contenteditable='true'], [role='textbox']")) {
            return NodeFilter.FILTER_REJECT;
          }
          regex.lastIndex = 0;
          if (!regex.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          regex.lastIndex = 0;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode()) && nodes.length < 1000) nodes.push(node);

    for (const textNode of nodes) {
      const text = textNode.nodeValue;
      regex.lastIndex = 0;
      if (!regex.test(text)) continue;
      regex.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        const index = match.index;
        const matchedText = match[0];
        if (index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        const span = document.createElement("span");
        span.className = "worddeck-highlight";
        span.dataset.worddeckWord = matchedText.toLowerCase();
        span.textContent = matchedText;
        span.title = getHighlightTitle(matchedText);
        fragment.appendChild(span);
        lastIndex = index + matchedText.length;
      }
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  } finally {
    highlightRunning = false;
  }
}

function unwrapHighlights() {
  const spans = document.querySelectorAll(".worddeck-highlight");
  for (const span of spans) {
    span.replaceWith(document.createTextNode(span.textContent || ""));
  }
}

function getTranslationFor(word) {
  const normalized = String(word || "").toLowerCase();
  return deck.find((item) => item.normalized === normalized)?.translation || "";
}

function getHighlightTitle(word) {
  const entry = findDeckEntry(word);
  if (!entry) return "WordDeck: từ đã lưu";
  const meaning = entry.translation || (entry.meanings || [])[0] || "từ đã lưu";
  return `WordDeck: ${meaning} — click để xem nghĩa`;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
