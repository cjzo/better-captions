document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggle');
    const lang = document.getElementById('lang');
    const hideButton = document.getElementById('hide_button');
    const forceRefresh = document.getElementById('force_refresh');
  
    // Load saved preferences
    chrome.storage.sync.get(
      { 
        enabled: true, 
        language: 'en',
        hideButton: false,
        forceRefresh: true
      }, 
      prefs => {
        toggle.checked = prefs.enabled;
        lang.value = prefs.language;
        hideButton.checked = prefs.hideButton;
        forceRefresh.checked = prefs.forceRefresh;
      }
    );
  
    // Save preferences on change
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
  });