let deck = [];
let visible = [];
let index = 0;
let revealed = false;

const els = {
  summary: document.getElementById("summary"),
  shuffle: document.getElementById("shuffle"),
  search: document.getElementById("search"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  card: document.getElementById("card"),
  word: document.getElementById("word"),
  translation: document.getElementById("translation"),
  context: document.getElementById("context"),
  source: document.getElementById("source"),
  reveal: document.getElementById("reveal"),
  deleteWord: document.getElementById("deleteWord"),
  exportDeck: document.getElementById("exportDeck"),
  miniList: document.getElementById("miniList")
};

init();

async function init() {
  const state = await sendMessage({ type: "GET_STATE" });
  deck = state.deck || [];
  visible = [...deck];
  bindEvents();
  render();
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    const q = els.search.value.trim().toLowerCase();
    visible = deck.filter((item) => {
      if (!q) return true;
      return item.word.toLowerCase().includes(q)
      || item.translation.toLowerCase().includes(q)
      || (item.meanings || []).join(" ").toLowerCase().includes(q)
      || (item.definitions || []).map((d) => `${d.partOfSpeech || ""} ${d.viDefinition || ""} ${d.definition || ""}`).join(" ").toLowerCase().includes(q);
    });
    index = 0;
    revealed = false;
    render();
  });

  els.shuffle.addEventListener("click", () => {
    visible = shuffleArray([...visible]);
    index = 0;
    revealed = false;
    render();
  });
  els.prev.addEventListener("click", prevCard);
  els.next.addEventListener("click", nextCard);
  els.card.addEventListener("click", toggleReveal);
  els.reveal.addEventListener("click", toggleReveal);
  els.deleteWord.addEventListener("click", deleteCurrent);
  els.exportDeck.addEventListener("click", exportDeck);

  document.addEventListener("keydown", (event) => {
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      toggleReveal();
    } else if (event.key === "ArrowRight") {
      nextCard();
    } else if (event.key === "ArrowLeft") {
      prevCard();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "DECK_CHANGED") {
      deck = message.deck || [];
      const q = els.search.value.trim().toLowerCase();
      visible = deck.filter((item) => !q || item.word.toLowerCase().includes(q)
        || item.translation.toLowerCase().includes(q)
        || (item.meanings || []).join(" ").toLowerCase().includes(q)
        || (item.definitions || []).map((d) => `${d.partOfSpeech || ""} ${d.viDefinition || ""} ${d.definition || ""}`).join(" ").toLowerCase().includes(q));
      if (index >= visible.length) index = Math.max(0, visible.length - 1);
      render();
    }
  });
}

function render() {
  els.summary.textContent = `${deck.length} từ trong deck${visible.length !== deck.length ? ` · đang lọc ${visible.length}` : ""}`;

  if (!visible.length) {
    els.word.textContent = "Chưa có từ";
    els.translation.textContent = "Bôi đen từ trên web → bấm icon → Lưu vào deck";
    els.translation.classList.remove("hidden-text");
    els.context.textContent = "";
    els.source.textContent = "";
    els.reveal.disabled = true;
    els.deleteWord.disabled = true;
    renderMiniList();
    return;
  }

  index = clamp(index, 0, visible.length - 1);
  const item = visible[index];
  els.word.textContent = item.word;
  els.translation.textContent = revealed ? buildAnswerText(item) : "Click để hiện nghĩa";
  els.translation.classList.toggle("hidden-text", !revealed);
  els.context.textContent = revealed && item.context ? item.context : "";
  els.source.textContent = revealed && item.sourceTitle ? `Nguồn: ${item.sourceTitle}` : "";
  els.reveal.textContent = revealed ? "Ẩn nghĩa" : "Hiện nghĩa";
  els.reveal.disabled = false;
  els.deleteWord.disabled = false;
  renderMiniList();
}

function renderMiniList() {
  els.miniList.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Deck trống.";
    els.miniList.appendChild(empty);
    return;
  }
  visible.slice(0, 120).forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "mini-item" + (i === index ? " active" : "");
    el.addEventListener("click", () => {
      index = i;
      revealed = false;
      render();
      els.card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const w = document.createElement("div");
    w.className = "mini-word";
    w.textContent = item.word;
    const t = document.createElement("div");
    t.className = "mini-trans";
    t.textContent = item.translation;
    el.append(w, t);
    els.miniList.appendChild(el);
  });
}

function buildAnswerText(item) {
  const parts = [item.translation];
  const extras = uniqueTexts(item.meanings || []).filter((x) => x.toLowerCase() !== String(item.translation || "").toLowerCase()).slice(0, 5);
  if (extras.length) parts.push(`Nghĩa khác: ${extras.join("; ")}`);
  const defs = Array.isArray(item.definitions) ? item.definitions.slice(0, 3) : [];
  for (const d of defs) {
    const text = String(d.viDefinition || d.definition || "").trim();
    if (text) parts.push(`${d.partOfSpeech ? d.partOfSpeech + ": " : ""}${text}`);
  }
  return parts.filter(Boolean).join("\n");
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

function toggleReveal() {
  if (!visible.length) return;
  revealed = !revealed;
  render();
}

function nextCard() {
  if (!visible.length) return;
  index = (index + 1) % visible.length;
  revealed = false;
  render();
}

function prevCard() {
  if (!visible.length) return;
  index = (index - 1 + visible.length) % visible.length;
  revealed = false;
  render();
}

async function deleteCurrent() {
  const item = visible[index];
  if (!item) return;
  if (!confirm(`Xóa "${item.word}" khỏi deck?`)) return;
  const result = await sendMessage({ type: "DELETE_WORD", normalized: item.normalized });
  deck = result.deck || [];
  visible = visible.filter((x) => x.normalized !== item.normalized);
  if (index >= visible.length) index = Math.max(0, visible.length - 1);
  revealed = false;
  render();
}

function exportDeck() {
  const blob = new Blob([JSON.stringify({ deck, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worddeck-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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
