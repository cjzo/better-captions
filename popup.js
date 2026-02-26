document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const lang = document.getElementById('lang');
  const hideButton = document.getElementById('hide_button');
  const forceRefresh = document.getElementById('force_refresh');
  const fontSize = document.getElementById('font_size');
  const fontSizeValue = document.getElementById('font_size_value');
  const bottomOffset = document.getElementById('bottom_offset');
  const bottomOffsetValue = document.getElementById('bottom_offset_value');

  const DEFAULTS = {
    enabled: true,
    language: 'en',
    hideButton: false,
    forceRefresh: false,
    fontSize: 28,
    bottomOffsetPercent: 10
  };

  const updateFontSizeLabel = value => {
    fontSizeValue.textContent = `${value}px`;
  };

  const updateBottomOffsetLabel = value => {
    bottomOffsetValue.textContent = `${value}%`;
  };

  chrome.storage.sync.get(DEFAULTS, prefs => {
    toggle.checked = prefs.enabled;
    lang.value = prefs.language;
    hideButton.checked = prefs.hideButton;
    forceRefresh.checked = prefs.forceRefresh;
    fontSize.value = prefs.fontSize;
    bottomOffset.value = prefs.bottomOffsetPercent;

    updateFontSizeLabel(prefs.fontSize);
    updateBottomOffsetLabel(prefs.bottomOffsetPercent);
  });

  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggle.checked });
  });

  lang.addEventListener('change', () => {
    chrome.storage.sync.set({ language: lang.value });
  });

  hideButton.addEventListener('change', () => {
    chrome.storage.sync.set({ hideButton: hideButton.checked });
  });

  forceRefresh.addEventListener('change', () => {
    chrome.storage.sync.set({ forceRefresh: forceRefresh.checked });
  });

  fontSize.addEventListener('input', () => {
    const value = Number(fontSize.value);
    updateFontSizeLabel(value);
    chrome.storage.sync.set({ fontSize: value });
  });

  bottomOffset.addEventListener('input', () => {
    const value = Number(bottomOffset.value);
    updateBottomOffsetLabel(value);
    chrome.storage.sync.set({ bottomOffsetPercent: value });
  });
});
