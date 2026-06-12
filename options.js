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
  save: document.getElementById("save"),
  status: document.getElementById("status")
};

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
  els.redirectUri.value = state.redirectUri || chrome.identity.getRedirectURL("oauth2");

  els.copyRedirect.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.redirectUri.value);
    els.status.textContent = "Đã copy Redirect URI.";
    setTimeout(() => (els.status.textContent = ""), 1800);
  });

  els.save.addEventListener("click", saveSettings);
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
        clickMode: els.clickMode.value
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
