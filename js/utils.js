// --- Utility Functions ---

const _logBuffer = [];
function logSystem(msg) {
    const now = new Date();
    const time = now.toISOString().split('T')[1].split('.')[0];
    const logEntry = `[${time}] ${msg}`;

    if (consoleOutput) {
        const div = document.createElement('div');
        div.innerHTML = logEntry; // Use innerHTML to support span colors
        consoleOutput.appendChild(div);

        // Only scroll if we are already at the bottom or near it
        const isAtBottom = consoleOutput.scrollHeight - consoleOutput.scrollTop <= consoleOutput.clientHeight + 50;
        if (isAtBottom) {
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }

        // Keep logs manageable
        if (consoleOutput.children.length > 500) {
            consoleOutput.removeChild(consoleOutput.firstChild);
        }
    }
}

function formatTime(ms) {
    if (ms >= 60000 && ms % 60000 === 0) return (ms / 60000) + 'm';
    return (ms / 1000) + 's';
}

// --- Performance Utilities ---

/**
 * Debounce: Delays function execution until after wait period of inactivity
 * Perfect for: search input, window resize, frequent filter changes
 */
function debounce(fn, ms) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Throttle: Ensures function executes at most once per time period
 * Perfect for: scroll handlers, animation frames, continuous events
 */
function throttle(fn, ms) {
    let lastCall = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastCall >= ms) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

/**
 * Memoize: Cache function results to avoid redundant computations
 * Perfect for: expensive calculations, repeated transformations
 */
function memoize(fn) {
    const cache = new Map();
    return function (...args) {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key);
        const result = fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
}


// Unit conversion helpers for popup refresh
function formatAltitude(altRaw, isFlight = true) {
    if (altRaw === undefined || altRaw === null) return 'N/A';
    const isMetric = (typeof useMetric !== 'undefined') ? useMetric : true; // Default to metric if not defined
    if (isFlight) {
        // Flight altitude: raw is in meters
        return isMetric
            ? Math.round(altRaw) + ' m'
            : Math.round(altRaw * 3.28084) + ' ft';
    } else {
        // Space altitude: raw is in km
        return isMetric
            ? Math.round(altRaw) + ' km'
            : Math.round(altRaw * 0.621371) + ' mi';
    }
}

function formatVelocity(velRaw, isFlight = true) {
    if (velRaw === undefined || velRaw === null) return 'N/A';
    const isMetric = (typeof useMetric !== 'undefined') ? useMetric : true; // Default to metric if not defined
    if (isFlight) {
        // Flight velocity: raw is in m/s
        return isMetric
            ? Math.round(velRaw * 3.6) + ' km/h'
            : Math.round(velRaw * 2.23694) + ' mph';
    } else {
        // Space velocity: raw is in km/s
        return isMetric
            ? velRaw.toFixed(2) + ' km/s'
            : (velRaw * 2236.94).toFixed(0) + ' mph';
    }
}

// --- Memory & FPS Monitoring ---
let memTick = 0;
let lastTime = performance.now();
let frames = 0;
let fps = 0;

function updateMonitor() {
    // 1. Calculate FPS
    const now = performance.now();
    frames++;
    if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
    }
    requestAnimationFrame(updateMonitor);
}

function updateDisplayLoop() {
    let stats = `>_ OUTPUT`;

    // FPS Indicator
    const fpsClass = fps < 20 ? 'fps-crit' : (fps < 45 ? 'fps-warn' : 'fps-good');
    stats += ` [FPS: <span class="${fpsClass}">${fps}</span>]`;

    // RAM Indicator (Chrome/Edge Only)
    if (performance && performance.memory) {
        const usedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        const ticker = memTick % 2 === 0 ? ':' : ' ';
        stats += ` [JS: ${usedMB}MB]`;
    }

    if (typeof consoleTitle !== 'undefined' && consoleTitle) consoleTitle.innerHTML = stats;
    memTick++;
}

// Start Monitoring
requestAnimationFrame(updateMonitor);
const throttledDisplayLoop = throttle(updateDisplayLoop, 1000);
setInterval(throttledDisplayLoop, 1000);
updateDisplayLoop(); // Init

// --- Console State Helper (shared across all modules) ---
function isConsoleOpen() {
    const consoleToggle = document.getElementById('console-toggle');
    const consoleWrapper = document.getElementById('console-wrapper');
    if (!consoleToggle || !consoleWrapper) return false;
    return consoleToggle.checked && consoleWrapper.style.display !== 'none';
}

// --- Cached Element Helpers ---
const _elCache = {};
const getEl = id => _elCache[id] || (_elCache[id] = document.getElementById(id));
const statusBox = () => getEl('status-box');
const loadingTextEl = () => getEl('loading-text');

// --- Cache Exposure Helper ---
function exposeCache(name, getter) {
    if (typeof window !== 'undefined') {
        Object.defineProperty(window, name, { get: getter, enumerable: true, configurable: true });
    }
}

// --- Status Box Helpers ---
function showStatus(text) {
    const box = statusBox(), txt = loadingTextEl();
    if (box && txt && !isConsoleOpen()) {
        box.style.display = 'block';
        txt.innerText = text;
    }
}
function hideStatus() {
    const box = statusBox();
    if (box && !isConsoleOpen()) box.style.display = 'none';
}
function updateLoadingStatus(text, className = 'text-dim') {
    const box = statusBox(), txt = loadingTextEl();
    if (box && txt && !isConsoleOpen()) {
        box.style.display = 'block';
        txt.innerText = text;
        txt.className = className;
    }
}

// --- Centralized Fetch Utility ---
// Set useProxy: true to route through proxy chain (third-party first, PHP fallback)
async function fetchData(url, options = {}) {
    const { useProxy = false, phpOnly = false, ...fetchOptions } = options;

    if (useProxy && typeof fetchWithProxyChain === 'function') {
        // Use the proxy chain from globals.js (third-party first, PHP fallback)
        return fetchWithProxyChain(url, fetchOptions, phpOnly);
    }

    // Direct fetch (no proxy)
    const config = {
        ...fetchOptions,
        headers: {
            ...fetchOptions.headers
        }
    };
    return fetch(url, config);
}

// --- Fetch with Proxy Fallback Utility ---
// Uses proxy chain (third-party first, PHP fallback)
async function fetchWithProxyFallback(targetUrl, options = {}) {
    const { timeout = typeof PROXY_TIMEOUT_MS !== 'undefined' ? PROXY_TIMEOUT_MS : 15000, directFirst = false } = options;

    // Header config
    const fetchOptions = {
        headers: { ...options.headers },
        timeout
    };

    // Try direct fetch first if requested
    if (directFirst) {
        try {
            const response = await Promise.race([
                fetch(targetUrl, fetchOptions),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeout))
            ]);
            if (response.ok) return await response.json();
        } catch (error) {
            // Fall through to proxy chain
        }
    }

    // Use the centralized proxy chain (third-party first, PHP fallback)
    if (typeof fetchWithProxyChain === 'function') {
        const response = await fetchWithProxyChain(targetUrl, fetchOptions);
        return await response.json();
    }

    throw new Error('No proxy methods available');
}

// --- Map Layer Manager Utility ---
const MapLayerManager = {
    clearLayerData(sourceId, layerId = null) {
        if (typeof map === 'undefined' || !map) return false;
        const source = map.getSource(sourceId);
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }
        if (layerId && map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', 'none');
        }
        return true;
    },

    setLayerVisibility(layerId, visible) {
        if (typeof map === 'undefined' || !map) return false;
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            return true;
        }
        return false;
    },

    updateLayerData(sourceId, data) {
        if (typeof map === 'undefined' || !map) return false;
        const source = map.getSource(sourceId);
        if (source) {
            source.setData(data);
            return true;
        }
        return false;
    },

    validateToggleAndClear(toggleId, sourceId, layerId = null) {
        const toggle = getEl(toggleId);
        if (!toggle || !toggle.checked) {
            this.clearLayerData(sourceId, layerId);
            return false;
        }
        return true;
    }
};

// --- Toggle Validation Helper ---
function validateToggle(toggleId, clearCallback) {
    const toggle = getEl(toggleId);
    if (!toggle || !toggle.checked) {
        if (clearCallback) clearCallback();
        hideStatus();
        return false;
    }
    return true;
}

// --- Dynamic Positioning Manager ---
function updateBottomStack() {
    const newsRow = document.getElementById('news-ticker-row');
    const polyRow = document.getElementById('polymarket-ticker-row');
    const consoleWrapper = document.getElementById('console-wrapper');
    const statusBox = document.getElementById('status-box');

    const BASE_BOTTOM = 20; // Padding from bottom
    const TICKER_HEIGHT = 35;
    const TICKER_GAP = 5;

    // Check for Radio Bar
    const radioBar = document.getElementById('radio-now-playing-bar');
    const radioHeight = (radioBar && !radioBar.classList.contains('radio-now-playing-bar-hidden')) ? 30 : 0;

    let currentBottom = BASE_BOTTOM + radioHeight;

    // 1. GDELT Ticker Row
    const gdeltEnabled = localStorage.getItem('gdelt_enabled') !== 'false';
    if (newsRow) {
        if (gdeltEnabled) {
            newsRow.style.setProperty('bottom', `${currentBottom}px`, 'important');
            newsRow.style.display = 'flex';
            currentBottom += TICKER_HEIGHT + TICKER_GAP;
        } else {
            newsRow.style.display = 'none';
        }
    }

    // 2. Poly Market Ticker Row
    const polyEnabled = localStorage.getItem('polymarket_enabled') !== 'false';
    if (polyRow) {
        if (polyEnabled) {
            polyRow.style.setProperty('bottom', `${currentBottom}px`, 'important');
            polyRow.style.display = 'flex';
            currentBottom += TICKER_HEIGHT + TICKER_GAP;
        } else {
            polyRow.style.display = 'none';
        }
    }

    // 3. Console / Status Box (Always stays above tickers)
    const consoleBottom = currentBottom + 10; // Extra buffer for console
    if (consoleWrapper) {
        consoleWrapper.style.setProperty('bottom', `${consoleBottom}px`, 'important');
    }
    if (statusBox) {
        statusBox.style.setProperty('bottom', `${consoleBottom}px`, 'important');
    }
}

// --- UI Visibility Manager ---
const UIVisibilityManager = {
    hideElements(ids, options = {}) {
        const { useImportant = false, hideProps = ['display', 'visibility', 'opacity', 'pointer-events', 'z-index'] } = options;
        ids.forEach(id => {
            const el = getEl(id);
            if (el) {
                if (useImportant) {
                    hideProps.forEach(prop => {
                        const value = prop === 'display' ? 'none' : prop === 'visibility' ? 'hidden' : prop === 'opacity' ? '0' : prop === 'pointer-events' ? 'none' : '-1';
                        el.style.setProperty(prop, value, 'important');
                    });
                } else {
                    el.style.display = 'none';
                }
            }
        });
    },

    showElements(ids, options = {}) {
        const { removeImportant = false, removeProps = ['display', 'visibility', 'opacity', 'pointer-events', 'z-index'] } = options;
        ids.forEach(id => {
            const el = getEl(id);
            if (el) {
                if (removeImportant) {
                    removeProps.forEach(prop => el.style.removeProperty(prop));
                } else {
                    el.style.display = '';
                }
            }
        });
    },

    toggleSelectionMode(hide, config = {}) {
        const {
            topButtons = ['top-settings-btn', 'globe-toggle-btn', 'bug-report-btn', 'info-btn', 'exit-btn', 'search-bar', 'mobile-search-toggle'],
            searchElements = ['search-dropdown', 'search-input', 'search-clear'],
            otherElements = ['overlay', 'controls', 'status-box', 'console-wrapper', 'info-modal', 'settings-modal']
        } = config;

        if (hide) {
            // Hide elements
            this.hideElements([...topButtons, ...searchElements, ...otherElements], { useImportant: true });
            // Show back button
            const backBtn = getEl('repeater-back-btn');
            if (backBtn) {
                backBtn.style.display = 'block';
                // Back button text update logic (keep existing)
                if (config.onBackButtonShow) config.onBackButtonShow(backBtn);
            }
        } else {
            // Show elements
            this.showElements([...topButtons, ...otherElements], { removeImportant: true });
            this.showElements(searchElements, { removeImportant: true });
            // Hide selection-specific elements
            this.hideElements(['repeater-back-btn', 'repeater-load-btn', 'repeater-selected-areas']);
        }
    }
};

// Initial position update
updateBottomStack();
