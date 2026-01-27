// --- Radio Station Data Logic (Radio Browser API) ---

// Note: radioInterval is declared in globals.js to avoid duplicate declaration
let radioAudio = null; // HTML5 Audio element for playback
let currentStation = null; // Currently playing station

// Radio Browser API servers (fallback list)
const RADIO_BROWSER_SERVERS = [
    'https://de1.api.radio-browser.info',
    'https://de2.api.radio-browser.info',
    'https://at1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info'
];

// isConsoleOpen() is now in utils.js - shared across all modules


async function fetchRadioStations() {
    // Validate toggle and clear if off
    if (!validateToggle('radio-toggle', () => {
        MapLayerManager.clearLayerData('radio-data', 'radio-stations');
    })) {
        return;
    }

    try {
        if (typeof map === 'undefined' || !map) {
            logSystem("ERR: Map not initialized. Please wait...");
            return;
        }

        logSystem("NET: Scanning radio spectrum...");
        updateLoadingStatus('SCANNING RADIO SPECTRUM...', 'text-dim');

        // Try PHP proxy first, then fall back to direct API servers
        let serverUsed = null;
        let usedPhpProxy = false;
        let lastError = null;

        // Attempt 1: PHP Proxy
        try {
            const testUrl = `${RADIO_BROWSER_SERVERS[0]}/json/stations/search?limit=1&has_geo_info=true`;
            const testResponse = await fetchData(testUrl, { useProxy: true });

            if (testResponse.ok && testResponse.proxySource === 'php') {
                serverUsed = RADIO_BROWSER_SERVERS[0];
                usedPhpProxy = true;
                logSystem("NET: Radio data (RadioBrowser) via BACKEND");
            }
        } catch (err) {
            lastError = err;
        }

        // Attempt 2: Direct API servers (fallback)
        if (!serverUsed) {
            for (const server of RADIO_BROWSER_SERVERS) {
                try {
                    const testUrl = `${server}/json/stations/search?limit=1&has_geo_info=true`;
                    const testResponse = await fetchData(testUrl, {
                        headers: {
                            'User-Agent': 'GEO-OSINT/1.0'
                        }
                    });

                    if (testResponse.ok) {
                        serverUsed = server;
                        const shortServer = new URL(server).hostname.split('.')[0];
                        logSystem(`NET: Radio data (RadioBrowser) via DIRECT (${shortServer})`);
                        break;
                    }
                } catch (err) {
                    lastError = err;
                }
            }
        }

        if (!serverUsed) {
            throw lastError || new Error('All Radio Browser API servers failed');
        }

        // Fetch all stations using pagination
        const allStations = [];
        const limit = 200; // Smaller batches for more granular status updates
        let offset = 0;
        let hasMore = true;
        let pageNumber = 1;

        // UI: Loading Start (only if console is not open)
        updateLoadingStatus('LOADING RADIO STATIONS...', 'text-dim');

        logSystem("NET: Fetching all radio stations (this may take a moment)...");

        while (hasMore) {

            // Update loading status (only if console is not open)
            if (!isConsoleOpen()) {
                const txt = loadingTextEl();
                if (txt) txt.innerText = `LOADING RADIO STATIONS... [${allStations.length.toLocaleString()} LOADED]`;
            }

            let retryCount = 0;
            const maxRetries = 3;
            let pageStations = null;

            while (retryCount < maxRetries && !pageStations) {
                try {
                    const url = `${serverUsed}/json/stations/search?limit=${limit}&offset=${offset}&has_geo_info=true&order=votes&reverse=true`;

                    // Add timeout to prevent hanging
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

                    // Use proxy if PHP proxy worked for initial request
                    const fetchOptions = usedPhpProxy
                        ? { useProxy: true, signal: controller.signal }
                        : { headers: { 'User-Agent': 'GEO-OSINT/1.0' }, signal: controller.signal };

                    const response = await fetchData(url, fetchOptions);

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Radio Browser API Error:', {
                            status: response.status,
                            statusText: response.statusText,
                            url: response.url,
                            server: serverUsed,
                            offset: offset,
                            response: errorText
                        });
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    // Try to parse JSON, even if response might be incomplete
                    let jsonText = '';
                    try {
                        jsonText = await response.text();
                        pageStations = JSON.parse(jsonText);
                    } catch (parseErr) {
                        // If JSON parsing fails, try to extract partial data
                        if (jsonText.length > 0) {
                            // Try to find complete JSON objects in the partial response
                            const jsonMatches = jsonText.match(/\[[\s\S]*\]/);
                            if (jsonMatches) {
                                try {
                                    pageStations = JSON.parse(jsonMatches[0]);
                                    logSystem(`WARN: Received incomplete response, using partial data`);
                                } catch (e) {
                                    throw new Error(`Failed to parse response: ${parseErr.message}`);
                                }
                            } else {
                                throw new Error(`Failed to parse response: ${parseErr.message}`);
                            }
                        } else {
                            throw parseErr;
                        }
                    }

                    if (!pageStations || pageStations.length === 0) {
                        hasMore = false;
                        break;
                    } else {
                        allStations.push(...pageStations);
                        logSystem(`NET: Loaded ${allStations.length} stations so far...`);

                        // Update loading status with current count (only if console is not open)
                        if (!isConsoleOpen()) {
                            const txt = loadingTextEl();
                            if (txt) txt.innerText = `LOADING RADIO STATIONS... [${allStations.length.toLocaleString()} LOADED]`;
                        }

                        // If we got fewer than the limit, we've reached the end
                        if (pageStations.length < limit) {
                            hasMore = false;
                        } else {
                            offset += limit;
                            pageNumber++;
                            // Small delay to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                        break; // Success, exit retry loop
                    }
                } catch (err) {
                    retryCount++;

                    console.error('Radio Browser fetch error:', {
                        error: err.message,
                        stack: err.stack,
                        server: serverUsed,
                        offset: offset,
                        retryCount: retryCount
                    });

                    if (retryCount < maxRetries) {
                        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
                        logSystem(`WARN: Error fetching page at offset ${offset} (attempt ${retryCount}/${maxRetries}): ${err.message}. Retrying in ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        logSystem(`WARN: Failed to fetch page at offset ${offset} after ${maxRetries} attempts: ${err.message}`);
                        // Try next server if available
                        let serverSwitched = false;
                        if (serverUsed !== RADIO_BROWSER_SERVERS[RADIO_BROWSER_SERVERS.length - 1]) {
                            const currentIndex = RADIO_BROWSER_SERVERS.indexOf(serverUsed);
                            if (currentIndex < RADIO_BROWSER_SERVERS.length - 1) {
                                serverUsed = RADIO_BROWSER_SERVERS[currentIndex + 1];
                                logSystem(`NET: Switching to fallback server: ${serverUsed}`);
                                retryCount = 0; // Reset retry count for new server
                                serverSwitched = true;
                            }
                        }
                        if (!serverSwitched) {
                            hasMore = false; // Stop on error after all retries and server switches
                        }
                        // If server was switched, retryCount is reset and loop will continue
                    }
                }
            }

            // If we failed to get data after all retries and server switches, stop
            if (!pageStations && retryCount >= maxRetries) {
                hasMore = false;
            }
        }

        hideStatus();

        // Check if toggle was turned off during fetch
        if (!radioToggle || !radioToggle.checked) {
            MapLayerManager.clearLayerData('radio-data', 'radio-stations');
            return;
        }

        const stations = allStations;

        if (!stations || stations.length === 0) {
            logSystem("WARN: No radio stations found.");
            MapLayerManager.clearLayerData('radio-data');
            return;
        }

        logSystem(`NET: Received ${stations.length} radio stations.`);

        // Filter stations with valid coordinates
        const validStations = stations.filter(station =>
            station.geo_lat &&
            station.geo_long &&
            !isNaN(parseFloat(station.geo_lat)) &&
            !isNaN(parseFloat(station.geo_long)) &&
            station.url &&
            station.url.trim() !== ''
        );

        logSystem(`NET: ${validStations.length} stations with valid geolocation.`);

        // Convert to GeoJSON features
        const features = validStations.map(station => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [parseFloat(station.geo_long), parseFloat(station.geo_lat)]
            },
            properties: {
                id: station.stationuuid || station.changeuuid || `radio-${Math.random()}`,
                name: station.name || 'UNKNOWN STATION',
                url: station.url,
                url_resolved: station.url_resolved || station.url,
                homepage: station.homepage || '',
                favicon: station.favicon || '',
                tags: station.tags || '',
                country: station.country || 'UNKNOWN',
                countrycode: station.countrycode || 'XX',
                state: station.state || '',
                language: station.language || '',
                codec: station.codec || 'UNKNOWN',
                bitrate: station.bitrate || 0,
                votes: station.votes || 0,
                clickcount: station.clickcount || 0,
                lastchangetime: station.lastchangetime || '',
                clicktimestamp: station.clicktimestamp || ''
            }
        }));

        // Final check before setting data - ensure toggle is still on
        if (!radioToggle || !radioToggle.checked) {
            MapLayerManager.clearLayerData('radio-data', 'radio-stations');
            hideStatus();
            return;
        }

        // Update map source
        const geoJsonData = {
            type: "FeatureCollection",
            features: features
        };
        if (MapLayerManager.updateLayerData('radio-data', geoJsonData)) {
            logSystem(`GUI: Radio spectrum updated (${features.length} stations).`);
            hideStatus();
        } else {
            logSystem("ERR: Radio data source not found.");
            hideStatus();
        }

    } catch (err) {
        logSystem(`ERR: Failed to fetch radio stations - ${err.message}`);
        logSystem("WARN: All Radio Browser API servers unavailable. Please try again later.");
        console.error('Radio fetch error:', {
            error: err.message,
            stack: err.stack,
            name: err.name
        });
        hideStatus();
    }
}

// Play a radio station
function playRadioStation(station) {
    try {
        // Stop current station if playing (ensures only one plays at once)
        stopRadioStation();

        if (!station || (!station.url_resolved && !station.streamUrl)) {
            logSystem("ERR: Invalid station data.");
            return;
        }

        // Use url_resolved or streamUrl
        const streamUrl = station.url_resolved || station.streamUrl;
        currentStation = {
            ...station,
            url_resolved: streamUrl
        };

        // Create audio element
        radioAudio = new Audio();
        radioAudio.src = streamUrl;
        radioAudio.crossOrigin = 'anonymous';

        radioAudio.addEventListener('loadstart', () => {
            logSystem(`RADIO: Connecting to ${station.name}...`);
            updatePopupPlayerButton('loading');
        });

        radioAudio.addEventListener('canplay', () => {
            logSystem(`RADIO: ▶ ${station.name} [${station.codec || 'UNKNOWN'}]`);
            updatePopupPlayerButton('playing');
            updateNowPlayingBar();
        });

        radioAudio.addEventListener('play', () => {
            updatePopupPlayerButton('playing');
            updateNowPlayingBar();
        });

        radioAudio.addEventListener('pause', () => {
            updatePopupPlayerButton('paused');
            updateNowPlayingBar();
        });

        radioAudio.addEventListener('error', (e) => {
            logSystem(`ERR: Failed to play ${station.name} - ${e.message || 'Stream error'}`);
            console.error('Audio error:', e);
            currentStation = null;
            radioAudio = null;
            updatePopupPlayerButton('stopped');
        });

        radioAudio.addEventListener('ended', () => {
            logSystem(`RADIO: Stream ended for ${station.name}`);
            currentStation = null;
            radioAudio = null;
            updatePopupPlayerButton('stopped');
        });

        // Start playback
        radioAudio.play().catch(err => {
            logSystem(`ERR: Playback failed - ${err.message}`);
            console.error('Play error:', err);
            currentStation = null;
            radioAudio = null;
            updatePopupPlayerButton('stopped');
        });

        // Update player controls
        if (window.updateRadioPlayerControls) {
            window.updateRadioPlayerControls();
        }

        // Update now playing bar
        updateNowPlayingBar();

    } catch (err) {
        logSystem(`ERR: Failed to initialize radio playback - ${err.message}`);
        console.error('Radio play error:', err);
        currentStation = null;
        radioAudio = null;
        updatePopupPlayerButton('stopped');
    }
}

// Pause current radio station
function pauseRadioStation() {
    if (radioAudio && !radioAudio.paused) {
        radioAudio.pause();
        updatePopupPlayerButton('paused');
        updateNowPlayingBar();
    }
}

// Resume current radio station
function resumeRadioStation() {
    if (radioAudio && radioAudio.paused) {
        radioAudio.play().catch(err => {
            logSystem(`ERR: Resume failed - ${err.message}`);
            console.error('Resume error:', err);
        });
        updatePopupPlayerButton('playing');
        updateNowPlayingBar();
    }
}

// Toggle play/pause
function toggleRadioPlayPause() {
    if (!radioAudio) {
        // If no audio, try to play current station from popup
        if (currentPopupFeature && currentPopupFeature.url_resolved) {
            playRadioStation(currentPopupFeature);
        }
        return;
    }

    // Update button immediately before state change
    if (radioAudio.paused) {
        updatePopupPlayerButton('loading');
        resumeRadioStation();
    } else {
        pauseRadioStation();
    }
}

// Update popup player button state
function updatePopupPlayerButton(state) {
    // Try multiple ways to find the popup element
    let popupElement = window.currentRadioPopupElement;

    // If not found, try to find it from currentPopup
    if (!popupElement && typeof currentPopup !== 'undefined' && currentPopup) {
        try {
            popupElement = currentPopup.getElement();
            if (popupElement) {
                window.currentRadioPopupElement = popupElement;
            }
        } catch (e) {
            console.error('Error getting popup element:', e);
        }
    }

    if (!popupElement) {
        // Try finding by class as fallback
        popupElement = document.querySelector('.maplibregl-popup-content');
    }

    if (!popupElement) return;

    const playBtn = popupElement.querySelector('.radio-play-btn');
    if (!playBtn) {
        console.log('Button not found in popup element');
        return;
    }

    switch (state) {
        case 'playing':
            playBtn.innerHTML = 'PAUSE';
            playBtn.classList.remove('loading');
            playBtn.classList.add('playing');
            break;
        case 'paused':
            playBtn.innerHTML = 'PLAY';
            playBtn.classList.remove('playing', 'loading');
            break;
        case 'loading':
            playBtn.innerHTML = 'LOADING...';
            playBtn.classList.add('loading');
            break;
        case 'stopped':
        default:
            playBtn.innerHTML = 'PLAY';
            playBtn.classList.remove('playing', 'loading');
            break;
    }
}

// Stop current radio station
function stopRadioStation() {
    if (radioAudio) {
        try {
            radioAudio.pause();
            radioAudio.src = '';
            radioAudio = null;
        } catch (err) {
            console.error('Error stopping radio:', err);
        }
    }

    if (currentStation) {
        logSystem(`RADIO: Stopped ${currentStation.name}`);
        currentStation = null;
    }

    // Update popup button
    updatePopupPlayerButton('stopped');

    // Clear popup reference if station was stopped
    window.currentRadioPopupElement = null;

    // Update player controls
    if (window.updateRadioPlayerControls) {
        window.updateRadioPlayerControls();
    }

    // Hide now playing bar
    hideNowPlayingBar();
}

// Update now playing bar
function updateNowPlayingBar() {
    const bar = document.getElementById('radio-now-playing-bar');
    const textElement = document.getElementById('radio-now-playing-text');
    const pauseBtn = document.getElementById('radio-now-playing-pause');

    if (!bar || !textElement) return;

    if (currentStation && radioAudio && !radioAudio.paused) {
        // Show bar and update text
        bar.classList.remove('radio-now-playing-bar-hidden');
        if (window.updateBottomStack) window.updateBottomStack();
        const stationInfo = `${currentStation.name} [${currentStation.codec || 'UNKNOWN'}] ${currentStation.bitrate ? currentStation.bitrate + 'kbps' : ''}`.trim();
        textElement.textContent = stationInfo;

        // Check if text needs scrolling
        setTimeout(() => {
            const wrapper = textElement.parentElement;
            // Force reflow to get accurate measurements
            textElement.style.display = 'inline-block';
            const textWidth = textElement.offsetWidth;
            const wrapperWidth = wrapper.offsetWidth;
            textElement.style.display = '';

            if (textWidth > wrapperWidth) {
                textElement.classList.remove('no-scroll');
                // Calculate animation duration based on text length (scrolls at ~40px per second)
                // Text moves from 100% (right edge) to -100% (left edge), so total distance is wrapperWidth + textWidth
                const totalDistance = wrapperWidth + textWidth + 50; // Add padding
                const duration = Math.max(10, totalDistance / 40);
                textElement.style.animationDuration = duration + 's';
            } else {
                textElement.classList.add('no-scroll');
            }
        }, 100);

        // Update pause button text
        if (pauseBtn) {
            pauseBtn.textContent = 'PAUSE';
        }
    } else if (currentStation && radioAudio && radioAudio.paused) {
        // Show bar but paused
        bar.classList.remove('radio-now-playing-bar-hidden');
        const stationInfo = `${currentStation.name} [${currentStation.codec || 'UNKNOWN'}] ${currentStation.bitrate ? currentStation.bitrate + 'kbps' : ''}`.trim();
        textElement.textContent = stationInfo + ' [PAUSED]';
        textElement.classList.add('no-scroll');

        // Update pause button text
        if (pauseBtn) {
            pauseBtn.textContent = 'RESUME';
        }
    } else {
        hideNowPlayingBar();
    }
}

// Hide now playing bar
function hideNowPlayingBar() {
    const bar = document.getElementById('radio-now-playing-bar');
    if (bar) {
        bar.classList.add('radio-now-playing-bar-hidden');
    }
    if (window.updateBottomStack) window.updateBottomStack();
}

// Get currently playing station
function getCurrentStation() {
    return currentStation;
}

// Check if radio is currently playing
function isRadioPlaying() {
    return radioAudio && !radioAudio.paused && radioAudio.readyState > 2;
}

// Export functions for global access
window.playRadioStation = playRadioStation;
window.stopRadioStation = stopRadioStation;
window.pauseRadioStation = pauseRadioStation;
window.resumeRadioStation = resumeRadioStation;
window.toggleRadioPlayPause = toggleRadioPlayPause;
window.getCurrentStation = getCurrentStation;
window.isRadioPlaying = isRadioPlaying;
window.fetchRadioStations = fetchRadioStations;
window.updatePopupPlayerButton = updatePopupPlayerButton;
window.updateNowPlayingBar = updateNowPlayingBar;
window.hideNowPlayingBar = hideNowPlayingBar;
// Export radioAudio for external access if needed
Object.defineProperty(window, 'radioAudio', {
    get: () => radioAudio,
    enumerable: false,
    configurable: true
});

// Register with InscriptionRegistry
if (window.InscriptionRegistry) {
    window.InscriptionRegistry.register('radio-stations', {
        hydrate: (data) => {
            if (typeof map === 'undefined' || !map) return null;
            const features = map.querySourceFeatures('radio-data');
            if (data.id) {
                return features.find(f => f.properties.id == data.id)?.properties;
            }
            if (data.name) {
                return features.find(f => f.properties.name == data.name)?.properties;
            }
            return null;
        },
        getMarker: (data) => {
            return {
                html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#00ff00" d="M12,10A2,2 0 0,1 14,12C14,10.89 13.1,10 12,10M12,16A2,2 0 0,1 10,14C10,15.1 10.9,16 12,16M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2Z"/></svg>`,
                style: { width: '24px', height: '24px' }
            };
        },
        showPopup: (data, coords) => {
            const html = `
                <div class="popup-row"><span class="popup-label">STATION:</span> ${data.name || 'Unknown'}</div>
                <div class="popup-row"><span class="popup-label">COUNTRY:</span> ${data.country || 'N/A'}</div>
                <div class="popup-row"><span class="popup-label">TAGS:</span> ${data.tags || 'N/A'}</div>
                <div style="margin-top:10px; text-align:center;">
                    <button class="intel-btn radio-play-btn" onclick='window.playRadioStation(window.currentPopupFeature)'>PLAY</button>
                </div>
            `;
            if (window.createPopup) {
                window.createPopup(coords, html, data, 'radio-popup', { className: 'cyber-popup' });
            }
        }
    });
}
