const els = {
  googleClientId: document.getElementById("googleClientId"),
  redirectUri: document.getElementById("redirectUri"),
  copyRedirect: document.getElementById("copyRedirect"),
  myMemoryEmail: document.getElementById("myMemoryEmail"),
  geminiApiKey: document.getElementById("geminiApiKey"),
  geminiModel: document.getElementById("geminiModel"),
  translationProvider: document.getElementById("translationProvider"),
  selectionIconEnabled: document.getElementById("selectionIconEnabled"),
  selectionIconLabel: document.getElementById("selectionIconLabel"),
  clickTranslateEnabled: document.getElementById("clickTranslateEnabled"),
  highlightEnabled: document.getElementById("highlightEnabled"),
  autoSaveOnDoubleClick: document.getElementById("autoSaveOnDoubleClick"),
  clickMode: document.getElementById("clickMode"),
  customIconFile: document.getElementById("customIconFile"),
  clearCustomIcon: document.getElementById("clearCustomIcon"),
  iconPreview: document.getElementById("iconPreview"),
  save: document.getElementById("save"),
  status: document.getElementById("status")
};

let customIconDataUrl = "";

init();

async function init() {
  const state = await sendMessage({ type: "GET_STATE" });
  const settings = state.settings || {};
  els.googleClientId.value = settings.googleClientId || "";
  els.myMemoryEmail.value = settings.myMemoryEmail || "";
  els.geminiApiKey.value = settings.geminiApiKey || "";
  els.geminiModel.value = settings.geminiModel || "gemini-2.5-flash";
  els.translationProvider.value = settings.translationProvider || "gemini";
  els.selectionIconEnabled.checked = settings.selectionIconEnabled !== false;
  els.selectionIconLabel.value = settings.selectionIconLabel || "VI";
  els.clickTranslateEnabled.checked = Boolean(settings.clickTranslateEnabled);
  els.highlightEnabled.checked = Boolean(settings.highlightEnabled);
  els.autoSaveOnDoubleClick.checked = settings.autoSaveOnDoubleClick !== false;
  els.clickMode.value = settings.clickMode || "single";
  customIconDataUrl = settings.customIconDataUrl || "";
  renderIconPreview();
  els.redirectUri.value = state.redirectUri || chrome.identity.getRedirectURL("oauth2");

  els.copyRedirect.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.redirectUri.value);
    els.status.textContent = "Đã copy Redirect URI.";
    setTimeout(() => (els.status.textContent = ""), 1800);
  });

  els.save.addEventListener("click", saveSettings);
  if (els.customIconFile) els.customIconFile.addEventListener("change", handleIconFileChange);
  if (els.clearCustomIcon) els.clearCustomIcon.addEventListener("click", () => {
    customIconDataUrl = "";
    if (els.customIconFile) els.customIconFile.value = "";
    renderIconPreview();
  });
  if (els.selectionIconLabel) els.selectionIconLabel.addEventListener("input", renderIconPreview);
}

async function saveSettings() {
  els.save.disabled = true;
  els.status.textContent = "Đang lưu...";
  try {
    await sendMessage({
      type: "UPDATE_SETTINGS",
      patch: {
        googleClientId: els.googleClientId.value.trim(),
        myMemoryEmail: els.myMemoryEmail.value.trim(),
        geminiApiKey: els.geminiApiKey.value.trim(),
        geminiModel: els.geminiModel.value.trim() || "gemini-2.5-flash",
        translationProvider: els.translationProvider.value,
        selectionIconEnabled: els.selectionIconEnabled.checked,
        selectionIconLabel: normalizeIconLabel(els.selectionIconLabel.value),
        clickTranslateEnabled: els.clickTranslateEnabled.checked,
        highlightEnabled: els.highlightEnabled.checked,
        autoSaveOnDoubleClick: els.autoSaveOnDoubleClick.checked,
        clickMode: els.clickMode.value,
        customIconDataUrl
      }
    });
    els.status.textContent = "Đã lưu.";
  } catch (error) {
    els.status.textContent = error.message || "Lưu lỗi";
  } finally {
    els.save.disabled = false;
    setTimeout(() => (els.status.textContent = ""), 2200);
  }
}

function normalizeIconLabel(input) {
  const text = String(input || "VI").trim().replace(/\s+/g, "").slice(0, 3);
  return text || "VI";
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

async function handleIconFileChange() {
  const file = els.customIconFile?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    els.status.textContent = "File khong phai anh.";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    els.status.textContent = "Anh qua lon. Chon anh nho hon 10MB.";
    return;
  }

  els.status.textContent = "Dang xu ly anh...";
  customIconDataUrl = await resizeIconImage(file);
  renderIconPreview();
  els.status.textContent = "Da tai anh icon. Bam Luu cau hinh de ap dung.";
}

function renderIconPreview() {
  if (!els.iconPreview) return;
  els.iconPreview.textContent = "";
  els.iconPreview.style.backgroundImage = "";
  if (customIconDataUrl) {
    els.iconPreview.classList.add("has-image");
    els.iconPreview.style.backgroundImage = `url("${customIconDataUrl}")`;
  } else {
    els.iconPreview.classList.remove("has-image");
    els.iconPreview.textContent = normalizeIconLabel(els.selectionIconLabel?.value || "VI");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Khong doc duoc anh"));
    reader.readAsDataURL(file);
  });
}

async function resizeIconImage(file) {
  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, size, size);
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (size - width) / 2;
  const y = (size - height) / 2;
  context.drawImage(image, x, y, width, height);

  return canvas.toDataURL("image/webp", 0.86);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Khong load duoc anh"));
    image.src = src;
  });
}
