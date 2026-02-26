// YouTube Caption Extension - content.js
console.log("[Better Captions] Extension loaded");

const DEFAULTS = {
  enabled: true,
  language: "en",
  hideButton: false,
  forceRefresh: false,
  fontSize: 28,
  bottomOffsetPercent: 10,
  style: "glass",
  hideNativeCaptions: true
};

// Extension state
const state = {
  ...DEFAULTS,
  captionsActive: false,
  activeRafId: null,
  captionObserver: null,
  navigationObserver: null,
  currentVideoId: null,
  currentTrackUrl: null,
  runId: 0,
  captionsCache: new Map(),
  navDebounceId: null,
  retryCount: 0,
  retryTimerId: null,
  lastNativeCcState: null
};

function waitForVideoAndPlayerResponse(timeoutMs = 12000) {
  const start = performance.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const video = document.querySelector("video");
      const playerData = getPlayerData();

      if (video && playerData) {
        resolve({ video, playerData });
        return;
      }

      if (performance.now() - start > timeoutMs) {
        reject(new Error("Timeout: video/player not found."));
        return;
      }

      requestAnimationFrame(tick);
    };

    tick();
  });
}

function getPlayerData() {
  try {
    let playerData = window.ytInitialPlayerResponse || window.__PLAYER_RESPONSE__;

    if (!playerData && window.ytplayer && window.ytplayer.config) {
      const playerResponse = window.ytplayer.config.args && window.ytplayer.config.args.player_response;
      if (playerResponse) {
        try {
          playerData = JSON.parse(playerResponse);
        } catch (e) {
          console.log("[Better Captions] Failed to parse player_response");
        }
      }
    }

    if (!playerData) {
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes("ytInitialPlayerResponse")) {
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

    if (!playerData && window.ytcfg && typeof window.ytcfg.get === "function") {
      const cfg = window.ytcfg.get("PLAYER_CONFIG") || window.ytcfg.get("PLAYER_VARS");
      const playerResponse = cfg?.args?.player_response || cfg?.player_response;
      if (playerResponse) {
        try {
          playerData = typeof playerResponse === "string" ? JSON.parse(playerResponse) : playerResponse;
        } catch (e) {
          console.log("[Better Captions] Failed to parse from ytcfg");
        }
      }
    }

    return playerData || null;
  } catch (e) {
    console.error("[Better Captions] Error accessing player data:", e);
    return null;
  }
}

function getCaptionTrackUrl(playerData) {
  try {
    const tracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
      playerData?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks || tracks.length === 0) {
      console.log("[Better Captions] No caption tracks found");
      return null;
    }

    let selectedTrack = null;

    if (state.language !== "auto") {
      selectedTrack = tracks.find(t => t.languageCode === state.language);
      if (!selectedTrack) {
        selectedTrack = tracks.find(t => t.languageCode.startsWith(state.language + "-"));
      }
    }

    if (!selectedTrack) {
      if (state.language === "en" || state.language === "auto") {
        selectedTrack = tracks.find(t =>
          t.languageCode === "en" ||
          t.languageCode === "en-US" ||
          t.languageCode === "en-GB"
        );
      }

      if (!selectedTrack) {
        selectedTrack = tracks[0];
      }
    }

    console.log("[Better Captions] Selected track:", selectedTrack.languageCode);

    let url = selectedTrack.baseUrl;
    if (!url.includes("&fmt=")) {
      url += "&fmt=json3";
    }

    return url;
  } catch (error) {
    console.error("[Better Captions] Caption track error:", error);
    return null;
  }
}

function parseTime(timeStr) {
  try {
    const parts = timeStr.replace(",", ".").split(":").map(Number);
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    console.log("[Better Captions] Fetching captions from:", url);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error("Caption fetch failed: " + res.status);
    }
    const text = await res.text();

    if (text.includes("<?xml") || text.includes("<transcript>")) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      const textNodes = xmlDoc.querySelectorAll("text");

      return Array.from(textNodes)
        .map(node => {
          const start = parseFloat(node.getAttribute("start") || 0);
          const dur = parseFloat(node.getAttribute("dur") || 0);
          return {
            start,
            end: start + dur,
            text: node.textContent || ""
          };
        })
        .filter(caption => caption.text.trim() !== "");
    }

    if (text.trim().startsWith("{") && text.includes("\"events\":")) {
      try {
        const json = JSON.parse(text);
        if (json.events) {
          return json.events
            .filter(event => event.segs && event.segs.length > 0)
            .map(event => {
              const start = event.tStartMs / 1000;
              const end = (event.tStartMs + (event.dDurationMs || 0)) / 1000;
              const captionText = event.segs.map(seg => seg.utf8 || "").join("");
              return { start, end, text: captionText.trim() };
            })
            .filter(caption => caption.text !== "");
        }
      } catch (e) {
        console.error("[Better Captions] Failed to parse JSON captions:", e);
      }
    }

    return text
      .split(/\n\n+/)
      .map(block => {
        const lines = block.trim().split("\n");
        if (lines.length < 2) return null;

        let startIndex = 0;
        if (/^\d+$/.test(lines[0])) {
          startIndex = 1;
        }

        if (startIndex >= lines.length) return null;

        const timeLine = lines[startIndex];
        const textLines = lines.slice(startIndex + 1);

        const timeMatch = timeLine.match(/(\d+:\d+:\d+[\.,]\d+|\d+:\d+[\.,]\d+) --> (\d+:\d+:\d+[\.,]\d+|\d+:\d+[\.,]\d+)/);
        if (!timeMatch) return null;

        const [, startStr, endStr] = timeMatch;
        const start = parseTime(startStr);
        const end = parseTime(endStr);
        return {
          start,
          end,
          text: textLines.join(" ").trim()
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("[Better Captions] Fetch captions error:", error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCaptionUrlVariants(url) {
  const variants = [];
  if (!url) return variants;

  const hasFmt = url.includes("fmt=");
  if (!hasFmt) {
    variants.push(url + "&fmt=json3");
    variants.push(url + "&fmt=srv3");
    variants.push(url + "&fmt=vtt");
    return variants;
  }

  variants.push(url);

  const swapFmt = newFmt => url.replace(/fmt=[^&]+/i, "fmt=" + newFmt);
  variants.push(swapFmt("json3"));
  variants.push(swapFmt("srv3"));
  variants.push(swapFmt("vtt"));

  return Array.from(new Set(variants));
}

async function fetchCaptionsWithFallback(trackUrl) {
  const variants = buildCaptionUrlVariants(trackUrl);
  for (const url of variants) {
    const captions = await fetchCaptions(url);
    if (captions && captions.length > 0) {
      return captions;
    }
  }
  return [];
}

function createCaptionBox() {
  let box = document.getElementById("custom-caption-box");
  if (box) return box;

  box = document.createElement("div");
  box.id = "custom-caption-box";
  document.body.appendChild(box);

  applyCaptionBoxPreferences(box);

  if (!state.enabled) {
    box.style.display = "none";
  }

  return box;
}

function applyCaptionBoxPreferences(box) {
  box.style.fontSize = `${state.fontSize}px`;
  box.style.bottom = `${state.bottomOffsetPercent}%`;
  box.dataset.style = state.style;
}

function resetRetries() {
  state.retryCount = 0;
  if (state.retryTimerId) {
    clearTimeout(state.retryTimerId);
    state.retryTimerId = null;
  }
}

function scheduleRetry(reason) {
  const maxRetries = 3;
  if (state.retryCount >= maxRetries) return;

  const delays = [2000, 5000, 10000];
  const delay = delays[Math.min(state.retryCount, delays.length - 1)];
  state.retryCount += 1;

  console.log(`[Better Captions] Retry scheduled (${state.retryCount}/${maxRetries}): ${reason}`);

  if (state.retryTimerId) {
    clearTimeout(state.retryTimerId);
  }

  state.retryTimerId = setTimeout(() => {
    runCaptionSync();
  }, delay);
}

function setNativeCaptionsEnabled(shouldEnable) {
  const ccButton = document.querySelector(".ytp-subtitles-button");
  if (!ccButton) return false;

  const pressed = ccButton.getAttribute("aria-pressed");
  const isEnabled = pressed === "true";
  if (state.lastNativeCcState === shouldEnable) return true;

  if (shouldEnable !== isEnabled) {
    ccButton.click();
  }

  state.lastNativeCcState = shouldEnable;
  console.log("[Better Captions] Native captions set to", shouldEnable);
  return true;
}

function normalizeCaptions(captions) {
  if (!Array.isArray(captions)) return [];

  const sorted = captions
    .filter(c => Number.isFinite(c.start))
    .slice()
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const hasDuration = Number.isFinite(current.end) && current.end > current.start;
    if (!hasDuration) {
      const fallbackEnd = next ? Math.max(current.start + 0.6, next.start - 0.05) : current.start + 2;
      current.end = fallbackEnd;
    }
  }

  return sorted;
}

function cleanupCaptionLoop() {
  if (state.activeRafId) {
    if (typeof state.activeRafId === "number") {
      cancelAnimationFrame(state.activeRafId);
    } else if (state.activeRafId && typeof state.activeRafId.cancel === "function") {
      state.activeRafId.cancel();
    }
    state.activeRafId = null;
  }
  if (state.captionObserver) {
    state.captionObserver.disconnect();
    state.captionObserver = null;
  }
}

function syncCaptions(video, captions, box) {
  cleanupCaptionLoop();

  let lastCaptionText = "";

  const findIndex = time => {
    let low = 0;
    let high = captions.length - 1;
    let mid;

    while (low <= high) {
      mid = Math.floor((low + high) / 2);
      const item = captions[mid];
      if (time < item.start) {
        high = mid - 1;
      } else if (time > item.end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return Math.max(0, Math.min(captions.length - 1, low));
  };

  const render = () => {
    if (!document.body.contains(video) || !document.body.contains(box)) {
      cleanupCaptionLoop();
      return;
    }

    const time = video.currentTime;
    const index = findIndex(time);
    const active = captions[index];
    const currentText = active && time >= active.start && time <= active.end ? active.text : "";

    if (currentText !== lastCaptionText) {
      box.innerText = currentText;
      lastCaptionText = currentText;
    }
  };

  if (typeof video.requestVideoFrameCallback === "function") {
    const handle = { id: null, cancel: () => {} };
    const onFrame = () => {
      render();
      handle.id = video.requestVideoFrameCallback(onFrame);
    };
    handle.id = video.requestVideoFrameCallback(onFrame);
    handle.cancel = () => {
      if (handle.id) {
        video.cancelVideoFrameCallback(handle.id);
      }
    };
    state.activeRafId = handle;
  } else {
    const tick = () => {
      render();
      state.activeRafId = requestAnimationFrame(tick);
    };
    state.activeRafId = requestAnimationFrame(tick);
  }

  return state.activeRafId;
}

function startDomCaptionObserver(box) {
  cleanupCaptionLoop();

  const container = document.querySelector(".ytp-caption-window-container");
  if (!container) {
    return null;
  }

  const update = () => {
    const segments = container.querySelectorAll(".ytp-caption-segment");
    const text = Array.from(segments).map(seg => seg.textContent || "").join("");
    box.innerText = text;
  };

  const observer = new MutationObserver(update);
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  update();

  state.captionObserver = observer;
  return observer;
}

function createToggleButton() {
  const existingButton = document.getElementById("better-captions-toggle");
  if (existingButton) {
    existingButton.remove();
  }

  if (state.hideButton) {
    return null;
  }

  const button = document.createElement("button");
  button.id = "better-captions-toggle";
  button.type = "button";
  button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
  button.textContent = state.enabled ? "Captions: ON" : "Captions: OFF";
  button.classList.toggle("is-off", !state.enabled);

  button.addEventListener("click", () => {
    state.enabled = !state.enabled;
    button.textContent = state.enabled ? "Captions: ON" : "Captions: OFF";
    button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    button.classList.toggle("is-off", !state.enabled);

    const captionBox = document.getElementById("custom-caption-box");
    if (captionBox) {
      captionBox.style.display = state.enabled ? "block" : "none";
    }

    chrome.storage.sync.set({ enabled: state.enabled });
  });

  document.body.appendChild(button);
  return button;
}

async function runCaptionSync() {
  const runId = ++state.runId;

  try {
    cleanupCaptionLoop();

    createToggleButton();

    const box = createCaptionBox();

    if (!state.enabled) {
      box.style.display = "none";
      return;
    }

    box.style.display = "block";

    console.log("[Better Captions] Starting caption sync...");
    const { video, playerData } = await waitForVideoAndPlayerResponse();
    if (runId !== state.runId) return;

    const trackUrl = getCaptionTrackUrl(playerData);
    if (runId !== state.runId) return;

    if (trackUrl) {
      state.currentTrackUrl = trackUrl;

      const cacheKey = `${state.currentVideoId || "unknown"}|${state.language}|${trackUrl}`;
      let captions = state.captionsCache.get(cacheKey);

      if (!captions) {
        captions = await fetchCaptionsWithFallback(trackUrl);
        state.captionsCache.set(cacheKey, captions);
      }

      if (runId !== state.runId) return;

      if (captions && captions.length > 0) {
        const normalized = normalizeCaptions(captions);
        if (state.hideNativeCaptions) {
          setNativeCaptionsEnabled(false);
        }
        syncCaptions(video, normalized, box);
        state.captionsActive = true;
        resetRetries();
        return;
      }
    }

    console.log("[Better Captions] Using DOM fallback for captions");
    setNativeCaptionsEnabled(true);
    const observer = startDomCaptionObserver(box);
    if (!observer) {
      box.innerText = "";
      scheduleRetry("No caption container found");
    } else if (!box.innerText) {
      scheduleRetry("Caption container empty");
    }

    state.captionsActive = true;
  } catch (e) {
    console.error("[Better Captions] Failed:", e);
    scheduleRetry("Exception during sync");
  }
}

function getYoutubeVideoId(url) {
  try {
    const urlObj = new URL(url);

    if (urlObj.pathname === "/watch") {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.pathname.startsWith("/shorts/")) {
      return urlObj.pathname.split("/")[2];
    }

    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/")[2];
    }

    return null;
  } catch {
    return null;
  }
}

function clearCaptionSystem() {
  cleanupCaptionLoop();

  const box = document.getElementById("custom-caption-box");
  if (box) box.innerText = "";

  state.captionsActive = false;
  resetRetries();
}

let lastUrl = location.href;

function handleNavigationChange() {
  if (state.navDebounceId) {
    clearTimeout(state.navDebounceId);
  }

  state.navDebounceId = setTimeout(() => {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;

    console.log("[Better Captions] URL changed from", lastUrl, "to", newUrl);

    const oldVideoId = state.currentVideoId;
    const newVideoId = getYoutubeVideoId(newUrl);
    state.currentVideoId = newVideoId;

    lastUrl = newUrl;
    clearCaptionSystem();
    resetRetries();

    if (state.forceRefresh && oldVideoId && newVideoId && oldVideoId !== newVideoId) {
      console.log("[Better Captions] Forcing page refresh for new video");
      window.location.reload();
      return;
    }

    runCaptionSync();
  }, 400);
}

function setupNavigationObserver() {
  if (state.navigationObserver) {
    state.navigationObserver.disconnect();
  }

  const onNavigate = () => handleNavigationChange();

  window.addEventListener("yt-navigate-finish", onNavigate, true);
  window.addEventListener("yt-page-data-updated", onNavigate, true);

  state.navigationObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      handleNavigationChange();
    }
  });

  state.navigationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  state.currentVideoId = getYoutubeVideoId(location.href);
}

function initialize() {
  console.log("[Better Captions] Initializing extension...");

  chrome.storage.sync.get(
    {
      enabled: DEFAULTS.enabled,
      language: DEFAULTS.language,
      hideButton: DEFAULTS.hideButton,
      forceRefresh: DEFAULTS.forceRefresh,
      fontSize: DEFAULTS.fontSize,
      bottomOffsetPercent: DEFAULTS.bottomOffsetPercent,
      style: DEFAULTS.style,
      hideNativeCaptions: DEFAULTS.hideNativeCaptions
    },
    prefs => {
      state.enabled = prefs.enabled;
      state.language = prefs.language;
      state.hideButton = prefs.hideButton;
      state.forceRefresh = prefs.forceRefresh;
      state.fontSize = prefs.fontSize;
      state.bottomOffsetPercent = prefs.bottomOffsetPercent;
      state.style = prefs.style || DEFAULTS.style;
      state.hideNativeCaptions = prefs.hideNativeCaptions ?? DEFAULTS.hideNativeCaptions;
      console.log("[Better Captions] Loaded preferences:", prefs);

      setupNavigationObserver();

      setTimeout(runCaptionSync, 800);
    }
  );

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "sync") return;

    let needsRestart = false;

    if (changes.enabled && changes.enabled.newValue !== undefined) {
      state.enabled = changes.enabled.newValue;

      const button = document.getElementById("better-captions-toggle");
      if (button) {
        button.textContent = state.enabled ? "Captions: ON" : "Captions: OFF";
        button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
        button.classList.toggle("is-off", !state.enabled);
      }

      const box = document.getElementById("custom-caption-box");
      if (box) {
        box.style.display = state.enabled ? "block" : "none";
      }
    }

    if (changes.language && changes.language.newValue !== undefined) {
      state.language = changes.language.newValue;
      needsRestart = true;
    }

    if (changes.hideButton && changes.hideButton.newValue !== undefined) {
      state.hideButton = changes.hideButton.newValue;

      const existingButton = document.getElementById("better-captions-toggle");
      if (existingButton) {
        if (state.hideButton) {
          existingButton.remove();
        }
      } else if (!state.hideButton) {
        createToggleButton();
      }
    }

    if (changes.forceRefresh && changes.forceRefresh.newValue !== undefined) {
      state.forceRefresh = changes.forceRefresh.newValue;
    }

    if (changes.fontSize && changes.fontSize.newValue !== undefined) {
      state.fontSize = changes.fontSize.newValue;
      const box = document.getElementById("custom-caption-box");
      if (box) applyCaptionBoxPreferences(box);
    }

    if (changes.bottomOffsetPercent && changes.bottomOffsetPercent.newValue !== undefined) {
      state.bottomOffsetPercent = changes.bottomOffsetPercent.newValue;
      const box = document.getElementById("custom-caption-box");
      if (box) applyCaptionBoxPreferences(box);
    }

    if (changes.style && changes.style.newValue !== undefined) {
      state.style = changes.style.newValue;
      const box = document.getElementById("custom-caption-box");
      if (box) applyCaptionBoxPreferences(box);
    }

    if (changes.hideNativeCaptions && changes.hideNativeCaptions.newValue !== undefined) {
      state.hideNativeCaptions = changes.hideNativeCaptions.newValue;
      if (state.enabled && state.hideNativeCaptions) {
        setNativeCaptionsEnabled(false);
      }
    }

    if (needsRestart && state.enabled) {
      runCaptionSync();
    }
  });

  const video = document.querySelector("video");
  if (video) {
    video.addEventListener("loadedmetadata", () => runCaptionSync(), { passive: true });
    video.addEventListener("emptied", () => clearCaptionSystem(), { passive: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
