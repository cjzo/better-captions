document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggle');
    const lang = document.getElementById('lang');
  
    chrome.storage.sync.get({ enabled: true, language: 'en' }, prefs => {
      toggle.checked = prefs.enabled;
      lang.value = prefs.language;
    });
  
    toggle.addEventListener('change', () => {
      chrome.storage.sync.set({ enabled: toggle.checked });
    });
  
    lang.addEventListener('change', () => {
      chrome.storage.sync.set({ language: lang.value });
    });
  });
  