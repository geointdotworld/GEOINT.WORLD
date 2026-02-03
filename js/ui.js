// --- UI Logic & Event Listeners ---

// Element Cache & Helpers
const el = (() => { const c = {}; return id => c[id] || (c[id] = document.getElementById(id)); })();
const setLayerVisibility = (layer, visible) => map?.getLayer(layer) && map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
const markUserInteracted = () => { if (typeof userHasInteracted !== 'undefined') userHasInteracted = true; };
const hideStatusBox = () => { const box = el('status-box'); if (box) box.style.display = 'none'; };
const emptyGeoJSON = { type: 'FeatureCollection', features: [] };


// --- Reusable Folder Toggle ---
// Track all folder pairs for accordion behavior
const folderPairs = [];
const createFolderToggle = (headerId, contentId) => {
    const header = el(headerId), content = el(contentId);
    if (header && content) {
        folderPairs.push({ header, content, headerId });
        header.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 1024;
            const willOpen = !content.classList.contains('visible');

            // On mobile, close other sections when opening this one
            if (isMobile && willOpen) {
                folderPairs.forEach(pair => {
                    if (pair.content !== content && pair.content.classList.contains('visible')) {
                        pair.content.classList.remove('visible');
                        pair.header.querySelector('.folder-arrow')?.classList.remove('rotated');
                    }
                });
            }

            const isVisible = content.classList.toggle('visible');
            header.querySelector('.folder-arrow')?.classList.toggle('rotated', isVisible);
        });
    }
};
createFolderToggle('trackable-header', 'trackable-content');
createFolderToggle('communications-header', 'communications-content');
createFolderToggle('news-feed-header', 'news-feed-content');
createFolderToggle('natural-header', 'natural-content');

// --- Settings Toggles ---
['flight', 'space', 'ship', 'radio', 'mesh'].forEach(type => {
    const btn = el(`${type}-settings-btn`), opts = window[`${type}SubOptions`] || el(`${type}-sub-options`);
    if (btn && opts) btn.addEventListener('click', () => { opts.classList.toggle('visible'); setTimeout(() => typeof updateLiveFeedBtnPosition === 'function' && updateLiveFeedBtnPosition(), 50); });
});

// --- Console Toggle & Controls Max Height ---
const consoleToggleEl = el('console-toggle');
function updateControlsMaxHeight() {
    const controls = el('controls'), cw = el('console-wrapper');
    if (!controls) return;
    const vh = window.innerHeight, isMobile = window.innerWidth <= 768;
    const [top, margin, pad, ch, gap] = [70, isMobile ? 10 : 18, isMobile ? 6 : 9, 200, isMobile ? 10 : 18];
    const isOpen = cw && getComputedStyle(cw).display !== 'none';
    controls.style.maxHeight = `${Math.max(200, isOpen ? vh - margin - ch - top - pad - gap : vh - top - margin - pad)}px`;
}
const throttledMaxHeight = throttle(updateControlsMaxHeight, 100);
consoleToggleEl.addEventListener('change', e => {
    consoleWrapper.style.display = e.target.checked ? 'flex' : 'none';
    setTimeout(updateControlsMaxHeight, 10);
});
consoleToggleEl.checked = false; consoleWrapper.style.display = 'none';
setTimeout(updateControlsMaxHeight, 100);
window.addEventListener('resize', throttledMaxHeight);

// Live Feed Button: Now handled by CSS (legacy function removed)

// --- Lazy load live feed module (MemoFeed, WalletManager, MemoSender) ---
let liveFeedModulePromise;
async function loadLiveFeedModule() {
    if (!liveFeedModulePromise) {
        liveFeedModulePromise = import('./livefeed.js?v=154').then(module => {
            // Fallback to window globals if module exports are missing (script-style load)
            const MemoSender = module.MemoSender || window.MemoSender;
            const MemoFeed = module.MemoFeed || window.MemoFeed;
            const WalletManager = module.WalletManager || window.WalletManager;

            // Auto-init MemoSender to pre-fetch prices
            if (MemoSender && typeof MemoSender.init === 'function') {
                MemoSender.init();
            }
            // Auto-initialize Live Feed to pre-fetch data
            if (MemoFeed && typeof MemoFeed.init === 'function') {
                MemoFeed.init();
            }

            // Return an object structure compatible with destructuring upstream
            return { MemoSender, MemoFeed, WalletManager, ...module };
        });
    }
    return liveFeedModulePromise;
}

// Pre-load immediately to ensure price is ready
if (document.readyState === 'complete') loadLiveFeedModule();
else window.addEventListener('load', () => loadLiveFeedModule());

// Lazy-load mesh / repeaters (previously loaded via script tags)
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
}
let meshScriptsPromise;
function ensureMeshScripts() {
    if (meshScriptsPromise) return meshScriptsPromise;
    meshScriptsPromise = loadScript('js/repeaters.js?v=151')
        .then(() => loadScript('js/mesh.js?v=151'))
        .catch(err => { logSystem?.(`ERR: Mesh/Repeater scripts failed - ${err.message}`); throw err; });
    return meshScriptsPromise;
}

// --- Modal Manager ---
const ModalManager = {
    modals: new Map(),
    register(id, openId, closeId, onOpen) {
        const modal = el(id), open = el(openId), close = el(closeId);
        if (modal) {
            open?.addEventListener('click', () => { modal.style.display = 'block'; onOpen?.(); });
            close?.addEventListener('click', () => modal.style.display = 'none');
            this.modals.set(id, modal);
        }
    },
    init() { window.addEventListener('click', e => this.modals.forEach(m => { if (e.target === m) m.style.display = 'none'; })); },
    close(id) {
        const modal = this.modals.get(id) || el(id);
        if (modal) modal.style.display = 'none';
    }
};
ModalManager.register('legend-modal', 'legend-info-btn', 'close-legend-btn');
ModalManager.register('mesh-legend-modal', 'mesh-legend-info-btn', 'close-mesh-legend-btn');
ModalManager.register('meshtastic-filter-modal', 'meshtastic-filter-btn', 'close-meshtastic-filter-btn');
ModalManager.register('meshcore-filter-modal', 'meshcore-filter-btn', 'close-meshcore-filter-btn');
ModalManager.register('flight-legend-modal', 'flight-legend-info-btn', 'close-flight-legend-btn');
ModalManager.register('flight-filter-modal', 'flight-settings-btn', 'close-flight-filter-btn', () => {
    // Counts are updated live in fetchFlights, but we could trigger one here if needed
});
ModalManager.register('issue-modal', 'bug-report-btn', 'close-issue-btn', () => el('issue-text')?.focus());
ModalManager.register('info-modal', 'info-btn', 'close-info-btn');
ModalManager.register('settings-modal', 'top-settings-btn', 'close-settings-btn', updateCacheSizeDisplay);
ModalManager.register('satellite-filter-modal', 'satellite-filter-btn', 'close-satellite-filter-btn', () => typeof updateSatelliteFilterCounts === 'function' && updateSatelliteFilterCounts());
ModalManager.register('earthquake-filter-modal', 'earthquake-settings-btn', 'close-earthquake-filter-btn');

// Ensure these are registered
const registerTickers = () => {
    ModalManager.register('news-modal', 'news-ticker-btn', 'close-news-btn', () => {
        if (typeof renderFullNewsTable === 'function') {
            if (window.innerWidth > 1024) {
                renderFullNewsTable(window.gdeltRawArticles || []);
            }
        }
    });
    ModalManager.register('poly-composite-modal', 'polymarket-ticker-btn', 'close-poly-composite-btn', () => {
        if (typeof renderFullMarketTable === 'function') {
            // Ensure table is populated when composite opens on desktop
            if (window.innerWidth > 1024) {
                renderFullMarketTable(polyMarketsRaw);
            }
        }
    });

    // Close buttons for composite modals
    [['close-news-composite-btn', 'news-modal'], ['close-poly-composite-btn', 'poly-composite-modal'], ['close-poly-btn', 'poly-composite-modal']].forEach(([btn, modal]) => {
        el(btn)?.addEventListener('click', () => el(modal) && (el(modal).style.display = 'none'));
    });
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerTickers);
} else {
    registerTickers();
}
ModalManager.init();

// Lazy-loaded live feed modals
ModalManager.register('live-feed-modal', 'live-feed-btn', 'close-live-feed-btn', async () => {
    const { MemoFeed } = await loadLiveFeedModule();
    MemoFeed.init();
});
// Restore Wallet Modal Logic
ModalManager.register('wallet-modal', 'wallet-btn', 'close-wallet-btn', async () => {
    const { WalletManager } = await loadLiveFeedModule();
    // Initialize the manager which attaches listeners to the INTERNAL modal button (#w-btn)
    WalletManager.init();
});

// --- Filter Systems ---
const createFilterSystem = (map, updateFn, btnId, filtersKey) => {
    const cbs = {};
    Object.entries(map).forEach(([key, id]) => {
        const cb = el(id);
        if (cb) {
            cbs[key] = cb;
            // Initialize checkbox state from memory if available
            if (window[filtersKey] && window[filtersKey][key] !== undefined) {
                cb.checked = window[filtersKey][key];
            }
            cb.addEventListener('change', () => {
                if (window[filtersKey]) window[filtersKey][key] = cb.checked;
                updateFn?.();
                updateToggleBtnText(el(btnId), Object.values(cbs));
            });
        }
    });
    // Initialize button text
    if (btnId) updateToggleBtnText(el(btnId), Object.values(cbs));
    return cbs;
};
const areAllSelected = cbs => cbs?.length > 0 && cbs.every(cb => cb?.checked);
const updateToggleBtnText = (btn, cbs) => {
    if (!btn) return;
    const all = areAllSelected(cbs);
    btn.textContent = all ? 'DESELECT ALL' : 'SELECT ALL';
};

const meshtasticCbs = createFilterSystem({ CLIENT: 'filter-role-client', CLIENT_MUTE: 'filter-role-client-mute', CLIENT_BASE: 'filter-role-client-base', ROUTER: 'filter-role-router', REPEATER: 'filter-role-repeater', ROUTER_LATE: 'filter-role-router-late', TRACKER: 'filter-role-tracker', SENSOR: 'filter-role-sensor' }, () => window.updateCombinedMeshData?.(), 'meshtastic-toggle-all-btn', 'meshtasticFilters');
const meshcoreCbs = createFilterSystem({ Client: 'filter-type-client', Repeater: 'filter-type-repeater', 'Room Server': 'filter-type-room', Sensor: 'filter-type-sensor' }, () => window.updateCombinedMeshData?.(), 'meshcore-toggle-all-btn', 'meshcoreFilters');
const flightCbs = createFilterSystem({ standard: 'filter-flight-standard', military: 'filter-flight-military', pia: 'filter-flight-pia', ladd: 'filter-flight-ldd', alert: 'filter-flight-alert', ghost: 'filter-flight-ghost', nosquawk: 'filter-flight-nosquawk' }, () => typeof fetchFlights === 'function' && fetchFlights(), 'flight-toggle-all-btn', 'flightFilters');

const setupToggleAll = (btnId, cbMap, filtersKey) => {
    const btn = el(btnId); if (!btn) return;
    const cbs = Object.values(cbMap);
    btn.addEventListener('click', () => {
        const all = areAllSelected(cbs);
        Object.entries(cbMap).forEach(([k, cb]) => {
            if (cb) {
                cb.checked = !all;
                if (window[filtersKey]) window[filtersKey][k] = !all;
            }
        });
        updateToggleBtnText(btn, cbs);
        if (filtersKey === 'flightFilters') {
            if (typeof fetchFlights === 'function') fetchFlights();
        } else {
            window.updateCombinedMeshData?.();
        }
    });
    updateToggleBtnText(btn, cbs);
};
setupToggleAll('meshtastic-toggle-all-btn', meshtasticCbs, 'meshtasticFilters');
setupToggleAll('meshcore-toggle-all-btn', meshcoreCbs, 'meshcoreFilters');
setupToggleAll('flight-toggle-all-btn', flightCbs, 'flightFilters');

// Satellite Toggle All
const satBtn = el('satellite-toggle-all-btn');
if (satBtn) {
    const getSatCbs = () => ['weather', 'noaa', 'gps', 'glonass', 'galileo', 'beidou', 'cubesat', 'oneweb', 'planet', 'starlink', 'other'].map(f => el(`filter-${f}`));
    satBtn.addEventListener('click', () => { const cbs = getSatCbs(), all = areAllSelected(cbs); cbs.forEach(cb => { if (cb) { cb.checked = !all; cb.dispatchEvent(new Event('change')); } }); updateToggleBtnText(satBtn, cbs); });
    getSatCbs().forEach(cb => cb?.addEventListener('change', () => updateToggleBtnText(satBtn, getSatCbs())));
    updateToggleBtnText(satBtn, getSatCbs());
}

// Copy Button
el('copy-btn').addEventListener('click', async () => {
    const btn = el('copy-btn'), orig = btn.innerText;
    try { await navigator.clipboard.writeText(consoleOutput.innerText); btn.innerText = 'COPIED!'; btn.classList.add('copied'); setTimeout(() => { btn.innerText = orig; btn.classList.remove('copied'); }, 2000); logSystem('SYS: Console log copied.'); }
    catch { btn.innerText = 'ERROR'; setTimeout(() => btn.innerText = orig, 2000); logSystem('ERR: Copy failed.'); }
});

// --- Poll Rate Controllers ---
const createPollController = cfg => ({
    change(dir) {
        if (dir === 'up') cfg.poll += cfg.step; else if (cfg.poll - cfg.step >= 1000) cfg.poll -= cfg.step;
        cfg.display.innerText = formatTime(cfg.poll); cfg.stepBtn.innerText = '±' + formatTime(cfg.step);
        logSystem(`CFG: ${cfg.name} Poll ${formatTime(cfg.poll)}`);
        if (cfg.toggle.checked) { clearInterval(cfg.interval); cfg.interval = setInterval(cfg.fetchFn, cfg.poll); }
    },
    cycleStep() { const i = stepOptions.indexOf(cfg.step); cfg.step = stepOptions[(i + 1) % stepOptions.length]; cfg.stepBtn.innerText = '±' + formatTime(cfg.step); logSystem(`CFG: ${cfg.name} Step ${formatTime(cfg.step)}`); },
    init() { cfg.display.innerText = formatTime(cfg.poll); cfg.stepBtn.innerText = '±' + formatTime(cfg.step); }
});

const pollCtrls = {
    flight: createPollController({ name: 'Flight', poll: currentPollMs, step: currentStepMs, toggle: flightToggle, display: pollValueDisplay, stepBtn, fetchFn: fetchFlights, get interval() { return flightInterval; }, set interval(v) { flightInterval = v; } }),
    space: createPollController({ name: 'Space', poll: currentSpacePollMs, step: currentSpaceStepMs, toggle: spaceToggle, display: spacePollValueDisplay, stepBtn: spaceStepBtn, fetchFn: fetchSpace, get interval() { return spaceInterval; }, set interval(v) { spaceInterval = v; } }),
    ship: createPollController({ name: 'Ship', poll: currentShipPollMs, step: currentShipStepMs, toggle: shipToggle, display: shipPollValueDisplay, stepBtn: shipStepBtn, fetchFn: fetchShips, get interval() { return shipInterval; }, set interval(v) { shipInterval = v; } }),
    quake: createPollController({ name: 'Quake', poll: currentQuakePollMs, step: currentQuakeStepMs, toggle: earthquakeToggle || { checked: false }, display: el('quake-poll-value'), stepBtn: el('quake-step-btn'), fetchFn: () => typeof fetchEarthquakes === 'function' && fetchEarthquakes(), get interval() { return earthquakeFeedInterval; }, set interval(v) { earthquakeFeedInterval = v; } })
};

['poll-up', 'poll-down', 'space-poll-up', 'space-poll-down', 'ship-poll-up', 'ship-poll-down', 'quake-poll-up', 'quake-poll-down'].forEach(id => {
    const [type, dir] = id.includes('space') ? ['space', id.includes('up') ? 'up' : 'down'] : id.includes('ship') ? ['ship', id.includes('up') ? 'up' : 'down'] : id.includes('quake') ? ['quake', id.includes('up') ? 'up' : 'down'] : ['flight', id.includes('up') ? 'up' : 'down'];
    el(id)?.addEventListener('click', () => pollCtrls[type].change(dir));
});
stepBtn.addEventListener('click', () => pollCtrls.flight.cycleStep());
spaceStepBtn.addEventListener('click', () => pollCtrls.space.cycleStep());
shipStepBtn.addEventListener('click', () => pollCtrls.ship.cycleStep());
el('quake-step-btn')?.addEventListener('click', () => pollCtrls.quake.cycleStep());
Object.values(pollCtrls).forEach(p => p.init());

// --- Main Data Toggles (Unified) ---
const createMainToggle = (toggle, cfg) => {
    toggle.addEventListener('change', e => {
        markUserInteracted();
        if (e.target.checked) {
            cfg.onStart?.();
            if (!cfg.getInterval()) { logSystem(cfg.startMsg); cfg.fetchFn(); cfg.setInterval(setInterval(cfg.fetchFn, cfg.pollRate())); }
        } else {
            clearInterval(cfg.getInterval()); cfg.setInterval(null);
            map.getSource(cfg.source)?.setData(emptyGeoJSON);
            logSystem(`<span class="log-dim">${cfg.stopMsg}</span>`);
            hideStatusBox();
        }
    });

    // Check initial state
    if (toggle.checked) {
        // Delay slightly to ensure map is ready
        setTimeout(() => {
            toggle.dispatchEvent(new Event('change'));
        }, 1000);
    }
};

createMainToggle(flightToggle, { source: 'opensky-data', startMsg: `NET: Connecting... [FREQ: ${formatTime(currentPollMs)}]`, stopMsg: 'NET: Feed terminated.', fetchFn: fetchFlights, pollRate: () => currentPollMs, getInterval: () => flightInterval, setInterval: v => flightInterval = v });
createMainToggle(spaceToggle, { source: 'space-data', startMsg: 'NET: Initializing Orbital Tracking (CelesTrak)...', stopMsg: 'NET: Orbital feed terminated.', fetchFn: fetchSpace, pollRate: () => currentSpacePollMs, getInterval: () => spaceInterval, setInterval: v => spaceInterval = v });
createMainToggle(shipToggle, { source: 'gfw-data', startMsg: 'NET: GFW Satellite Link Initiated...', stopMsg: 'NET: Marine feed terminated.', fetchFn: fetchShips, pollRate: () => currentShipPollMs, getInterval: () => shipInterval, setInterval: v => shipInterval = v, onStart: () => { if (!shipGapToggle.checked) shipGapToggle.checked = true; if (!shipFishingToggle.checked) shipFishingToggle.checked = true; } });

if (earthquakeToggle) {
    createMainToggle(earthquakeToggle, {
        source: 'earthquake-data',
        startMsg: 'NET: Initializing USGS Seismographic Feed...',
        stopMsg: 'NET: Earthquake feed terminated.',
        fetchFn: () => typeof fetchEarthquakes === 'function' && fetchEarthquakes(),
        pollRate: () => currentQuakePollMs,
        getInterval: () => earthquakeFeedInterval,
        setInterval: v => earthquakeFeedInterval = v,
        onStart: () => {
            if (typeof initEarthquakeLayer === 'function') initEarthquakeLayer();
        }
    });

    const quakeBtns = document.querySelectorAll('.quake-time-btn');
    quakeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            quakeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set global and fetch
            window.earthquakeTimeframe = btn.dataset.value;
            if (earthquakeToggle.checked && typeof fetchEarthquakes === 'function') fetchEarthquakes();
        });
    });

    const quakeMagBtns = document.querySelectorAll('.quake-mag-btn');
    quakeMagBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            quakeMagBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set global and fetch
            window.earthquakeMinMagnitude = parseFloat(btn.dataset.value) || 0;
            if (earthquakeToggle.checked && typeof fetchEarthquakes === 'function') fetchEarthquakes();
        });
    });
}

// Space/Satellite filter toggles
[satellitesToggle, stationsToggle, debrisToggle].filter(t => t).forEach(t => t.addEventListener('change', () => { if (spaceToggle.checked) { if (t === stationsToggle && !stationsToggle.checked && !debrisToggle?.checked && !satellitesToggle?.checked) map.getSource('space-data')?.setData(emptyGeoJSON); else fetchSpace(); } }));
[filterWeather, filterNoaa, filterGps, filterGlonass, filterGalileo, filterBeidou, filterCubesat, filterOneweb, filterPlanet, filterStarlink, filterOther].filter(t => t).forEach(t => t.addEventListener('change', () => { if (spaceToggle.checked && satellitesToggle?.checked) fetchSpace(); }));

// Radio Toggle
const updateRadioVisibility = () => setLayerVisibility('radio-stations', radioToggle?.checked);
if (radioToggle) radioToggle.addEventListener('change', e => {
    markUserInteracted(); updateRadioVisibility();
    const opts = radioSubOptions || el('radio-sub-options');
    if (e.target.checked) {
        opts?.classList.add('visible');
        if (!map) { logSystem("ERR: Map not initialized."); radioToggle.checked = false; return; }
        logSystem("NET: Initializing radio spectrum scan...");
        fetchRadioStations().catch(err => logSystem(`ERR: Radio fetch failed - ${err.message}`));
    } else { opts?.classList.remove('visible'); stopRadioStation(); setLayerVisibility('radio-stations', false); logSystem('<span class="log-dim">NET: Radio stations hidden.</span>'); }
});

// Repeaters Toggle
if (repeatersToggle) repeatersToggle.addEventListener('change', async () => {
    const prompt = el('repeater-select-prompt');
    if (repeatersToggle.checked) {
        if (!map) { logSystem("ERR: Map not initialized."); repeatersToggle.checked = false; return; }
        await ensureMeshScripts();
        if (window.cachedRepeaters) { const areas = Object.keys(window.cachedRepeaters).filter(k => window.cachedRepeaters[k]?.length); if (areas.length) { logSystem(`NET: Cached repeater data for ${areas.length} area(s).`); (renderAllCachedRepeaters || window.renderAllCachedRepeaters)?.(); } }
        if (prompt) prompt.style.display = 'block';
        enableRepeaterSelection?.() || logSystem("ERR: Repeater module not loaded.");
    } else {
        if (prompt) prompt.style.display = 'none'; disableRepeaterSelection?.();
        ['repeaters', 'state-boundaries', 'state-boundaries-fill'].forEach(l => setLayerVisibility(l, false));
        logSystem('<span class="log-dim">NET: Repeater layer hidden.</span>');
    }
});

// Radio Controls
el('radio-stop-btn')?.addEventListener('click', () => { stopRadioStation(); updateRadioPlayerControls(); });
el('radio-now-playing-pause')?.addEventListener('click', () => window.toggleRadioPlayPause?.());
el('radio-now-playing-clear')?.addEventListener('click', () => window.stopRadioStation?.());

window.updateRadioPlayerControls = function () {
    const ctrl = el('radio-player-controls'), np = el('radio-now-playing');
    if (ctrl && np) { const s = getCurrentStation?.(); if (s && isRadioPlaying?.()) { ctrl.style.display = 'block'; np.textContent = `▶ ${s.name}`; } else ctrl.style.display = 'none'; }
};

window.toggleRadioFromPopup = function (id, name, url, codec, bitrate) {
    const updateBtn = state => {
        const btn = window.currentRadioPopupElement?.querySelector('.radio-play-btn') || document.querySelector('.maplibregl-popup-content .radio-play-btn');
        if (btn) { btn.innerHTML = { playing: 'PAUSE', paused: 'PLAY', loading: 'LOADING...' }[state] || 'PLAY'; btn.classList.toggle('playing', state === 'playing'); btn.classList.toggle('loading', state === 'loading'); }
        window.updatePopupPlayerButton?.(state);
    };
    const cur = getCurrentStation?.();
    if (cur?.id === id && isRadioPlaying?.()) { updateBtn(window.radioAudio?.paused ? 'loading' : 'paused'); toggleRadioPlayPause?.(); setTimeout(() => updateBtn(window.radioAudio?.paused ? 'paused' : 'playing'), 100); return; }
    updateBtn('loading'); playRadioStation?.({ id, name, streamUrl: url, url_resolved: url, codec, bitrate }); setTimeout(() => window.updateRadioPlayerControls?.(), 100);
};

// Mesh Visibility
const updateMeshVisibility = () => setLayerVisibility('mesh-nodes', meshToggle?.checked && (meshtasticToggle?.checked || meshcoreToggle?.checked));

if (meshToggle) meshToggle.addEventListener('change', async e => {
    markUserInteracted();
    if (e.target.checked) {
        if (!map) { logSystem("MESH: Map not initialized."); meshToggle.checked = false; return; }
        await ensureMeshScripts();
        const check = () => {
            if (!map || !map.isStyleLoaded() || !window.initMeshtastic) {
                logSystem("MESH: Waiting...");
                setTimeout(check, 500);
                return;
            }
            // Initialize mesh source if it doesn't exist
            if (!map.getSource('mesh-data')) {
                try {
                    map.addSource('mesh-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                } catch (e) {
                    // Source might already exist, continue
                }
            }
            if (meshtasticToggle?.checked) { logSystem("MESH: Init Meshtastic..."); try { window.initMeshtastic(); } catch (e) { logSystem(`ERR: ${e.message}`); } }
            if (meshcoreToggle?.checked && window.initMeshcore) { logSystem("MESHCORE: Init..."); try { window.initMeshcore(); } catch (e) { logSystem(`ERR: ${e.message}`); } }
            updateMeshVisibility();
        }; check();
    } else { updateMeshVisibility(); window.cleanupMeshtastic?.(); window.cleanupMeshcore?.(); logSystem('<span class="log-dim">MESH: Hidden.</span>'); }
});

[meshtasticToggle, meshcoreToggle].forEach((t, i) => t?.addEventListener('change', () => {
    const isCore = i === 1, initFn = isCore ? window.initMeshcore : window.initMeshtastic, cleanFn = isCore ? window.cleanupMeshcore : window.cleanupMeshtastic;
    if (t.checked && meshToggle?.checked && map && initFn) { logSystem(`${isCore ? 'MESHCORE' : 'MESH'}: Init...`); try { initFn(); } catch (e) { logSystem(`ERR: ${e.message}`); } }
    else if (!t.checked) { cleanFn?.(); hideStatusBox(); }
    updateMeshVisibility();
}));

// Cables Toggle
cablesToggle.addEventListener('change', e => {
    markUserInteracted();
    if (e.target.checked) { if (!cablesLoaded) { fetchCables(); cablesLoaded = true; } ['cables', 'landing-points'].forEach(l => setLayerVisibility(l, true)); logSystem("GUI: Cable network activated."); }
    else { ['cables', 'landing-points'].forEach(l => setLayerVisibility(l, false)); logSystem('<span class="log-dim">NET: Cables hidden.</span>'); }
});

// Ship Filters & Trails
[shipGapToggle, shipEncounterToggle, shipLoiteringToggle, shipFishingToggle, shipPortToggle].forEach(t => t.addEventListener('change', () => { updateShipFilters(); if (shipToggle.checked) fetchShips(); }));
trailsToggle.addEventListener('change', updateFlightTrailsLayer);

// Bug Report
el('submit-issue-btn').addEventListener('click', async () => {
    const text = el('issue-text').value.trim(), status = el('issue-status-message');
    const show = (msg, color) => { status.style.display = 'block'; status.textContent = msg; status.style.color = status.style.borderColor = color; status.style.boxShadow = `0 0 8px ${color}40`; };
    if (!text) { el('issue-text').style.borderColor = '#ff3333'; setTimeout(() => el('issue-text').style.borderColor = '#331a00', 1000); return; }
    show('Collecting info...', '#ff6800');
    try {
        let ip = {}; try {
            const ipResp = await fetchWithProxyChain('https://ipapi.co/json/');
            ip = await ipResp.json();
            if (typeof logSystem === 'function' && ipResp.proxySource) logSystem(`NET: IP lookup via ${ipResp.proxySource === 'php' ? 'BACKEND' : 'THIRD-PARTY (' + ipResp.proxySource + ')'}`);
        } catch { }
        let r = `**Bug Report**\n\n**Description:**\n${text}\n\n**--- Info ---**\n`;
        if (ip.ip) r += `**IP:** ${ip.ip}\n`; if (ip.city) r += `**Location:** ${ip.city}, ${ip.region || ''}, ${ip.country_name || ''}\n`;
        if (ip.latitude) r += `**Coords:** ${ip.latitude}, ${ip.longitude}\n`; if (ip.org) r += `**ISP:** ${ip.org}\n`;
        r += `**UA:** ${navigator.userAgent}\n**Platform:** ${navigator.platform}\n**Screen:** ${screen.width}x${screen.height} | ${innerWidth}x${innerHeight}\n**TZ:** ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n**Time:** ${new Date().toISOString()}\n`;
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://discordapp.com/api/webhooks/1456496765657157817/-_An2EPB5g6pgiW-3dskyUxQ-rxqdpq9ySJlL1n7bx9K-U-GLMWAH-fKMVLb6je-VOns');
        xhr.setRequestHeader('Content-type', 'application/json');
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { show('Sent!', '#00ff00'); el('issue-text').value = ''; setTimeout(() => { el('issue-modal').style.display = 'none'; status.style.display = 'none'; }, 2000); logSystem("SYS: Report sent."); } else show('✗ Failed.', '#ff3333'); };
        xhr.onerror = () => show('✗ Network error.', '#ff3333');
        xhr.send(JSON.stringify({ username: 'GEOINT Bug Report', content: r }));
    } catch { show('✗ Error.', '#ff3333'); }
});

el('exit-btn').addEventListener('click', () => location.href = 'index.html');

// --- Settings ---
const limitSlider = el('entity-limit-slider'), limitDisplay = el('limit-value'), btnImp = el('unit-btn-imp'), btnMet = el('unit-btn-met'), unitLabel = el('unit-label');

const updateSliderFill = (slider) => {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const pct = (val - min) / (max - min) * 100;
    slider.style.setProperty('--slider-percent', pct + '%');
};

const updateFlightAltDisplay = () => {
    const slider = el('flight-alt-slider'), display = el('flight-alt-value');
    if (slider && display) {
        const val = +slider.value;
        display.innerText = useMetric ? Math.round(val / 3.28084) + ' M' : val + ' FT';
        window.minFlightAltitude = val / 3.28084; // Store as meters
        updateSliderFill(slider);
    }
};

const setUnit = metric => {
    useMetric = metric;
    unitLabel.innerText = metric ? 'METRIC' : 'IMPERIAL';
    unitLabel.style.color = '#ff6800';
    btnMet.classList.toggle('active', metric);
    btnImp.classList.toggle('active', !metric);
    logSystem(`CFG: ${metric ? 'Metric' : 'Imperial'}`);
    refreshCurrentPopup?.();
    updateFlightAltDisplay(); // Added
};
btnImp.addEventListener('click', () => setUnit(false)); btnMet.addEventListener('click', () => setUnit(true));
limitSlider.addEventListener('input', e => { entityLimit = +e.target.value; limitDisplay.innerText = entityLimit; updateSliderFill(e.target); });
limitSlider.addEventListener('change', () => { logSystem(`CFG: Max entities ${entityLimit}`); if (shipToggle.checked) { logSystem("GUI: Refreshing..."); fetchShips(); } });

// Flight Altitude Slider
const flightAltSlider = el('flight-alt-slider');
if (flightAltSlider) {
    flightAltSlider.addEventListener('input', updateFlightAltDisplay);
    flightAltSlider.addEventListener('change', () => {
        const val = +flightAltSlider.value;
        const displayVal = useMetric ? Math.round(val / 3.28084) + ' M' : val + ' FT';
        logSystem(`CFG: Min altitude ${displayVal}`);
        if (typeof fetchFlights === 'function') fetchFlights();
    });
}

// Initial fill
if (limitSlider) updateSliderFill(limitSlider);
if (flightAltSlider) updateFlightAltDisplay();

// Cache Helpers
const formatBytes = b => { if (!b) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.min(Math.floor(Math.log(b) / Math.log(k)), 3); return `${Math.round(b / Math.pow(k, i) * 100) / 100} ${s[i]}`; };
const getStorageSize = () => {
    let t = 0;[localStorage, sessionStorage].forEach(s => { for (let k in s) if (s.hasOwnProperty(k)) t += s[k].length + k.length; });
    ['cachedRepeaters', 'cableMetadata', 'cableGeoData', 'landingPointsData', 'tleCache', 'stationsCache', 'debrisCache'].forEach(n => { const c = window[n]; if (!c) return; try { if ((Array.isArray(c) && c.length) || (typeof c === 'object' && Object.keys(c).length)) t += JSON.stringify(c).length; } catch { t += Array.isArray(c) ? c.length * 200 : Object.keys(c).length * 500; } }); return t;
};
async function getCacheSize() { if (!('caches' in window)) return 0; let t = 0; try { for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) { const res = await c.match(r); if (res) t += (await res.blob()).size; } } } catch { } return t; }
async function updateCacheSizeDisplay() { const btn = el('clear-cache-btn'); if (!btn) return; try { btn.textContent = `CLEAR CACHE (${formatBytes(getStorageSize() + await getCacheSize())})`; } catch { btn.textContent = 'CLEAR CACHE (ERROR)'; } }
el('clear-cache-btn')?.addEventListener('click', () => {
    // Show custom confirmation modal
    const modal = el('confirm-clear-modal');
    if (modal) modal.style.display = 'block';
});

// Close/No buttons for confirmation modal
['close-confirm-clear-btn', 'confirm-clear-no-btn'].forEach(id => el(id)?.addEventListener('click', () => el('confirm-clear-modal').style.display = 'none'));
el('confirm-clear-yes-btn')?.addEventListener('click', () => {
    el('confirm-clear-modal').style.display = 'none';
    logSystem('SYS: Clearing all local data...');

    localStorage.clear();
    sessionStorage.clear();

    if ('caches' in window) {
        caches.keys().then(names => {
            Promise.all(names.map(name => caches.delete(name))).then(() => {
                logSystem('SYS: Caches purged.');
                setTimeout(() => location.reload(true), 500);
            });
        });
    } else {
        setTimeout(() => location.reload(true), 500);
    }
});

// --- SEARCH ---
const createPin = () => { const d = document.createElement('div'); d.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="rgba(26,13,0,0.8)" stroke="#ff6800" stroke-width="2" class="pin-shadow"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`; d.className = 'pin-container'; return d; };
const updateSearchMarker = coords => { if (searchMarker) searchMarker.remove(); searchMarker = new maplibregl.Marker({ element: createPin(), anchor: 'bottom' }).setLngLat(coords).addTo(map); };

function executeSearch() {
    const q = el('search-input').value.toUpperCase().trim(); if (!q) return;
    logSystem(`CMD: Searching '${q}'...`);
    const all = ['opensky-data', 'gfw-data', 'radio-data', 'mesh-data', 'cable-data', 'landing-points-data', 'space-data'].flatMap(s => map.querySourceFeatures(s) || []);
    const match = all.find(f => { const p = f.properties; return [p.callsign, p.icao, p.vesselName, p.ssvid, p.imo, p.name, p.country, p.state, p.tags, p.codec, p.nodeName, p.nodeId, p.shortName, p.role, p.hardware, p.firmware, p.region, p.modemPreset, p.hexId, p.numericId, p.nodeType, p.id].some(v => v && String(v).toUpperCase().includes(q)); });
    if (match) {
        const coords = match.geometry.type === 'LineString' ? match.geometry.coordinates[0] : match.geometry.coordinates;
        map.flyTo({ center: coords, zoom: 14, speed: 1.5 }); updateSearchMarker(coords);
        const p = match.properties, name = p.callsign || p.vesselName || p.icao || p.name || p.nodeName || p.shortName || p.nodeId || p.hexId || p.id || 'TARGET';
        logSystem(`SYS: Found: ${name}`);
        setTimeout(() => { if (p.nodeId || p.nodeName) showMeshPopup(p, coords); else if (p.codec) showRadioPopup(p, coords); }, 1500);
    } else logSystem(`SYS: '${q}' not found.`);
}

el('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') { el('search-dropdown').style.display = 'none'; el('search-bar').classList.remove('has-results'); executeSearch(); } });
el('search-input').addEventListener('input', e => {
    const q = e.target.value.trim(); el('search-clear').style.display = q ? 'block' : 'none'; clearTimeout(searchDebounce);
    if (!q && searchMarker) { searchMarker.remove(); searchMarker = null; }
    if (q.length < 2) { el('search-dropdown').style.display = 'none'; el('search-bar').classList.remove('has-results'); return; }
    const dd = el('search-dropdown'); dd.className = 'loading'; dd.innerHTML = '<div class="search-loader-container"><div class="poly-loader small"></div></div>'; dd.style.display = 'flex';
    el('search-bar').classList.add('has-results');
    searchDebounce = setTimeout(() => performAutocomplete(q), 300);
});
function clearSearch() { const i = el('search-input'); i.value = ''; el('search-clear').style.display = 'none'; el('search-dropdown').style.display = 'none'; el('search-bar').classList.remove('has-results'); if (searchMarker) { searchMarker.remove(); searchMarker = null; } i.focus(); }

// --- Popup Creation Helper ---
// --- Generic Popup Creator ---
window.createPopup = (lngLat, html, props = {}, layer = 'generic', opts = {}) => {
    if (currentPopup) currentPopup.remove();

    // Wrap content for toggling
    const mainHtml = `<div class="popup-main-view">${html}</div>`;
    const jsonHtml = `<div class="popup-json-view" style="display:none; white-space: pre-wrap; font-family: monospace; font-size: 10px; max-height: 300px; overflow-y: auto;">${JSON.stringify(props, null, 2)}</div>`;

    currentPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'cyber-popup', ...opts })
        .setLngLat(lngLat)
        .setHTML(mainHtml + jsonHtml)
        .addTo(map);

    // Smoothly pan camera to center the datapoint
    map.easeTo({
        center: lngLat,
        offset: [0, (-window.innerHeight * 0.15) + 20],
        duration: 500
    });

    currentPopup.on('close', () => {
        currentPopup = null;
        opts.onClose?.();
    });

    // Add buttons
    setTimeout(() => {
        const popupEl = currentPopup?.getElement();
        if (!popupEl) return;
        const content = popupEl.querySelector('.maplibregl-popup-content');
        if (!content) return;

        // Cloud Button
        const sendBtn = document.createElement('button');
        sendBtn.className = 'popup-cloud-btn';
        sendBtn.title = 'Send to Live Feed';
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></svg>';
        sendBtn.onclick = async (e) => {
            e.stopPropagation();

            try {
                const { MemoSender } = await loadLiveFeedModule();
                const WalletManager = window.WalletManager;

                // Logic: If wallet is connected, show confirmation. 
                // Otherwise, call send() directly which triggers connection flow.
                if (WalletManager && WalletManager.wallet && WalletManager.pubkey && window.showInscriptionConfirmation) {
                    window.showInscriptionConfirmation(props, layer, lngLat, MemoSender);
                } else {
                    sendBtn.style.opacity = '0.5';
                    sendBtn.style.pointerEvents = 'none';
                    const result = await MemoSender?.send(props, layer, lngLat);

                    setTimeout(() => {
                        sendBtn.style.opacity = '';
                        sendBtn.style.pointerEvents = '';
                        if (result) {
                            sendBtn.style.color = '#00ff00';
                            setTimeout(() => sendBtn.style.color = '', 2000);
                        }
                    }, 500);
                }
            } catch (err) {
                console.error("Failed to load MemoSender:", err);
                sendBtn.style.opacity = '';
                sendBtn.style.pointerEvents = '';
            }
        };
        content.appendChild(sendBtn);

        // JSON Toggle Button
        const jsonBtn = document.createElement('button');
        jsonBtn.className = 'popup-json-btn';
        jsonBtn.title = 'Toggle JSON View';
        jsonBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V6a2 2 0 0 0-2-2h-1"/></svg>';
        jsonBtn.onclick = (e) => {
            e.stopPropagation();
            jsonBtn.style.opacity = '0.5';
            setTimeout(() => jsonBtn.style.opacity = '', 200);

            const main = content.querySelector('.popup-main-view');
            const json = content.querySelector('.popup-json-view');
            if (json.style.display === 'none') {
                main.style.display = 'none';
                json.style.display = 'block';
                jsonBtn.style.color = '#00ff00'; // Active
            } else {
                main.style.display = 'block';
                json.style.display = 'none';
                jsonBtn.style.color = '';
            }
        };
        content.appendChild(jsonBtn);

        // Copy Summary Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'popup-copy-btn';
        copyBtn.title = 'Copy Summary';
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.onclick = async (e) => {
            e.stopPropagation();

            copyBtn.style.opacity = '0.5';
            copyBtn.style.pointerEvents = 'none';

            // Copy whatever is currently visible
            const json = content.querySelector('.popup-json-view');
            let text = '';
            if (json.style.display !== 'none') {
                text = JSON.stringify(props, null, 2);
            } else {
                text = Object.entries(props).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n');
            }

            try {
                await navigator.clipboard.writeText(text);
                setTimeout(() => {
                    copyBtn.style.opacity = '';
                    copyBtn.style.pointerEvents = '';
                    copyBtn.style.color = '#00ff00';
                    setTimeout(() => copyBtn.style.color = '', 2000);
                }, 300);
            } catch (err) {
                console.error('Failed to copy', err);
                copyBtn.style.opacity = '';
                copyBtn.style.pointerEvents = '';
            }
        };
        content.appendChild(copyBtn);

        // NEW: Time Ago Indicator for Live Feed items
        if (props._fromLiveFeed) {
            const timeDisplay = document.createElement('div');
            timeDisplay.className = 'popup-time-display';
            let timeText = 'JUST NOW';

            if (props._forceTimeLabel) {
                // Use the exact string passed from Live Feed (forced by user request)
                timeText = props._forceTimeLabel;
            } else if (props.time) {
                const ts = props.time;
                const diff = Date.now() - ts;
                const min = Math.floor(diff / 60000);

                if (min >= 1) {
                    if (min < 60) timeText = `${min}M AGO`;
                    else {
                        const hr = Math.floor(min / 60);
                        if (hr < 24) timeText = `${hr}H AGO`;
                        else {
                            const day = Math.floor(hr / 24);
                            timeText = `${day}D AGO`;
                        }
                    }
                }
            }
            // Only append if we have text (or fallback is JUST NOW)
            timeDisplay.textContent = timeText; // Using textContent instead of innerText for perf

            // Styles
            timeDisplay.style.position = 'absolute';
            timeDisplay.style.top = '8px';
            timeDisplay.style.left = '12px'; // Align left
            timeDisplay.style.fontSize = '12px';
            timeDisplay.style.fontWeight = 'bold';
            timeDisplay.style.color = '#888'; // Subtle
            timeDisplay.style.fontFamily = "'Courier New', monospace";
            timeDisplay.style.zIndex = '10';
            timeDisplay.style.pointerEvents = 'none';

            content.appendChild(timeDisplay);
        }
    }, 10);

    return currentPopup;
};

function showRadioPopup(p, coords) {
    const safe = s => (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const cur = getCurrentStation?.(), playing = cur?.id === p.id && isRadioPlaying?.();
    const html = `<div class="popup-row"><span class="popup-label">STATION:</span> ${safe(p.name) || 'UNKNOWN'}</div>
        <div class="popup-row"><span class="popup-label">LOCATION:</span> ${p.country || 'UNKNOWN'}${p.state ? ', ' + p.state : ''}${p.language ? ' (' + p.language + ')' : ''}</div>
        <div class="popup-row"><span class="popup-label">CODEC:</span> ${p.codec || 'UNKNOWN'}</div>
        <div class="popup-row"><span class="popup-label">BITRATE:</span> ${p.bitrate ? p.bitrate + ' kbps' : 'UNKNOWN'}</div>
        ${p.tags ? `<div class="popup-row"><span class="popup-label">TAGS:</span> ${p.tags}</div>` : ''}
        <div class="radio-popup-player"><button onclick="window.toggleRadioFromPopup('${p.id}','${safe(p.name)}','${safe(p.url_resolved || p.url)}','${p.codec || ''}',${p.bitrate || 0})" class="radio-play-btn ${playing ? 'playing' : ''}">${playing ? 'PAUSE' : 'PLAY'}</button></div>
        ${p.homepage ? `<a href="${p.homepage}" target="_blank" class="intel-btn">[ HOMEPAGE ]</a>` : ''}`;
    createPopup(coords, html, p, 'radio-stations');
    setTimeout(() => { try { window.currentRadioPopupElement = currentPopup.getElement(); } catch { } }, 50);
    currentPopup.on('close', () => { if (!getCurrentStation?.() || getCurrentStation().id !== p.id) window.currentRadioPopupElement = null; });
}

function showMeshPopup(p, coords) {
    const type = p.meshType || 'meshtastic', safe = s => (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const timeAgo = ts => { if (!ts) return 'N/A'; try { const d = typeof ts === 'string' ? new Date(ts) : new Date(ts * 1000), m = Math.floor((Date.now() - d) / 60000); if (m < 1) return 'Just now'; if (m < 60) return m + ' min ago'; const dy = Math.floor(m / 1440); if (dy < 30) return dy + ' day' + (dy > 1 ? 's' : '') + ' ago'; const mo = Math.floor(dy / 30); return mo < 12 ? mo + ' month' + (mo > 1 ? 's' : '') + ' ago' : Math.floor(mo / 12) + ' yr ago'; } catch { return 'N/A'; } };
    const row = (label, val) => val !== undefined && val !== null && val !== '' ? `<div class="popup-row"><span class="popup-label">${label}:</span> ${val}</div>` : '';

    let html = row('TYPE', type === 'meshcore' ? 'MESHCORE' : 'MESHTASTIC');
    if (type === 'meshcore') {
        let link = ''; if (p.link) { const trunc = p.link.length > 50 ? p.link.slice(0, 30) + '...' + p.link.slice(-10) : p.link; link = `<div class="popup-row"><span class="popup-label">LINK:</span> <span style="font-size:10px;word-break:break-all">${trunc}</span> <button class="copy-link-btn" data-link="${safe(p.link)}" title="Copy"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="6" width="10" height="14"/><rect x="9" y="4" width="10" height="14"/></svg></button></div>`; }
        let radio = ''; if (p.frequency || p.bandwidth || p.codingRate || p.spreadingFactor) { const params = [p.frequency && 'Freq: ' + p.frequency, p.bandwidth && 'BW: ' + p.bandwidth, p.codingRate && 'CR: ' + p.codingRate, p.spreadingFactor && 'SF: ' + p.spreadingFactor].filter(Boolean).join('<br>&nbsp;'); if (params) radio = `<div class="popup-row"><span class="popup-label">RADIO:</span><br><span style="font-size:10px;margin-left:10px">${params}</span></div>`; }
        html += row('NAME', p.nodeName) + row('TYPE', p.nodeType) + row('UPDATE', p.updateStatus) + link + row('INSERTED', timeAgo(p.insertedDate)) + row('UPDATED', timeAgo(p.updatedDate)) + (p.publicKey ? `<div class="popup-row"><span class="popup-label">KEY:</span> <span style="font-size:10px;word-break:break-all">${p.publicKey}</span></div>` : '') + (coords?.length === 2 ? row('COORDS', coords[1].toFixed(4) + ', ' + coords[0].toFixed(4)) : '') + row('PRESET', p.radioPreset) + radio;
    } else {
        const id = p.hexId || p.numericId || p.nodeId || 'UNKNOWN';
        html += row('ID', id) + row('NODE', p.nodeName) + row('SHORT', p.shortName) + (p.mqttConnected !== undefined ? row('MQTT', (p.mqttConnected ? 'Connected' : 'Disconnected') + (p.mqttLastSeen ? ' (' + timeAgo(p.mqttLastSeen) + ')' : '')) : '') + row('LOCAL NODES', p.localNodes) + row('PRECISION', p.positionPrecision && p.positionPrecision + 'km') + row('ROLE', p.role) + row('HW', p.hardware) + row('FW', p.firmware) + row('REGION', p.region) + row('MODEM', p.modemPreset) + (p.hasDefaultChannel !== undefined ? row('DEFAULT CH', p.hasDefaultChannel ? 'Yes' : 'No') : '') + row('BATTERY', p.batteryState || p.battery) + row('VOLTAGE', p.voltage && p.voltage + 'V') + row('AIR UTIL', p.airUtil && p.airUtil + '%') + row('ALT', p.altitude || 'N/A') + (p.hexId && p.hexId !== id ? row('HEX', p.hexId) : '') + row('UPDATED', timeAgo(p.lastHeard));
    }

    createPopup(coords, html, p, 'mesh-nodes');
    if (type === 'meshcore' && p.link) currentPopup._content?.querySelector('.copy-link-btn')?.addEventListener('click', function (e) { e.stopPropagation(); navigator.clipboard.writeText(this.dataset.link).then(() => { this.style.cssText = 'background:#0f0;border-color:#0f0;color:#000'; setTimeout(() => this.style.cssText = '', 2000); }).catch(() => { this.style.cssText = 'background:#f33;border-color:#f33'; setTimeout(() => this.style.cssText = '', 2000); }); });
}

async function performAutocomplete(query) {
    const dd = el('search-dropdown');
    dd.className = '';
    dd.innerHTML = ''; // Start clean

    // 1. Get and render local entities immediately
    const entities = searchLocalEntities(query);
    const renderItem = (item) => {
        const div = document.createElement('div'); div.className = 'search-item';
        let label = item.display_name, display = label, type = 'LOC', coords = [+item.lon, +item.lat];
        if (item.properties) {
            const p = item.properties, isFlight = p.icao !== undefined, isRadio = p.name && p.codec, isMesh = p.nodeId || p.nodeName, isSpace = ['SATELLITE', 'STATION', 'DEBRIS'].includes(p.type) && p.id, isCable = p.status && item.geometry?.type === 'LineString', isLanding = p.country && !p.codec && !p.status && !p.type && item.geometry?.type === 'Point';
            label = p.callsign || p.vesselName || p.icao || p.name || p.nodeName || 'Unknown'; display = label;
            if (isFlight) { type = 'SKY'; if (p.icao) display = label = `${label} [${p.icao}]`; }
            else if (isSpace) type = 'SPACE';
            else if (isRadio) { type = 'RADIO'; if (p.countrycode && p.countrycode !== 'XX') display = label = `${label} [${p.countrycode}]`; if (p.tags?.trim()) { const t = p.tags.split(',').slice(0, 5).map(x => x.trim()).filter(Boolean).join(', '); if (t) display = `${label} <span style="color:#888;font-size:10px">${t}</span>`; } }
            else if (isMesh) { type = p.meshType === 'meshcore' ? 'MCORE' : 'MTASTIC'; const d = [p.shortName && 'SN:' + p.shortName, p.role && 'Role:' + p.role, p.hardware && 'HW:' + p.hardware].filter(Boolean).join(', '); display = `NODE: ${p.nodeName || 'UNKNOWN'}${d ? ` <span style="color:#888;font-size:10px">${d}</span>` : ''} <span style="color:#666;font-size:10px">ID:${p.nodeId || 'N/A'}</span>`; }
            else if (isCable) type = 'CABLE'; else if (isLanding) { type = 'LANDING'; if (p.country && p.country !== 'N/A') display = label = `${label} [${p.country}]`; } else type = 'SEA';
            coords = item.geometry?.type === 'LineString' ? item.geometry.coordinates[0] : (item.geometry?.coordinates || coords);
        }
        div.innerHTML = `<span><span class="search-tag">${type}</span> ${display}</span>`;
        div.addEventListener('click', () => { dd.style.display = 'none'; el('search-bar').classList.remove('has-results'); el('search-input').value = label; map.flyTo({ center: coords, zoom: 14, duration: 1000 }); setTimeout(() => { updateSearchMarker(coords); if (type === 'RADIO' && item.properties) showRadioPopup(item.properties, coords); else if (['MTASTIC', 'MCORE'].includes(type) && item.properties) showMeshPopup(item.properties, coords); }, 1100); });
        dd.appendChild(div);
    };

    if (entities.length > 0) {
        entities.forEach(renderItem);
        dd.style.setProperty('display', 'block', 'important');
    }

    // 2. Add Loader at the bottom
    const loaderId = 'search-loader-bottom';
    const loader = document.createElement('div');
    loader.id = loaderId;
    loader.innerHTML = '<div class="poly-loader small" style="margin: 10px auto;"></div>';
    dd.appendChild(loader);
    dd.style.setProperty('display', 'block', 'important');
    el('search-bar').classList.add('has-results');

    // 3. Fetch remote locations via PHP Proxy (with Open-Meteo fallback)
    let locs = [];
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
    try {
        // Use centralized proxy chain (PHP first, then third-party, then Open-Meteo direct)
        const response = await fetchWithProxyChain(nominatimUrl);
        const text = await response.text();
        if (text && text.trim().startsWith('[')) {
            locs = JSON.parse(text);
        } else {
            throw new Error('Invalid response');
        }
    } catch (e) {
        // Fallback to Open-Meteo if all proxies fail (Open-Meteo is CORS-friendly)
        try {
            const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&format=json`;
            const omResp = await fetch(omUrl);
            if (omResp.ok) {
                const omData = await omResp.json();
                if (omData.results) {
                    locs = omData.results.map(r => ({
                        display_name: `${r.name}, ${r.country || ''} (${r.admin1 || ''})`,
                        lat: r.latitude,
                        lon: r.longitude,
                        type: 'LOC'
                    }));
                }
            }
        } catch { /* silently fail */ }
    }

    // 4. Remove Loader
    const loaderEl = document.getElementById(loaderId);
    if (loaderEl) loaderEl.remove();

    // 5. Render remote results
    if (locs.length > 0) {
        locs.forEach(renderItem);
    }

    // Hide dropdown if no results
    if (dd.children.length === 0) {
        dd.style.display = 'none';
    }
}

function searchLocalEntities(query) {
    const q = query.toUpperCase(), cfg = { 'opensky-data': { limit: 5, fields: ['callsign', 'icao'] }, 'gfw-data': { limit: 5, fields: ['vesselName', 'ssvid', 'imo'] }, 'radio-data': { limit: Infinity, fields: ['name', 'country', 'state', 'tags', 'codec'] }, 'mesh-data': { limit: Infinity, fields: ['nodeName', 'nodeId', 'shortName', 'role', 'hardware', 'firmware', 'region', 'modemPreset', 'hexId', 'numericId', 'nodeType'] }, 'cable-data': { limit: Infinity, fields: ['name'] }, 'landing-points-data': { limit: Infinity, fields: ['name', 'country'] }, 'space-data': { limit: Infinity, fields: ['name', 'id'] } };
    return Object.entries(cfg).flatMap(([src, { limit, fields }]) => (map.querySourceFeatures(src) || []).filter(f => fields.some(fld => { const v = f.properties[fld]; return v && String(v).toUpperCase().includes(q); })).slice(0, limit));
}

// Close dropdown when clicking outside - with explicit dropdown check for iOS
document.addEventListener('click', e => {
    const sb = el('search-bar');
    const dd = el('search-dropdown');
    const toggle = el('mobile-search-toggle');
    if (!sb.contains(e.target) && !toggle.contains(e.target) && !dd.contains(e.target)) {
        dd.style.display = 'none';
        sb.classList.remove('has-results');
    }
});

el('mobile-search-toggle').addEventListener('click', () => { const sb = el('search-bar'); sb.classList.toggle('active'); if (sb.classList.contains('active')) el('search-input').focus(); });

// Globe Toggle
const globeBtn = el('globe-toggle-btn'), globeIcon = el('globe-icon'), flatIcon = el('flat-icon');
if (globeIcon && flatIcon) { globeIcon.style.display = 'inline'; flatIcon.style.display = 'none'; }
function setupGlobeToggle() { if (!globeBtn || !globeIcon || !flatIcon) return; if (map) { map.loaded() ? attachGlobeToggle() : map.once('load', attachGlobeToggle); } else setTimeout(setupGlobeToggle, 100); }
function attachGlobeToggle() {
    if (!globeBtn || !map) return;
    globeBtn.addEventListener('click', () => {
        isGlobeMode = !isGlobeMode;
        try {
            const { center, zoom, bearing } = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing() }, style = map.getStyle();
            if (!style) throw new Error('No style');
            map.setStyle({ version: style.version || 8, projection: { type: isGlobeMode ? 'globe' : 'mercator' }, glyphs: style.glyphs, sources: style.sources, layers: style.layers });
            map.once('styledata', () => { map.setCenter(center); map.setZoom(zoom); map.easeTo({ center, bearing, pitch: isGlobeMode ? 45 : 0, zoom: isGlobeMode ? Math.max(zoom, 2) : zoom, duration: 1000 }); });
            globeIcon.style.display = isGlobeMode ? 'none' : 'inline'; flatIcon.style.display = isGlobeMode ? 'inline' : 'none';
            logSystem(`GUI: ${isGlobeMode ? 'Globe' : 'Flat'} view.`);
        } catch (e) { logSystem(`ERR: ${e.message}`); isGlobeMode = !isGlobeMode; }
    });
}
setupGlobeToggle();

// --- Toast Notification System ---
const Toast = {
    container: null,
    colors: { success: '#00ff00', error: '#ff3333', warn: '#ffaa00', info: '#ff6800' },
    icons: { success: '✓', error: '✗', warn: '⚠', info: '' },

    init() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        // Position to the left of settings button (top: 20px, right: 70px to account for 36px button + 20px margin + 14px gap)
        this.container.style.cssText = 'position:fixed;top:20px;right:70px;z-index:10000;display:flex;flex-direction:column;gap:10px;pointer-events:none;align-items:flex-end';
        document.body.appendChild(this.container);
    },

    _render(type, message) {
        const c = this.colors[type] || this.colors.info;
        const spinner = type === 'info' ? '<span class="toast-spinner"></span>' : '';
        return { color: c, html: `${spinner}<span class="toast-icon">${this.icons[type] || ''}</span><span class="toast-msg">${message}</span>` };
    },

    show(type, message, duration = 0) {
        this.init();
        const { color, html } = this._render(type, message);
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        // Match settings button background: rgba(0,0,0,0.8) with border and box-shadow
        toast.style.cssText = `background:rgba(0,0,0,0.8);border:1px solid ${color};color:${color};padding:12px 16px;font-family:'Courier New',monospace;font-size:12px;min-width:280px;max-width:400px;pointer-events:auto;animation:toastSlideIn 0.3s ease;display:flex;align-items:center;gap:10px;box-shadow:0 0 10px ${color}`;
        toast.innerHTML = html;
        this.container.appendChild(toast);
        if (duration > 0) setTimeout(() => this.remove(toast), duration);
        return toast;
    },

    update(toast, type, message, duration = 0) {
        if (!toast) return;
        const { color, html } = this._render(type, message);
        toast.style.borderColor = toast.style.color = color;
        toast.className = `toast toast-${type}`;
        toast.innerHTML = html;
        if (duration > 0) setTimeout(() => this.remove(toast), duration);
    },

    remove(toast) {
        if (!toast?.parentNode) return;
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }
};

window.Toast = Toast;
