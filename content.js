// YouTube Caption Extension - content.js
console.log("[Better Captions] Extension loaded");

// Extension state
const state = {
  enabled: true,       // Default to enabled
  language: 'en',      // Default language
  hideButton: false,   // Default to showing the button
  forceRefresh: true,  // Default to force refresh on new videos
  captionsActive: false,
  activeIntervalId: null,
  captionUpdateIntervalId: null,
  navigationObserver: null,
  currentVideoId: null
};

// Wait for player to be ready
function waitForVideoAndPlayerResponse() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      const video = document.querySelector('video');
      
      // Try multiple possible player data locations
      let playerData = null;
      
      try {
        // Method 1: Direct window properties
        playerData = window.ytInitialPlayerResponse || window.__PLAYER_RESPONSE__;
        
        // Method 2: Parse from ytplayer config if available
        if (!playerData && window.ytplayer && window.ytplayer.config) {
          const playerResponse = window.ytplayer.config.args && 
            window.ytplayer.config.args.player_response;
          if (playerResponse) {
            try {
              playerData = JSON.parse(playerResponse);
            } catch (e) {
              console.log("[Better Captions] Failed to parse player_response");
            }
          }
        }
        
        // Method 3: Extract from page source as last resort
        if (!playerData) {
          const scriptElements = document.querySelectorAll('script');
          for (const script of scriptElements) {
            const text = script.textContent;
            if (text && text.includes('ytInitialPlayerResponse')) {
              const match = text.match(/ytInitialPlayerResponse\s*=\s*({.*?});/s);
              if (match && match[1]) {
                try {
                  playerData = JSON.parse(match[1]);
                  break;
                } catch (e) {
                  console.log("[Better Captions] Failed to parse from script tag");
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("[Better Captions] Error accessing player data:", e);
      }
      
      if (video && playerData) {
        clearInterval(interval);
        resolve({ video, playerData });
      }
      
      if (++attempts > 100) {
        clearInterval(interval);
        reject(new Error("Timeout: video/player not found."));
      }
    }, 300);
  });
}

function getCaptionTrackUrl(playerData) {
  try {
    // Handle more potential paths to captions data
    const tracks = 
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || 
      playerData?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!tracks || tracks.length === 0) {
      console.log("[Better Captions] No caption tracks found");
      return null;
    }
    
    console.log("[Better Captions] Found caption tracks:", tracks.length);
    
    // First check if we should use the user-selected language
    let selectedTrack = null;
    
    if (state.language !== 'auto') {
      // Look for exact match first
      selectedTrack = tracks.find(t => t.languageCode === state.language);
      
      // Then look for partial matches (like "en-US" for "en")
      if (!selectedTrack) {
        selectedTrack = tracks.find(t => t.languageCode.startsWith(state.language + '-'));
      }
    }
    
    // Fallback to English or first available track
    if (!selectedTrack) {
      // Try to find English track if not specifically looking for another language
      if (state.language === 'en' || state.language === 'auto') {
        selectedTrack = tracks.find(t => 
          t.languageCode === "en" || 
          t.languageCode === "en-US" || 
          t.languageCode === "en-GB"
        );
      }
      
      // If still no track found, use the first available
      if (!selectedTrack) {
        selectedTrack = tracks[0];
      }
    }
    
    console.log("[Better Captions] Selected track:", selectedTrack.languageCode);
    
    // YouTube sometimes uses a proxy URL that requires additional params
    let url = selectedTrack.baseUrl;
    if (!url.includes('&fmt=')) {
      url += '&fmt=json3';
    }
    
    return url;
  } catch (error) {
    console.error("[Better Captions] Caption track error:", error);
    return null;
  }
}

function parseTime(timeStr) {
  try {
    const parts = timeStr.replace(',', '.').split(':').map(Number);
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      const [m, s] = parts;
      return m * 60 + s;
    }
    return 0;
  } catch (error) {
    console.error("[Better Captions] Time parsing error:", error);
    return 0;
  }
}

async function fetchCaptions(url) {
  try {
    console.log("[Better Captions] Fetching captions from:", url);
    const res = await fetch(url);
    const text = await res.text();
    
    // Handle XML format
    if (text.includes('<?xml') || text.includes('<transcript>')) {
      console.log("[Better Captions] Parsing XML captions");
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      const textNodes = xmlDoc.querySelectorAll('text');
      
      return Array.from(textNodes).map(node => {
        const start = parseFloat(node.getAttribute('start') || 0);
        const dur = parseFloat(node.getAttribute('dur') || 0);
        return {
          start,
          end: start + dur,
          text: node.textContent || ""
        };
      }).filter(caption => caption.text.trim() !== "");
    }
    
    // Handle JSON format
    if (text.trim().startsWith('{') && text.includes('"events":')) {
      console.log("[Better Captions] Parsing JSON captions");
      try {
        const json = JSON.parse(text);
        if (json.events) {
          return json.events
            .filter(event => event.segs && event.segs.length > 0)
            .map(event => {
              const start = event.tStartMs / 1000;
              const end = (event.tStartMs + (event.dDurationMs || 0)) / 1000;
              const text = event.segs.map(seg => seg.utf8 || "").join("");
              return { start, end, text: text.trim() };
            })
            .filter(caption => caption.text !== "");
        }
      } catch (e) {
        console.error("[Better Captions] Failed to parse JSON captions:", e);
      }
    }
    
    // Handle SRT/VTT format as fallback
    console.log("[Better Captions] Parsing SRT/VTT captions");
    return text.split(/\n\n+/).map(block => {
      const lines = block.trim().split('\n');
      if (lines.length < 2) return null;
      
      // Skip index number if present
      let startIndex = 0;
      if (/^\d+$/.test(lines[0])) {
        startIndex = 1;
      }
      
      if (startIndex >= lines.length) return null;
      
      const timeLine = lines[startIndex];
      const textLines = lines.slice(startIndex + 1);
      
      const timeMatch = timeLine.match(/(\d+:\d+:\d+[\.,]\d+|\d+:\d+[\.,]\d+) --> (\d+:\d+:\d+[\.,]\d+|\d+:\d+[\.,]\d+)/);
      if (!timeMatch) return null;
      
      const [_, startStr, endStr] = timeMatch;
      const start = parseTime(startStr);
      const end = parseTime(endStr);
      return { 
        start, 
        end, 
        text: textLines.join(' ').trim()
      };
    }).filter(Boolean);
  } catch (error) {
    console.error("[Better Captions] Fetch captions error:", error);
    return [];
  }
}

function createCaptionBox() {
  let box = document.getElementById('custom-caption-box');
  if (box) return box;
  
  box = document.createElement('div');
  box.id = 'custom-caption-box';
  document.body.appendChild(box);
  
  // Hide if captions are disabled
  if (!state.enabled) {
    box.style.display = 'none';
  }
  
  return box;
}

function syncCaptions(video, captions, box) {
  let lastCaptionText = "";
  
  // Clear existing interval if any
  if (state.activeIntervalId) {
    clearInterval(state.activeIntervalId);
    state.activeIntervalId = null;
  }
  
  state.activeIntervalId = setInterval(() => {
    if (!document.body.contains(video) || !document.body.contains(box)) {
      // Clean up if elements are removed
      clearInterval(state.activeIntervalId);
      state.activeIntervalId = null;
      return;
    }
    
    const time = video.currentTime;
    const active = captions.find(c => time >= c.start && time <= c.end);
    const currentText = active ? active.text : "";
    
    // Only update DOM when text changes
    if (currentText !== lastCaptionText) {
      box.innerText = currentText;
      lastCaptionText = currentText;
    }
  }, 100);
  
  return state.activeIntervalId;
}

function createToggleButton() {
  // Remove any existing button
  const existingButton = document.getElementById('better-captions-toggle');
  if (existingButton) {
    existingButton.remove();
  }
  
  // If button is set to be hidden, don't create it
  if (state.hideButton) {
    return null;
  }
  
  // Create new button
  const button = document.createElement('button');
  button.id = 'better-captions-toggle';
  button.textContent = state.enabled ? 'Captions: ON' : 'Captions: OFF';
  
  // Style the button
  Object.assign(button.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '8px 12px',
    backgroundColor: state.enabled ? '#FFD700' : '#999',
    color: '#000',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
    zIndex: '9999999',
    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
    fontSize: '14px',
    transition: 'background-color 0.3s, transform 0.15s'
  });
  
  // Add button hover effect
  button.addEventListener('mouseover', () => {
    button.style.transform = 'scale(1.05)';
  });
  
  button.addEventListener('mouseout', () => {
    button.style.transform = 'scale(1)';
  });
  
  // Toggle captions on click
  button.addEventListener('click', () => {
    state.enabled = !state.enabled;
    button.textContent = state.enabled ? 'Captions: ON' : 'Captions: OFF';
    button.style.backgroundColor = state.enabled ? '#FFD700' : '#999';
    
    // Get caption box
    const captionBox = document.getElementById('custom-caption-box');
    if (captionBox) {
      captionBox.style.display = state.enabled ? 'block' : 'none';
    }
    
    // Save preference to Chrome storage
    chrome.storage.sync.set({ enabled: state.enabled });
  });
  
  document.body.appendChild(button);
  return button;
}

async function runCaptionSync() {
  try {
    // Clear previous intervals
    if (state.captionUpdateIntervalId) {
      clearInterval(state.captionUpdateIntervalId);
      state.captionUpdateIntervalId = null;
    }
    
    if (state.activeIntervalId) {
      clearInterval(state.activeIntervalId);
      state.activeIntervalId = null;
    }
    
    // Create or update button
    createToggleButton();
    
    // Create caption box
    const box = createCaptionBox();
    
    if (!state.enabled) {
      box.style.display = 'none';
      return;
    }
    
    console.log("[Better Captions] Starting caption sync...");
    const { video, playerData } = await waitForVideoAndPlayerResponse();
    console.log("[Better Captions] Found video and player data");
    
    const trackUrl = getCaptionTrackUrl(playerData);
    
    if (trackUrl) {
      const captions = await fetchCaptions(trackUrl);
      console.log("[Better Captions] Loaded captions:", captions.length);
      
      if (captions.length > 0) {
        state.activeIntervalId = syncCaptions(video, captions, box);
        state.captionsActive = true;
        return;
      }
    }
    
    console.log("[Better Captions] Using DOM fallback for captions");
    // Fallback to YouTube's built-in captions
    state.captionUpdateIntervalId = setInterval(() => {
      const domCaption = document.querySelector('.ytp-caption-segment');
      if (domCaption) {
        box.innerText = domCaption.innerText || "";
      } else {
        box.innerText = "";
      }
    }, 100);
    
    state.captionsActive = true;
    
  } catch (e) {
    console.error("[Better Captions] Failed:", e);
  }
}

// Extract video ID from YouTube URL
function getYoutubeVideoId(url) {
  const urlObj = new URL(url);
  
  // Handle regular watch URLs
  if (urlObj.pathname === '/watch') {
    return urlObj.searchParams.get('v');
  }
  
  // Handle short URLs like /shorts/videoId
  if (urlObj.pathname.startsWith('/shorts/')) {
    return urlObj.pathname.split('/')[2];
  }
  
  // Handle embedded URLs
  if (urlObj.pathname.startsWith('/embed/')) {
    return urlObj.pathname.split('/')[2];
  }
  
  return null;
}

// Clear all caption system state
function clearCaptionSystem() {
  // Clear intervals
  if (state.captionUpdateIntervalId) {
    clearInterval(state.captionUpdateIntervalId);
    state.captionUpdateIntervalId = null;
  }
  
  if (state.activeIntervalId) {
    clearInterval(state.activeIntervalId);
    state.activeIntervalId = null;
  }
  
  // Reset caption box
  const box = document.getElementById('custom-caption-box');
  if (box) box.innerText = "";
  
  state.captionsActive = false;
}

// Track YouTube URL changes (for SPA navigation)
let lastUrl = location.href;

function setupNavigationObserver() {
  if (state.navigationObserver) {
    state.navigationObserver.disconnect();
  }
  
  state.navigationObserver = new MutationObserver((mutations) => {
    if (location.href !== lastUrl) {
      console.log("[Better Captions] URL changed from", lastUrl, "to", location.href);
      
      const oldVideoId = state.currentVideoId;
      const newVideoId = getYoutubeVideoId(location.href);
      state.currentVideoId = newVideoId;
      
      lastUrl = location.href;
      
      clearCaptionSystem();
      
      // If video ID changed and force refresh is enabled, reload the page
      if (state.forceRefresh && oldVideoId && newVideoId && oldVideoId !== newVideoId) {
        console.log("[Better Captions] Forcing page refresh for new video");
        window.location.reload();
        return;
      }
      
      // Wait a bit for the new page to load
      setTimeout(runCaptionSync, 1500);
    }
  });
  
  state.navigationObserver.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
  
  // Set initial video ID
  state.currentVideoId = getYoutubeVideoId(location.href);
}

// Initialize after DOM is fully loaded
function initialize() {
  console.log("[Better Captions] Initializing extension...");
  
  // Load user preferences from Chrome storage
  chrome.storage.sync.get(
    { 
      enabled: true, 
      language: 'en',
      hideButton: false,
      forceRefresh: true
    }, 
    prefs => {
      state.enabled = prefs.enabled;
      state.language = prefs.language;
      state.hideButton = prefs.hideButton;
      state.forceRefresh = prefs.forceRefresh;
      console.log("[Better Captions] Loaded preferences:", prefs);
      
      setupNavigationObserver();
      
      // Initial run after a delay to ensure YouTube is ready
      setTimeout(runCaptionSync, 2000);
    }
  );
  
  // Listen for changes from popup
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync') return;
    
    let needsRestart = false;
    
    if (changes.enabled && changes.enabled.newValue !== undefined) {
      state.enabled = changes.enabled.newValue;
      
      // Update button if it exists
      const button = document.getElementById('better-captions-toggle');
      if (button) {
        button.textContent = state.enabled ? 'Captions: ON' : 'Captions: OFF';
        button.style.backgroundColor = state.enabled ? '#FFD700' : '#999';
      }
      
      // Update caption box visibility
      const box = document.getElementById('custom-caption-box');
      if (box) {
        box.style.display = state.enabled ? 'block' : 'none';
      }
    }
    
    if (changes.language && changes.language.newValue !== undefined) {
      state.language = changes.language.newValue;
      needsRestart = true;
    }
    
    if (changes.hideButton && changes.hideButton.newValue !== undefined) {
      state.hideButton = changes.hideButton.newValue;
      
      // Handle button visibility
      const existingButton = document.getElementById('better-captions-toggle');
      if (existingButton) {
        if (state.hideButton) {
          existingButton.remove();
        }
      } else if (!state.hideButton) {
        // Create button if it doesn't exist and should be shown
        createToggleButton();
      }
    }
    
    if (changes.forceRefresh && changes.forceRefresh.newValue !== undefined) {
      state.forceRefresh = changes.forceRefresh.newValue;
    }
    
    // If language changed, we need to restart to get new captions
    if (needsRestart && state.enabled) {
      runCaptionSync();
    }
  });
}

// If the page is still loading, wait for it to finish
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  // Page already loaded
  initialize();
}