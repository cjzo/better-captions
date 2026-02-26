document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const lang = document.getElementById('lang');
  const hideButton = document.getElementById('hide_button');
  const forceRefresh = document.getElementById('force_refresh');
  const fontSize = document.getElementById('font_size');
  const fontSizeValue = document.getElementById('font_size_value');
  const bottomOffset = document.getElementById('bottom_offset');
  const bottomOffsetValue = document.getElementById('bottom_offset_value');
  const style = document.getElementById('style');
  const hideNative = document.getElementById('hide_native');
  const bgOpacity = document.getElementById('bg_opacity');
  const bgOpacityValue = document.getElementById('bg_opacity_value');
  const textColor = document.getElementById('text_color');

  const DEFAULTS = {
    enabled: true,
    language: 'en',
    hideButton: false,
    forceRefresh: false,
    fontSize: 28,
    bottomOffsetPercent: 10,
    style: 'glass',
    hideNativeCaptions: true,
    bgOpacity: 45,
    textColor: 'auto'
  };

  const updateFontSizeLabel = value => {
    fontSizeValue.textContent = `${value}px`;
  };

  const updateBottomOffsetLabel = value => {
    bottomOffsetValue.textContent = `${value}%`;
  };

  const updateBgOpacityLabel = value => {
    bgOpacityValue.textContent = `${value}%`;
  };

  chrome.storage.sync.get(DEFAULTS, prefs => {
    toggle.checked = prefs.enabled;
    lang.value = prefs.language;
    hideButton.checked = prefs.hideButton;
    forceRefresh.checked = prefs.forceRefresh;
    fontSize.value = prefs.fontSize;
    bottomOffset.value = prefs.bottomOffsetPercent;
    style.value = prefs.style || DEFAULTS.style;
    hideNative.checked = prefs.hideNativeCaptions ?? DEFAULTS.hideNativeCaptions;
    bgOpacity.value = prefs.bgOpacity ?? DEFAULTS.bgOpacity;
    textColor.value = prefs.textColor ?? DEFAULTS.textColor;

    updateFontSizeLabel(prefs.fontSize);
    updateBottomOffsetLabel(prefs.bottomOffsetPercent);
    updateBgOpacityLabel(prefs.bgOpacity ?? DEFAULTS.bgOpacity);
  });

  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggle.checked });
  });

  lang.addEventListener('change', () => {
    chrome.storage.sync.set({ language: lang.value });
  });

  style.addEventListener('change', () => {
    chrome.storage.sync.set({ style: style.value });
  });

  hideButton.addEventListener('change', () => {
    chrome.storage.sync.set({ hideButton: hideButton.checked });
  });

  hideNative.addEventListener('change', () => {
    chrome.storage.sync.set({ hideNativeCaptions: hideNative.checked });
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

  bgOpacity.addEventListener('input', () => {
    const value = Number(bgOpacity.value);
    updateBgOpacityLabel(value);
    chrome.storage.sync.set({ bgOpacity: value });
  });

  textColor.addEventListener('change', () => {
    chrome.storage.sync.set({ textColor: textColor.value });
  });
});
