// --- Repeater Data Logic (RepeaterBook via Proxy) ---

// Constants
const REPEATER_CACHE_NAME = 'geo-osint-repeaters-v1';
const MAX_SELECTED_AREAS = 3;
const RENDER_BATCH_SIZE = 50;
const CHUNK_SIZE = 500;
const STATUS_BOX_REMOVE_DELAY = 2000;
const STATUS_UPDATE_INTERVAL = 50;

// State
let repeaterInterval = null;
let cachedRepeaters = {}; // Cache to avoid re-fetching - keyed by state/region name
let cachedRepeaterCounts = {}; // Store total counts per area - keyed by state/region name
let repeaterSelectionHandler = null;
let hoveredStateId = null;
let selectedAreas = []; // Track selected areas (max 3)
let selectionModeActive = false;

// Helper: Update loading status text
function updateRepeaterStatus(text, loadingText, customLoadingText = null, className = '') {
    if (!loadingText) return;
    if (customLoadingText) {
        loadingText.innerHTML = `<span class="blink">>></span> STATUS: <span${className ? ` class="${className}"` : ''}>${text}</span>`;
    } else {
        loadingText.innerText = text;
        if (className) loadingText.className = className;
    }
}

// Helper: Remove status box after delay
function removeStatusBoxAfterDelay(box, delay = STATUS_BOX_REMOVE_DELAY) {
    if (!box) return;
    setTimeout(() => {
        if (box.parentNode) box.parentNode.removeChild(box);
    }, delay);
}

// Helper: Set/clear feature state
function setFeatureState(featureId, source, sourceLayer, state) {
    if (!map || !featureId || !source) return;
    try {
        map.setFeatureState({ source, id: featureId, sourceLayer }, state);
    } catch (e) {
        // Ignore errors
    }
}

// Helper: Clear all selected area highlights
function clearSelectedAreaHighlights() {
    selectedAreas.forEach(area => {
        if (area.featureId && area.source) {
            setFeatureState(area.featureId, area.source, area.sourceLayer, { selected: false });
        }
    });
}

// Helper: Check cache and return cached data
async function checkRepeaterCache(cacheKey, proxyUrl) {
    // Check in-memory cache first
    if (cachedRepeaters[cacheKey]?.length > 0) {
        return {
            repeaters: cachedRepeaters[cacheKey],
            count: cachedRepeaterCounts[cacheKey] || cachedRepeaters[cacheKey].length,
            source: 'memory'
        };
    }

    // Check Cache API
    if (typeof window !== 'undefined' && 'caches' in window) {
        try {
            const cache = await caches.open(REPEATER_CACHE_NAME);
            const cachedResponse = await cache.match(proxyUrl);
            if (cachedResponse) {
                const data = await cachedResponse.json();
                const repeaters = Array.isArray(data) ? data : (data.results || []);
                const count = data.count || data.total || repeaters.length;
                if (repeaters.length > 0) {
                    cachedRepeaters[cacheKey] = repeaters;
                    cachedRepeaterCounts[cacheKey] = count;
                    return { repeaters, count, source: 'cache-api' };
                }
            }
        } catch (e) {
            console.warn('Cache API check failed:', e);
        }
    }
    return null;
}

// Initialize Cache API and load cached data into memory
async function initRepeaterCache() {
    if (typeof window === 'undefined' || !('caches' in window)) return;

    try {
        const cache = await caches.open(REPEATER_CACHE_NAME);
        const requests = await cache.keys();
        console.log('Loading', requests.length, 'cached repeater responses from Cache API...');

        for (const request of requests) {
            try {
                // Try to identify the cache key from the URL
                // Proxy URL format: https://api.allorigins.win/raw?url=...
                const url = new URL(request.url);
                const proxyUrlParam = url.searchParams.get('url');

                if (proxyUrlParam) {
                    const apiUrl = decodeURIComponent(proxyUrlParam);
                    const stateMatch = apiUrl.match(/[?&](?:state|country)=([^&]+)/);

                    if (stateMatch) {
                        const cacheKey = decodeURIComponent(stateMatch[1]).toLowerCase().trim();
                        const response = await cache.match(request);
                        if (response) {
                            const data = await response.json();
                            const repeaters = Array.isArray(data) ? data : (data.results || []);

                            if (repeaters.length > 0) {
                                cachedRepeaters[cacheKey] = repeaters;
                                cachedRepeaterCounts[cacheKey] = data.count || data.total || repeaters.length;
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore errors for individual items
            }
        }
        console.log('Cache initialization complete. Loaded', Object.keys(cachedRepeaters).length, 'areas from Cache API');
    } catch (e) {
        console.warn('Failed to initialize repeater cache:', e);
    }
}

// Initialize on load
initRepeaterCache();

// Function to save response to Cache API (replaces localStorage save)
// This is now handled directly in fetchRepeaters via cache.put()
function saveRepeaterCache() {
    // Deprecated - kept for compatibility but does nothing
}

// Expose cache to window for cache size calculation
exposeCache('cachedRepeaters', () => cachedRepeaters);


// Hide UI elements during selection mode
function hideUIForSelection() {
    // Back button text update logic
    const updateBackButtonText = () => {
        const prompt = getEl('repeater-select-prompt');
        const backBtn = getEl('repeater-back-btn');
        if (prompt && backBtn && prompt.style.display !== 'none') {
            requestAnimationFrame(() => {
                const screenWidth = window.innerWidth;
                const promptRect = prompt.getBoundingClientRect();
                const backBtnRect = backBtn.getBoundingClientRect();
                const overlapThreshold = 30;
                const wouldOverlap = promptRect.left < (backBtnRect.right + overlapThreshold);
                const isVeryNarrow = screenWidth < 600;

                if (wouldOverlap || isVeryNarrow) {
                    backBtn.textContent = '<<';
                    backBtn.style.padding = '8px 12px';
                } else {
                    backBtn.textContent = '<< RETURN';
                    backBtn.style.padding = '8px 15px';
                }
            });
        }
    };

    UIVisibilityManager.toggleSelectionMode(true, {
        onBackButtonShow: (backBtn) => {
            updateBackButtonText();
            if (window.repeaterSelectionResizeHandler) {
                window.removeEventListener('resize', window.repeaterSelectionResizeHandler);
            }
            let resizeTimeout;
            window.repeaterSelectionResizeHandler = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(updateBackButtonText, 100);
            };
            window.addEventListener('resize', window.repeaterSelectionResizeHandler);
        }
    });

    selectionModeActive = true;
}

// Restore UI elements after selection mode
function restoreUIFromSelection() {
    UIVisibilityManager.toggleSelectionMode(false);

    // Remove resize handler
    if (window.repeaterSelectionResizeHandler) {
        window.removeEventListener('resize', window.repeaterSelectionResizeHandler);
        window.repeaterSelectionResizeHandler = null;
    }

    selectionModeActive = false;
}

// Sync all button widths (selected areas, LOAD, SKIP) to match
// Store the target width to prevent shrinking on repeated calls
let cachedButtonWidth = null;
let cachedViewportWidth = null;

function syncAllButtonWidths() {
    const skipBtn = getEl('repeater-skip-btn');
    const loadBtn = getEl('repeater-load-btn');
    const areasContainerEl = getEl('repeater-selected-areas');

    // Check if SKIP button is visible
    const isSkipVisible = skipBtn && skipBtn.style.display !== 'none';

    // Adjust vertical position based on SKIP button visibility
    if (loadBtn && areasContainerEl) {
        if (isSkipVisible) {
            // Standard positions when SKIP is shown
            loadBtn.style.bottom = '85px';
            areasContainerEl.style.bottom = '145px';
        } else {
            // Lower positions when SKIP is hidden (move down to fill space)
            loadBtn.style.bottom = '30px';
            areasContainerEl.style.bottom = '90px';
        }
    }

    // Calculate max available width (viewport minus margins)
    const isMobile = window.innerWidth <= 768;
    const maxWidth = isMobile ? Math.min(window.innerWidth - 40, 350) : Math.min(window.innerWidth - 40, 500);
    const minWidth = isMobile ? 200 : 250;

    // Check if viewport changed - if so, recalculate target width
    const viewportChanged = cachedViewportWidth !== window.innerWidth;

    // Only recalculate target width if viewport changed or we don't have a cached width
    if (viewportChanged || cachedButtonWidth === null) {
        let referenceWidth = null;

        // Temporarily remove width constraints to get natural content width
        const tempWidths = new Map();
        if (skipBtn && skipBtn.style.display !== 'none') {
            tempWidths.set(skipBtn, skipBtn.style.width);
            skipBtn.style.width = 'auto';
        }
        if (loadBtn && loadBtn.style.display !== 'none') {
            tempWidths.set(loadBtn, loadBtn.style.width);
            loadBtn.style.width = 'auto';
        }

        // Force layout recalculation
        if (skipBtn || loadBtn) {
            void document.body.offsetHeight; // Trigger reflow
        }

        // Get natural width from content
        if (skipBtn && skipBtn.style.display !== 'none' && skipBtn.offsetWidth > 0) {
            const naturalWidth = skipBtn.scrollWidth || skipBtn.offsetWidth;
            referenceWidth = Math.max(minWidth, Math.min(naturalWidth, maxWidth));
        } else if (loadBtn && loadBtn.style.display !== 'none' && loadBtn.offsetWidth > 0) {
            const naturalWidth = loadBtn.scrollWidth || loadBtn.offsetWidth;
            referenceWidth = Math.max(minWidth, Math.min(naturalWidth, maxWidth));
        } else {
            // Fallback: use a reasonable default width
            referenceWidth = Math.max(minWidth, Math.min(300, maxWidth));
        }

        // Restore temporary widths
        tempWidths.forEach((width, element) => {
            element.style.width = width;
        });

        // Cache the calculated width
        cachedButtonWidth = referenceWidth;
        cachedViewportWidth = window.innerWidth;
    }

    // Use cached width (only recalculated on viewport change)
    const finalWidth = cachedButtonWidth;

    if (finalWidth) {
        // Apply to all three elements consistently
        if (loadBtn) {
            loadBtn.style.width = finalWidth + 'px';
            loadBtn.style.maxWidth = maxWidth + 'px';
            loadBtn.style.minWidth = minWidth + 'px';
        }
        if (skipBtn) {
            skipBtn.style.width = finalWidth + 'px';
            skipBtn.style.maxWidth = maxWidth + 'px';
            skipBtn.style.minWidth = minWidth + 'px';
        }
        if (areasContainerEl && areasContainerEl.style.display !== 'none') {
            areasContainerEl.style.width = finalWidth + 'px';
            areasContainerEl.style.maxWidth = maxWidth + 'px';
            areasContainerEl.style.minWidth = minWidth + 'px';
        }
    }
}

// Remove selected area
function removeSelectedArea(index) {
    if (index >= 0 && index < selectedAreas.length) {
        const removed = selectedAreas.splice(index, 1)[0];
        setFeatureState(removed.featureId, removed.source, removed.sourceLayer, { selected: false });
        logSystem(`NET: Removed ${removed.name} from selection.`);
        updateSelectedAreasDisplay();
    }
}

// Update selected areas display
function updateSelectedAreasDisplay() {
    const countEl = getEl('repeater-selected-count');
    if (countEl) countEl.textContent = selectedAreas.length;

    // Update selected areas list
    const areasListEl = getEl('repeater-selected-list');
    const areasContainerEl = getEl('repeater-selected-areas');

    if (areasListEl && areasContainerEl) {
        if (selectedAreas.length > 0) {
            areasContainerEl.style.display = 'block';

            // Width will be matched after LOAD button is shown (see below)

            areasListEl.innerHTML = '';

            selectedAreas.forEach((area, index) => {
                const areaItem = document.createElement('div');
                applyStyles(areaItem, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', color: 'var(--color-success)', fontSize: '12px',
                    textTransform: 'uppercase', letterSpacing: '1px', width: '100%',
                    border: '1px solid var(--color-success)', background: 'rgba(0, 0, 0, 0.95)',
                    boxShadow: '0 0 8px rgba(0, 255, 0, 0.3)'
                });

                const areaName = document.createElement('span');
                areaName.textContent = area.name;
                applyStyles(areaName, {
                    flex: '1', fontWeight: 'bold', textAlign: 'left',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0'
                });

                const removeBtn = document.createElement('span');
                removeBtn.textContent = '✕';
                applyStyles(removeBtn, {
                    cursor: 'pointer', marginLeft: '12px', color: '#ff6666',
                    fontSize: '14px', fontWeight: 'bold', padding: '0 4px',
                    transition: 'all 0.2s', opacity: '0.8', flexShrink: '0'
                });
                removeBtn.onmouseover = () => applyStyles(removeBtn, { opacity: '1', color: '#ff0000', transform: 'scale(1.2)' });
                removeBtn.onmouseout = () => applyStyles(removeBtn, { opacity: '0.8', color: '#ff6666', transform: 'scale(1)' });
                removeBtn.onclick = () => removeSelectedArea(index);

                areaItem.appendChild(areaName);
                areaItem.appendChild(removeBtn);
                areasListEl.appendChild(areaItem);
            });
        } else {
            areasContainerEl.style.display = 'none';
        }
    }

    const loadBtn = getEl('repeater-load-btn');
    if (loadBtn) {
        if (selectedAreas.length > 0 && selectedAreas.length <= 3) {
            loadBtn.style.display = 'block';

            // Dynamically adjust font size to prevent wrapping on mobile
            const adjustLoadButtonText = () => {
                if (loadBtn.offsetWidth > 0) {
                    const loadBtnText = loadBtn;
                    const maxWidth = loadBtn.offsetWidth - 60; // Account for padding (30px each side)
                    const currentWidth = loadBtnText.scrollWidth;

                    if (currentWidth > maxWidth && maxWidth > 0) {
                        // Calculate scale factor
                        const scale = maxWidth / currentWidth;
                        const currentFontSize = parseFloat(window.getComputedStyle(loadBtn).fontSize) || 18;
                        const newFontSize = Math.max(12, Math.floor(currentFontSize * scale * 0.95)); // Min 12px, slightly smaller for safety
                        loadBtn.style.fontSize = newFontSize + 'px';
                    } else {
                        // Reset to default if there's space
                        loadBtn.style.fontSize = '';
                    }
                }
            };

            // Adjust on display and resize
            requestAnimationFrame(() => {
                adjustLoadButtonText();
                const adjustResizeHandler = () => {
                    requestAnimationFrame(adjustLoadButtonText);
                };
                // Remove old handler if exists
                if (window.repeaterLoadButtonResizeHandler) {
                    window.removeEventListener('resize', window.repeaterLoadButtonResizeHandler);
                }
                window.repeaterLoadButtonResizeHandler = adjustResizeHandler;
                window.addEventListener('resize', window.repeaterLoadButtonResizeHandler);
            });

            // Sync widths after layout is calculated
            requestAnimationFrame(() => {
                syncAllButtonWidths();
                // Also sync on resize
                const syncResizeHandler = () => {
                    requestAnimationFrame(syncAllButtonWidths);
                };
                if (window.repeaterButtonSyncResizeHandler) {
                    window.removeEventListener('resize', window.repeaterButtonSyncResizeHandler);
                }
                window.repeaterButtonSyncResizeHandler = syncResizeHandler;
                window.addEventListener('resize', window.repeaterButtonSyncResizeHandler);
            });
        } else {
            loadBtn.style.display = 'none';
        }
    }

    // Update prompt
    const mainText = getEl('repeater-select-main-text');
    const subText = getEl('repeater-select-sub-text');
    if (mainText && subText) {
        if (selectedAreas.length >= MAX_SELECTED_AREAS) {
            mainText.textContent = `MAXIMUM ${MAX_SELECTED_AREAS} REGIONS SELECTED. CLICK LOAD TO CONTINUE.`;
        } else {
            mainText.textContent = `SELECT UP TO ${MAX_SELECTED_AREAS} REGIONS: ${selectedAreas.length}/${MAX_SELECTED_AREAS} SELECTED`;
        }
        subText.textContent = 'REPEATER DATA MUST BE LOADED BY AREA';
    }
}

// Enable global region selection
function enableRepeaterSelection() {
    if (typeof map === 'undefined' || !map) return;

    // Reset selected areas
    selectedAreas = [];
    updateSelectedAreasDisplay();

    // Hide UI and show back button
    hideUIForSelection();

    // Show prompt
    const prompt = getEl('repeater-select-prompt');
    const mainText = getEl('repeater-select-main-text');
    const subText = getEl('repeater-select-sub-text');
    if (prompt) {
        prompt.style.display = 'block';
        if (mainText) mainText.textContent = `SELECT UP TO ${MAX_SELECTED_AREAS} REGIONS: 0/${MAX_SELECTED_AREAS} SELECTED`;
        if (subText) subText.textContent = 'REPEATER DATA MUST BE LOADED BY AREA';
    }

    logSystem("GUI: Repeater selection mode active. Click ANY REGION on the map.");
    map.getCanvas().style.cursor = 'crosshair';

    // Load global boundaries for visual feedback
    loadGlobalBoundaries();

    // Check for cached data and show SKIP button
    const skipBtn = getEl('repeater-skip-btn');
    const cachedList = getEl('repeater-cached-list');

    let hasCache = false;
    if (window.cachedRepeaters && typeof window.cachedRepeaters === 'object') {
        const cachedAreas = Object.keys(window.cachedRepeaters).filter(key =>
            window.cachedRepeaters[key] && Array.isArray(window.cachedRepeaters[key]) && window.cachedRepeaters[key].length > 0
        );

        if (cachedAreas.length > 0) {
            hasCache = true;
            if (skipBtn) {
                skipBtn.style.display = 'block';

                // Sync widths after SKIP button is shown
                requestAnimationFrame(() => {
                    syncAllButtonWidths();
                });
            }
            if (cachedList) cachedList.textContent = cachedAreas.map(a => a.toUpperCase()).join(', ');

            // Add click listener to skip button
            skipBtn.onclick = () => {
                logSystem("GUI: Skipping selection, using cached data.");
                disableRepeaterSelection();
            };
        }
    }

    if (!hasCache && skipBtn) {
        skipBtn.style.display = 'none';
    }

    // Remove existing handler if any
    if (repeaterSelectionHandler) {
        map.off('click', repeaterSelectionHandler);

        // Clean up hover listeners
        map.off('mousemove', 'admin-states-fill');
        map.off('mouseleave', 'admin-states-fill');
        map.off('mousemove', 'admin-countries-fill');
        map.off('mouseleave', 'admin-countries-fill');
    }

    // Define handler for map clicks (fallback)
    repeaterSelectionHandler = async (e) => {
        // Prevent clicking on existing features from triggering selection
        const features = map.queryRenderedFeatures(e.point);
        if (features.length > 0) {
            // If we clicked a repeater, let the repeater click handler work
            if (features.some(f => f.layer.id === 'repeaters')) return;

            // Check for Admin Boundaries (States or Countries)
            const stateFeature = features.find(f => f.layer.id === 'admin-states-fill');
            const countryFeature = features.find(f => f.layer.id === 'admin-countries-fill');

            const selectedFeature = stateFeature || countryFeature;

            if (selectedFeature) {
                // Try to get name from properties
                // Natural Earth uses: name, name_en, NAME, admin, ADMIN
                const p = selectedFeature.properties;

                // Check if US/Canada or ROW
                const countryCode = p.adm0_a3 || p.ADM0_A3 || p.iso_a3 || p.ISO_A3 || p.iso_a2 || p.ISO_A2;
                const countryName = p.admin || p.ADMIN || p.sovereignt || p.SOVEREIGNT;

                const usCanCodes = ['USA', 'CAN', 'US', 'CA'];
                const usCanNames = ['United States of America', 'United States', 'Canada'];

                const isUSCan = (countryCode && usCanCodes.includes(countryCode)) ||
                    (countryName && usCanNames.includes(countryName));


                let regionName;
                if (isUSCan) {
                    regionName = p.name || p.NAME || p.name_en || p.admin || p.ADMIN;
                } else {
                    // For ROW, we want the Country name
                    // If we clicked a State (admin-states-fill), p.admin is the country.
                    // If we clicked a Country (admin-countries-fill), p.name is the country.
                    regionName = p.admin || p.ADMIN || p.name || p.NAME;
                }

                if (regionName) {
                    // Check if already selected
                    const normalizedName = regionName.toLowerCase().trim();
                    const existingIndex = selectedAreas.findIndex(a => a.name.toLowerCase().trim() === normalizedName);

                    if (existingIndex !== -1) {
                        // Already selected - DESELECT IT
                        logSystem(`NET: Deselecting ${regionName}...`);
                        removeSelectedArea(existingIndex);
                        return;
                    }

                    if (selectedAreas.length >= MAX_SELECTED_AREAS) {
                        logSystem(`NET: Maximum ${MAX_SELECTED_AREAS} regions selected. Click LOAD to continue.`);
                        return;
                    }

                    // Add to selected areas
                    selectedAreas.push({
                        name: regionName,
                        isUSOrCanada: isUSCan,
                        featureId: selectedFeature.id,
                        source: selectedFeature.layer.source,
                        sourceLayer: selectedFeature.layer['source-layer']
                    });

                    setFeatureState(selectedFeature.id, selectedFeature.layer.source, selectedFeature.layer['source-layer'], { selected: true });
                    logSystem(`NET: Selected region: ${regionName} (${selectedAreas.length}/${MAX_SELECTED_AREAS})`);
                    updateSelectedAreasDisplay();
                    return;
                }
            }
        }

        const { lng, lat } = e.lngLat;
        logSystem(`NET: Identifying region at ${lat.toFixed(2)}, ${lng.toFixed(2)}...`);

        try {
            // Use Nominatim Reverse Geocoding to find admin region
            const response = await fetchWithProxyChain(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5`);
            if (!response.ok) throw new Error('Geocoding failed');

            const data = await response.json();
            const addr = data.address;

            // Prioritize: State -> Region -> Country
            let regionName = addr.state || addr.region || addr.county || addr.country;

            // Determine if US/Canada
            const cc = addr.country_code ? addr.country_code.toUpperCase() : '';
            const isUSCan = cc === 'US' || cc === 'CA' || addr.country === 'United States' || addr.country === 'Canada';

            if (!isUSCan && addr.country) {
                // For ROW, force country name
                regionName = addr.country;
            }


            if (regionName) {
                // Check if already selected
                const normalizedName = regionName.toLowerCase().trim();
                const existingIndex = selectedAreas.findIndex(a => a.name.toLowerCase().trim() === normalizedName);

                if (existingIndex !== -1) {
                    // Already selected - DESELECT IT
                    logSystem(`NET: Deselecting ${regionName}...`);
                    removeSelectedArea(existingIndex);
                    return;
                }

                if (selectedAreas.length >= MAX_SELECTED_AREAS) {
                    logSystem(`NET: Maximum ${MAX_SELECTED_AREAS} regions selected. Click LOAD to continue.`);
                    return;
                }

                selectedAreas.push({ name: regionName, isUSOrCanada: isUSCan, featureId: null, source: null });
                logSystem(`NET: Selected region: ${regionName} (${selectedAreas.length}/${MAX_SELECTED_AREAS})`);
                updateSelectedAreasDisplay();
                return;
            } else {
                logSystem("WARN: Could not identify a valid region at this location.");
            }

        } catch (err) {
            logSystem(`ERR: Region detection failed - ${err.message}`);
        }
    };

    // Add click listener (fallback)
    map.on('click', repeaterSelectionHandler);
}

// Load global boundaries
async function loadGlobalBoundaries() {
    // Check if sources already exist
    let statesLoaded = !!map.getSource('admin-boundaries-states');
    let countriesLoaded = !!map.getSource('admin-boundaries-countries');

    if (statesLoaded && countriesLoaded) {
        ['admin-states-line', 'admin-states-fill', 'admin-countries-line', 'admin-countries-fill'].forEach(layer =>
            MapLayerManager.setLayerVisibility(layer, true)
        );
        return;
    }

    try {
        logSystem("NET: Loading global boundary data...");

        // 1. Load Admin-0 Countries (Base Layer) - 1:110m (Lightweight)
        if (!countriesLoaded) {
            map.addSource('admin-boundaries-countries', {
                type: 'geojson',
                data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
                generateId: true
            });

            // Countries Fill (Base hover)
            map.addLayer({
                'id': 'admin-countries-fill',
                'type': 'fill',
                'source': 'admin-boundaries-countries',
                'layout': { 'visibility': 'visible' },
                'paint': {
                    'fill-color': '#ff6800',
                    'fill-opacity': [
                        'case',
                        ['boolean', ['feature-state', 'selected'], false],
                        0.5,
                        ['boolean', ['feature-state', 'hover'], false],
                        0.2,
                        0
                    ]
                }
            });

            // Countries Outline
            map.addLayer({
                'id': 'admin-countries-line',
                'type': 'line',
                'source': 'admin-boundaries-countries',
                'layout': { 'visibility': 'visible' },
                'paint': {
                    'line-color': '#ff6800',
                    'line-width': 1,
                    'line-opacity': 0.2
                }
            });
        }

        // 2. Load Admin-1 States/Provinces (Top Layer) - 1:50m (Medium Res)
        // Using GitHub Raw for 50m dataset as CDN might not have it
        if (!statesLoaded) {
            const statesUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

            map.addSource('admin-boundaries-states', {
                type: 'geojson',
                data: statesUrl,
                generateId: true
            });

            // States Fill (Top hover)
            map.addLayer({
                'id': 'admin-states-fill',
                'type': 'fill',
                'source': 'admin-boundaries-states',
                'layout': { 'visibility': 'visible' },
                'paint': {
                    'fill-color': '#ff6800',
                    'fill-opacity': [
                        'case',
                        ['boolean', ['feature-state', 'selected'], false],
                        0.5,
                        ['boolean', ['feature-state', 'hover'], false],
                        0.3,
                        0
                    ]
                }
            });

            // States Outline
            map.addLayer({
                'id': 'admin-states-line',
                'type': 'line',
                'source': 'admin-boundaries-states',
                'layout': { 'visibility': 'visible' },
                'paint': {
                    'line-color': '#ff6800',
                    'line-width': 1,
                    'line-opacity': 0.4
                }
            });
        }

        // Hover Effects Setup (Shared logic)
        setupHoverEffects();

        logSystem("GUI: Global boundaries loaded for selection.");

    } catch (err) {
        logSystem(`ERR: Failed to load global boundaries - ${err.message}`);
    }
}

function setupHoverEffects() {
    let hoveredStateId = null;
    let hoveredCountryId = null;

    // Helper for hover enter
    const onEnter = (e, source, idVarName) => {
        if (e.features.length > 0) {
            const id = e.features[0].id;
            // Clear previous
            if (idVarName === 'state' && hoveredStateId !== null) {
                map.setFeatureState({ source: 'admin-boundaries-states', id: hoveredStateId }, { hover: false });
            }
            if (idVarName === 'country' && hoveredCountryId !== null) {
                map.setFeatureState({ source: 'admin-boundaries-countries', id: hoveredCountryId }, { hover: false });
            }

            // Set new
            if (idVarName === 'state') hoveredStateId = id;
            if (idVarName === 'country') hoveredCountryId = id;

            map.setFeatureState({ source: source, id: id }, { hover: true });
            map.getCanvas().style.cursor = 'pointer';
        }
    };

    // Helper for hover leave
    const onLeave = (source, idVarName) => {
        if (idVarName === 'state' && hoveredStateId !== null) {
            map.setFeatureState({ source: 'admin-boundaries-states', id: hoveredStateId }, { hover: false });
            hoveredStateId = null;
        }
        if (idVarName === 'country' && hoveredCountryId !== null) {
            map.setFeatureState({ source: 'admin-boundaries-countries', id: hoveredCountryId }, { hover: false });
            hoveredCountryId = null;
        }
        map.getCanvas().style.cursor = 'crosshair';
    };

    // Add listeners
    map.on('mousemove', 'admin-states-fill', (e) => onEnter(e, 'admin-boundaries-states', 'state'));
    map.on('mouseleave', 'admin-states-fill', () => onLeave('admin-boundaries-states', 'state'));

    map.on('mousemove', 'admin-countries-fill', (e) => onEnter(e, 'admin-boundaries-countries', 'country'));
    map.on('mouseleave', 'admin-countries-fill', () => onLeave('admin-boundaries-countries', 'country'));
}

// Disable selection
function disableRepeaterSelection() {
    if (typeof map === 'undefined' || !map) return;

    map.getCanvas().style.cursor = '';
    if (repeaterSelectionHandler) {
        map.off('click', repeaterSelectionHandler);
        repeaterSelectionHandler = null;
    }

    ['admin-states-line', 'admin-states-fill', 'admin-countries-line', 'admin-countries-fill'].forEach(layer =>
        MapLayerManager.setLayerVisibility(layer, false)
    );

    // Hide skip button
    const skipBtn = getEl('repeater-skip-btn');
    if (skipBtn) skipBtn.style.display = 'none';

    // Hide selection prompt
    const prompt = getEl('repeater-select-prompt');
    if (prompt) prompt.style.display = 'none';

    // Restore back button text and remove resize handler
    const backBtn = getEl('repeater-back-btn');
    if (backBtn) {
        backBtn.textContent = '<< RETURN';
    }
    if (window.repeaterSelectionResizeHandler) {
        window.removeEventListener('resize', window.repeaterSelectionResizeHandler);
        window.repeaterSelectionResizeHandler = null;
    }

    // Clear hover states are tricky to clear without tracking all IDs, but they don't persist visually if layer is hidden

    // Restore UI
    restoreUIFromSelection();

    clearSelectedAreaHighlights();

    // Clear selected areas
    selectedAreas = [];
}

// Load all selected areas
async function loadSelectedAreas() {
    if (selectedAreas.length === 0) return;

    // Store selected areas before clearing
    const areasToLoad = [...selectedAreas];

    logSystem(`NET: Loading ${areasToLoad.length} selected area(s)...`);

    // Exit selection mode immediately (restore UI)
    disableRepeaterSelection();

    // Hide prompt
    const prompt = getEl('repeater-select-prompt');
    if (prompt) prompt.style.display = 'none';

    // Create individual status boxes for each area
    const statusBoxes = areasToLoad.map((area, index) => {
        const statusBox = document.createElement('div');
        const areaId = area.name.replace(/\s+/g, '-').toLowerCase();
        statusBox.id = `repeater-status-${areaId}`;
        statusBox.className = 'repeater-status-box';
        applyStyles(statusBox, {
            display: 'block', position: 'absolute', bottom: `${20 + (index * 50)}px`,
            left: '20px', width: '320px', background: 'rgba(0, 0, 0, 0.95)',
            border: '1px solid var(--color-primary)', padding: '8px', zIndex: '10',
            fontSize: '11px', color: 'var(--color-primary)', boxShadow: '0 0 10px var(--color-primary)'
        });

        const loadingText = document.createElement('span');
        loadingText.id = `repeater-loading-text-${areaId}`;
        updateRepeaterStatus(`FETCHING REPEATERS FOR ${area.name.toUpperCase()}...`, loadingText, loadingText, 'text-dim');

        statusBox.appendChild(loadingText);
        document.body.appendChild(statusBox);
        return { box: statusBox, text: loadingText, area: area.name };
    });

    // Start loading all areas in parallel
    const loadPromises = areasToLoad.map((area, index) => {
        const statusInfo = statusBoxes[index];
        return fetchRepeaters(area.name, area.isUSOrCanada, statusInfo.box, statusInfo.text).catch(err => {
            logSystem(`ERR: Failed to load ${area.name} - ${err.message}`);
            if (statusInfo.text) {
                updateRepeaterStatus(`ERROR LOADING ${area.name.toUpperCase()}`, statusInfo.text, statusInfo.text, 'text-red');
            }
        }).finally(() => {
            removeStatusBoxAfterDelay(statusInfo.box, 3000);
        });
    });

    // Wait for all to complete (but don't block UI)
    Promise.all(loadPromises).then(() => {
        logSystem(`NET: Completed loading ${areasToLoad.length} area(s).`);
    });
}

// Helper functions for fetchRepeaters
function validateRepeaterFetch(stateName, toggle) {
    if (typeof map === 'undefined' || !map) {
        logSystem("ERR: Map not initialized. Please wait...");
        return false;
    }
    if (!toggle || !toggle.checked) {
        MapLayerManager.clearLayerData('repeater-data', 'repeaters');
        disableRepeaterSelection();
        return false;
    }
    if (!stateName) return false;
    return true;
}

function getRepeaterApiUrl(stateName, isUSOrCanada) {
    if (isUSOrCanada) {
        return `https://www.repeaterbook.com/api/export.php?state=${stateName}`;
    }
    return `https://www.repeaterbook.com/api/exportROW.php?country=${stateName}`;
}

async function fetchRepeaters(stateName = null, isUSOrCanada = true, customStatusBox = null, customLoadingText = null) {
    const toggle = getEl('repeaters-toggle');
    if (!validateRepeaterFetch(stateName, toggle)) return;

    const prompt = getEl('repeater-select-prompt');
    if (prompt) prompt.style.display = 'none';
    ['state-boundaries', 'state-boundaries-fill'].forEach(layer => MapLayerManager.setLayerVisibility(layer, false));

    const cacheKey = stateName.toLowerCase().trim();
    const apiUrl = getRepeaterApiUrl(stateName, isUSOrCanada);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`;

    // Check cache (memory and Cache API)
    const cached = await checkRepeaterCache(cacheKey, proxyUrl);
    if (cached) {
        const { repeaters, count, source } = cached;
        logSystem(`NET: Using cached repeater data${source === 'cache-api' ? ' from storage' : ''} for ${stateName} (${repeaters.length}/${count.toLocaleString()} repeaters).`);
        console.log(`✓ ${source === 'cache-api' ? 'Cache API' : 'RAM'} Cache hit for:`, cacheKey);

        if (customStatusBox && customLoadingText) {
            updateRepeaterStatus(`USING CACHED DATA [${repeaters.length.toLocaleString()}]`, customLoadingText, customLoadingText);
            removeStatusBoxAfterDelay(customStatusBox);
        }

        renderAllCachedRepeaters(count, stateName);
        return;
    }

    // Cache miss - proceed to fetch
    console.log('✗ Cache miss for:', cacheKey);
    logSystem(`NET: Accessing RepeaterBook directory for ${stateName}...`);

    const loadingBar = customStatusBox || getEl('status-box');
    const loadingText = customLoadingText || getEl('loading-text');

    if (customStatusBox && customLoadingText) {
        customStatusBox.style.display = 'block';
        updateRepeaterStatus(`FETCHING REPEATERS FOR ${stateName.toUpperCase()}...`, loadingText, customLoadingText, 'text-dim');
    } else if (!isConsoleOpen()) {
        updateLoadingStatus(`FETCHING REPEATERS FOR ${stateName.toUpperCase()}...`, 'text-dim');
    }


    let response;
    let repeaterProxySource = null;
    try {
        // Use PHP proxy chain (PHP first, then third-party fallback)
        response = await fetchWithProxyChain(apiUrl);
        repeaterProxySource = response.proxySource || 'unknown';
        const sourceLabel = repeaterProxySource === 'php' ? 'BACKEND' : `THIRD-PARTY (${repeaterProxySource})`;
        logSystem(`NET: Repeater data (RepeaterBook) via ${sourceLabel}`);

        // Store in Cache API if successful
        if (response.ok && typeof window !== 'undefined' && 'caches' in window) {
            try {
                const cache = await caches.open(REPEATER_CACHE_NAME);
                // Can't cache response from proxy chain directly since it's already consumed
                // Will cache after parsing below
            } catch (e) {
                console.warn('Failed to open Cache API:', e);
            }
        }
        if (!response.ok) {
            const errorText = await response.text();
            console.error('RepeaterBook API Error:', {
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                apiUrl: apiUrl,
                response: errorText
            });
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Read response as text stream to extract count early and parse incrementally
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let totalCount = null;
        let countExtracted = false;
        let resultsArrayStarted = false;
        let parsedRepeaters = [];
        let accumulatedFeatures = [];
        let lastProcessedIndex = 0;

        // Initialize map source if needed
        const source = map.getSource('repeater-data');
        if (!source) {
            // Source doesn't exist, create it (usually done in map setup, but safe to check)
            // Ideally we wait for map.on('load'), but here we assume map is ready
        } else {
            // If starting a new fetch, we might want to keep existing data from other areas
            // or clear it. Since we are merging at the end, we can clear only if we are replacing.
            // But here we are fetching a NEW area.
            // We should NOT clear source here if we want to show multiple areas.
            // However, renderIncrementalRepeaters handles merging.
        }

        // Read chunks and parse incrementally
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Try to extract count from buffer if we haven't found it yet
            if (!countExtracted) {
                // Look for "count": number pattern in the buffer
                const countMatch = buffer.match(/"count"\s*:\s*(\d+)/);
                if (countMatch) {
                    totalCount = parseInt(countMatch[1], 10);
                    countExtracted = true;
                    // Store count early
                    cachedRepeaterCounts[cacheKey] = totalCount;

                    if (loadingBar && loadingText) {
                        updateRepeaterStatus(
                            `RECEIVING REPEATERS FOR ${stateName.toUpperCase()}... [0/${totalCount.toLocaleString()}]`,
                            loadingText, customLoadingText
                        );
                        loadingBar.style.display = 'block';
                        console.log('Early count extracted and status updated:', totalCount);
                    }
                }
            }

            // Try to extract complete repeater objects from the stream
            // Look for the start of results array
            if (!resultsArrayStarted && buffer.includes('"results"')) {
                resultsArrayStarted = true;
            }

            if (resultsArrayStarted) {
                // Try to extract complete JSON objects from the results array
                // We use a robust scanner to find complete objects

                // Find start of results array if we haven't processed past it
                let searchStart = 0;
                if (lastProcessedIndex === 0) {
                    const resultsIndex = buffer.indexOf('"results"');
                    if (resultsIndex !== -1) {
                        const arrayStart = buffer.indexOf('[', resultsIndex);
                        if (arrayStart !== -1) {
                            lastProcessedIndex = arrayStart + 1;
                        }
                    }
                }

                if (lastProcessedIndex > 0) {
                    let depth = 0;
                    let objectStart = -1;
                    let inString = false;
                    let escapeNext = false;

                    // Start scanning from where we left off
                    for (let i = lastProcessedIndex; i < buffer.length; i++) {
                        const char = buffer[i];

                        if (escapeNext) {
                            escapeNext = false;
                            continue;
                        }

                        if (char === '\\') {
                            escapeNext = true;
                            continue;
                        }

                        if (char === '"') {
                            inString = !inString;
                            continue;
                        }

                        if (inString) continue;

                        if (char === '{') {
                            if (depth === 0) {
                                objectStart = i;
                            }
                            depth++;
                        } else if (char === '}') {
                            depth--;
                            if (depth === 0 && objectStart !== -1) {
                                // Found a complete object
                                try {
                                    const objectStr = buffer.substring(objectStart, i + 1);
                                    const repeaterObj = JSON.parse(objectStr);
                                    parsedRepeaters.push(repeaterObj);

                                    // Convert to feature and add to batch
                                    const feature = repeaterToFeature(repeaterObj);
                                    if (feature) {
                                        accumulatedFeatures.push(feature);
                                    }

                                    if (accumulatedFeatures.length >= RENDER_BATCH_SIZE) {
                                        renderIncrementalRepeaters(accumulatedFeatures, totalCount, stateName);
                                        accumulatedFeatures = [];
                                    }

                                    if (loadingBar && loadingText && parsedRepeaters.length % STATUS_UPDATE_INTERVAL === 0) {
                                        const loaded = parsedRepeaters.length;
                                        const total = totalCount || loaded;
                                        updateRepeaterStatus(
                                            `RECEIVING REPEATERS FOR ${stateName.toUpperCase()}... [${loaded.toLocaleString()}/${total.toLocaleString()}]`,
                                            loadingText, customLoadingText, 'text-dim'
                                        );
                                    }
                                } catch (e) {
                                    // Failed to parse, ignore
                                }
                                objectStart = -1;
                                // Update last processed index to after this object
                                lastProcessedIndex = i + 1;
                            }
                        } else if (char === ']' && depth === 0) {
                            // End of results array
                            lastProcessedIndex = i + 1;
                            break;
                        }
                    }
                }
            }
        }

        // Render any remaining accumulated features
        if (accumulatedFeatures.length > 0) {
            renderIncrementalRepeaters(accumulatedFeatures, totalCount, stateName);
        }

        // Parse the complete JSON at the end to ensure we have everything and for caching
        // (Streaming might miss the very last bit if buffer logic isn't perfect, or just for safety)
        let finalRepeaters = [];
        try {
            const data = JSON.parse(buffer);
            finalRepeaters = Array.isArray(data) ? data : (data.results || []);

            // Use count from final data if we missed it
            if (!totalCount && data && typeof data === 'object' && !Array.isArray(data)) {
                totalCount = data.count || data.total || data.totalCount || data.total_count;
                if (totalCount) cachedRepeaterCounts[cacheKey] = totalCount;
            }
        } catch (e) {
            // If JSON parse fails (maybe incomplete?), fallback to our manually parsed list
            console.warn("Could not parse full JSON response, using streamed data", e);
            finalRepeaters = parsedRepeaters;
        }

        // Cache the complete data - ensure cache key matches check format
        cachedRepeaters[cacheKey] = finalRepeaters;
        console.log('✓ Cached data for key:', cacheKey, 'with', finalRepeaters.length, 'repeaters');

        if (loadingBar && loadingText) {
            updateRepeaterStatus(`REPEATER DATA LOADED [${finalRepeaters.length.toLocaleString()}]`, loadingText, customLoadingText);
            if (!customStatusBox) {
                setTimeout(() => { if (loadingBar) loadingBar.style.display = 'none'; }, STATUS_BOX_REMOVE_DELAY);
            }
        }

        // Re-render everything one last time to ensure consistency with cache (and handle duplicates properly)
        // Or just rely on incremental? 
        // Let's rely on renderAllCachedRepeaters to ensure the final state is perfect
        renderAllCachedRepeaters(totalCount, stateName);

    } catch (err) {
        logSystem(`ERR: Failed to fetch repeaters - ${err.message}`);
        console.error('Repeater fetch error:', {
            error: err.message,
            stack: err.stack,
            name: err.name,
            stateName: stateName
        });
        if (loadingBar) loadingBar.style.display = 'none';
    }
}

// Helper to convert raw repeater object to GeoJSON feature
function repeaterToFeature(r) {
    const lon = parseFloat(r.Long);
    const lat = parseFloat(r.Lat);
    if (isNaN(lon) || isNaN(lat)) return null;

    return {
        type: "Feature",
        geometry: {
            type: "Point",
            coordinates: [lon, lat]
        },
        properties: {
            callsign: r.Callsign || 'UNKNOWN',
            frequency: r.Frequency || '',
            offset: r.Offset || '',
            uplink: r.Uplink || r['Input Freq'] || '',
            downlink: r.Downlink || r['Output Freq'] || '',
            pl: r.PL || r.Tone || '',
            location: r.Location || r['Nearest City'] || '',
            state: r.State || '',
            usage: r.Usage || r.Use || '',
            notes: r.Notes || r.Notes || '',
            band: r.Band || '',
            mode: r.Mode || '',
            coverage: r.Coverage || '',
            trustee: r.Trustee || '',
            operationalStatus: r['Operational Status'] || r.Status || '',
            id: `repeater-${r.Callsign || 'unknown'}-${r.Frequency || ''}-${Math.random()}`
        }
    };
}

// Render incremental batch of repeaters
function renderIncrementalRepeaters(newFeatures, totalCount, stateName) {
    const toggle = getEl('repeaters-toggle');
    if (!toggle || !toggle.checked) return;

    const source = map.getSource('repeater-data');
    if (!source) return;

    // Get existing features from the source
    const existingData = source._data || { type: "FeatureCollection", features: [] };
    const existingFeatures = existingData.features || [];

    // Combine
    const allFeatures = [...existingFeatures, ...newFeatures];

    source.setData({
        type: "FeatureCollection",
        features: allFeatures
    });

    MapLayerManager.setLayerVisibility('repeaters', true);
    logSystem(`NET: Loaded +${newFeatures.length} repeaters...`);
}

// Render all cached repeater data from all areas
function renderAllCachedRepeaters(totalCount = null, stateName = null) {
    const repeatersToggle = getEl('repeaters-toggle');

    // Repeaters toggle must be enabled
    if (!repeatersToggle || !repeatersToggle.checked) {
        console.log('renderAllCachedRepeaters: Repeaters toggle is not checked');
        return;
    }

    // Ensure map and source exist
    if (typeof map === 'undefined' || !map) {
        logSystem("ERR: Map not initialized. Cannot render cached repeaters.");
        return;
    }

    // Get or create the source
    let source = map.getSource('repeater-data');
    if (!source) {
        map.addSource('repeater-data', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        source = map.getSource('repeater-data');
    }

    // Merge all cached repeater data from all areas
    // Use the local cachedRepeaters variable directly (not window property)
    const allRepeaters = [];
    const cachedAreas = [];

    console.log('renderAllCachedRepeaters: Checking cache. cachedRepeaters keys:', Object.keys(cachedRepeaters));
    console.log('renderAllCachedRepeaters: cachedRepeaterCounts:', cachedRepeaterCounts);

    // Calculate total count from all cached areas
    let combinedTotalCount = totalCount;
    if (!combinedTotalCount) {
        combinedTotalCount = Object.values(cachedRepeaterCounts).reduce((sum, count) => sum + (count || 0), 0);
    }

    for (const [areaName, areaRepeaters] of Object.entries(cachedRepeaters)) {
        if (areaRepeaters && Array.isArray(areaRepeaters) && areaRepeaters.length > 0) {
            allRepeaters.push(...areaRepeaters);
            cachedAreas.push(areaName);
        }
    }

    console.log('renderAllCachedRepeaters: Found', cachedAreas.length, 'cached areas with', allRepeaters.length, 'total repeaters');

    if (allRepeaters.length === 0) {
        logSystem("NET: No cached repeater data available.");
        hideStatus();
        MapLayerManager.setLayerVisibility('repeaters', false);
        return;
    }

    const areasList = cachedAreas.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ');
    const countDisplay = combinedTotalCount ? `${allRepeaters.length.toLocaleString()}/${combinedTotalCount.toLocaleString()}` : `${allRepeaters.length.toLocaleString()}`;
    logSystem(`NET: Rendering ${countDisplay} repeaters from ${cachedAreas.length} area(s): ${areasList}`);

    MapLayerManager.setLayerVisibility('repeaters', true);

    // Render merged data with combined total count
    renderRepeaters(allRepeaters, combinedTotalCount, stateName);
}

// Progressive Rendering Function
function renderRepeaters(repeaters, totalCount = null, stateName = null, customStatusBox = null, customLoadingText = null) {
    const toggle = getEl('repeaters-toggle');
    if (!toggle || !toggle.checked) return;

    // Process in chunks to avoid blocking UI
    let index = 0;
    const allFeatures = [];
    const loadingBar = customStatusBox || getEl('status-box');
    const loadingText = customLoadingText || getEl('loading-text');

    function processChunk() {
        const chunk = repeaters.slice(index, index + CHUNK_SIZE);
        const chunkFeatures = chunk.map(r => repeaterToFeature(r)).filter(f => f !== null);
        allFeatures.push(...chunkFeatures);
        index += CHUNK_SIZE;

        // Update loading status with progress
        if (loadingBar && loadingText && !isConsoleOpen()) {
            const stateDisplay = stateName ? `${stateName.toUpperCase()}: ` : '';
            // Calculate total count from all cached areas if available
            let displayTotal = totalCount;
            if (!displayTotal) {
                // Sum up counts from all cached areas
                displayTotal = Object.values(cachedRepeaterCounts).reduce((sum, count) => sum + (count || 0), 0);
            }
            // If we still don't have a total, use the repeaters array length
            if (!displayTotal || displayTotal === 0) {
                displayTotal = repeaters.length;
            }

            updateRepeaterStatus(
                `${stateDisplay}RENDERING REPEATERS... [${allFeatures.length.toLocaleString()}/${displayTotal.toLocaleString()}]`,
                loadingText, customLoadingText
            );
        }

        // Update map with current set of features
        // Note: allFeatures already contains merged data from all cached areas
        const source = map.getSource('repeater-data');
        if (source) {
            source.setData({
                type: "FeatureCollection",
                features: allFeatures
            });
            MapLayerManager.setLayerVisibility('repeaters', true);
        }

        if (index < repeaters.length) {
            // Schedule next chunk
            requestAnimationFrame(processChunk);
        } else {
            logSystem(`GUI: Repeater map updated (${allFeatures.length} nodes).`);
            // Hide loading bar when complete (only for default status box, not custom ones)
            if (loadingBar && !customStatusBox) loadingBar.style.display = 'none';
        }
    }

    // Start processing
    processChunk();
}

// Show popup logic
function showRepeaterPopup(p, coordinates) {
    // Format frequency with offset
    let freqDisplay = p.frequency || 'UNKNOWN';
    if (p.offset) {
        freqDisplay += ` (${p.offset})`;
    }

    // Format location
    let locDisplay = '';
    if (p.location && p.location.trim()) {
        locDisplay = p.location;
    }
    if (p.state && p.state.trim()) {
        locDisplay += locDisplay ? `, ${p.state}` : p.state;
    }
    if (!locDisplay) locDisplay = 'UNKNOWN';

    // Build description with all available fields
    const description = `
        <div class="popup-row"><span class="popup-label">REPEATER:</span> ${p.callsign}</div>
        <div class="popup-row"><span class="popup-label">FREQ:</span> ${freqDisplay}</div>
        ${p.uplink ? `<div class="popup-row"><span class="popup-label">UPLINK:</span> ${p.uplink}</div>` : ''}
        ${p.downlink ? `<div class="popup-row"><span class="popup-label">DOWNLINK:</span> ${p.downlink}</div>` : ''}
        <div class="popup-row"><span class="popup-label">TONE:</span> ${p.pl || 'NONE'}</div>
        ${p.band ? `<div class="popup-row"><span class="popup-label">BAND:</span> ${p.band}</div>` : ''}
        ${p.mode ? `<div class="popup-row"><span class="popup-label">MODE:</span> ${p.mode}</div>` : ''}
        <div class="popup-row"><span class="popup-label">LOC:</span> ${locDisplay}</div>
        <div class="popup-row"><span class="popup-label">USAGE:</span> ${p.usage || 'OPEN'}</div>
        ${p.trustee ? `<div class="popup-row"><span class="popup-label">TRUSTEE:</span> ${p.trustee}</div>` : ''}
        ${p.operationalStatus ? `<div class="popup-row"><span class="popup-label">STATUS:</span> ${p.operationalStatus}</div>` : ''}
        ${p.coverage ? `<div class="popup-row"><span class="popup-label">COVERAGE:</span> ${p.coverage}</div>` : ''}
        ${p.notes ? `<div class="popup-row"><span class="popup-label">NOTES:</span> <span style="font-size:10px">${p.notes}</span></div>` : ''}
    `;

    if (typeof maplibregl !== 'undefined') {
        currentPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'cyber-popup' })
            .setLngLat(coordinates).setHTML(description).addTo(map);
        currentPopupFeature = p;
        currentPopupLayer = 'repeaters';

        currentPopup.on('close', () => {
            currentPopup = null;
            currentPopupFeature = null;
            currentPopupLayer = null;
        });
    }
}

// Function to get cached repeater data (direct access, not through getter)
window.getCachedRepeaters = () => cachedRepeaters;
window.getCachedRepeaterCounts = () => cachedRepeaterCounts;

// Export functions
window.fetchRepeaters = fetchRepeaters;
window.showRepeaterPopup = showRepeaterPopup;
window.enableRepeaterSelection = enableRepeaterSelection;
window.disableRepeaterSelection = disableRepeaterSelection;
window.renderAllCachedRepeaters = renderAllCachedRepeaters;
window.loadGlobalBoundaries = loadGlobalBoundaries;
window.loadSelectedAreas = loadSelectedAreas;

// Setup button handlers for selection mode
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Back button - exits selection mode and disables repeaters
    const backBtn = getEl('repeater-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // Disable repeaters toggle
            const repeatersToggle = getEl('repeaters-toggle');
            if (repeatersToggle) {
                repeatersToggle.checked = false;
                // Trigger change event to run the toggle handler
                repeatersToggle.dispatchEvent(new Event('change'));
            }

            // Exit selection mode
            disableRepeaterSelection();

            // Clear selected areas
            selectedAreas = [];
            updateSelectedAreasDisplay();

            // Hide prompt
            const prompt = getEl('repeater-select-prompt');
            if (prompt) prompt.style.display = 'none';
        });
    }

    // Load button - loads all selected areas and exits selection mode
    const loadBtn = getEl('repeater-load-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            if (selectedAreas.length > 0) {
                loadSelectedAreas();
            }
        });
    }
}

