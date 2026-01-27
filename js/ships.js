// --- Ship Data Logic (Global Fishing Watch) ---

if (window.dataWorker) {
    window.dataWorker.addEventListener('message', function (e) {
        const { type, result } = e.data;
        if (type === 'SHIPS_PROCESSED') {
            const { features, counts } = result;

            logSystem(`<span class="log-dim">SCAN COMPLETE: ${features.length} Total Targets</span>`);
            logSystem(`<span class="log-dim">>> GAPS: ${counts.gap} | ENCOUNTERS: ${counts.encounter} | LOITER: ${counts.loitering} | FISH: ${counts.fishing} | PORT: ${counts.port}</span>`);

            // Final check before setting data - ensure toggle is still on
            if (!shipToggle || !shipToggle.checked) {
                MapLayerManager.clearLayerData('gfw-data');
                hideStatus();
                return;
            }

            const geoJsonData = {
                type: "FeatureCollection",
                features: features
            };
            if (MapLayerManager.updateLayerData('gfw-data', geoJsonData)) {
                updateShipFilters(); // Apply current toggles
                logSystem("GUI: Marine radar updated.");
            }
            hideStatus();
        }
    });
}

async function fetchShips() {
    // Validate toggle and clear if off
    if (!validateToggle('ship-toggle', () => MapLayerManager.clearLayerData('gfw-data'))) {
        return;
    }

    try {
        // Calculate date range for the last 10 days to ensure data
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 10);

        const startStr = startDate.toISOString();
        const endStr = endDate.toISOString();

        // 1. Identify Active Datasets
        const shipDatasetMap = [
            { toggle: shipFishingToggle, dataset: 'public-global-fishing-events:latest' },
            { toggle: shipPortToggle, dataset: 'public-global-port-visits-events:latest' },
            { toggle: shipEncounterToggle, dataset: 'public-global-encounters-events:latest' },
            { toggle: shipLoiteringToggle, dataset: 'public-global-loitering-events:latest' },
            { toggle: shipGapToggle, dataset: 'public-global-gaps-events:latest' }
        ];
        const activeDatasets = shipDatasetMap
            .filter(({ toggle }) => toggle?.checked)
            .map(({ dataset }) => dataset);

        if (activeDatasets.length === 0) {
            logSystem("WARN: No ship types selected.");
            MapLayerManager.clearLayerData('gfw-data');
            return;
        }

        // Only log initialization if we are specifically looking for dark vessels (gaps)
        if (shipGapToggle.checked) {
            logSystem("Initializing dark vessel tracking protocols...");
        }

        updateLoadingStatus('CONTACTING SATELLITE UPLINK...', 'text-dim');

        // 2. Calculate Quota Per Dataset
        // Split the total limit among the active types to ensure fair representation.
        const safeLimit = entityLimit; // User controlled via slider 
        const limitPerType = Math.max(500, Math.floor(safeLimit / activeDatasets.length));

        logSystem(`NET: Fetching ${activeDatasets.length} feeds (Quota: ${limitPerType} ea)...`);

        let completedFeeds = 0;
        let shipProxySource = null; // Track proxy source for logging

        // 3. Parallel Fetching
        const fetchPromises = activeDatasets.map(async (dataset) => {
            const params = new URLSearchParams();
            params.append('start-date', startStr);
            params.append('end-date', endStr);
            params.append('limit', limitPerType.toString());
            params.append('offset', '0');
            params.append('datasets[0]', dataset); // Query single dataset per request

            // Update UI: Fetching specific
            const shortName = dataset.split('-')[2].toUpperCase();

            const url = `https://gateway.api.globalfishingwatch.org/v3/events?${params.toString()}`;

            try {
                // Use proxy chain with auth token passed via URL parameter
                const proxyUrl = `${PHP_PROXY}${encodeURIComponent(url)}&auth=${encodeURIComponent(gfwToken)}`;
                const response = await fetch(proxyUrl);

                // Track proxy source (PHP if successful)
                if (response.ok && !shipProxySource) {
                    shipProxySource = 'php';
                }

                if (!response.ok) {
                    // Fallback to direct fetch (GFW has CORS support)
                    const directResponse = await fetchData(url, {
                        headers: {
                            'Authorization': `Bearer ${gfwToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (!shipProxySource) shipProxySource = 'direct';
                    if (!directResponse.ok) {
                        const txt = await directResponse.text();
                        console.error(`GFW API Error for ${dataset}:`, {
                            status: directResponse.status,
                            statusText: directResponse.statusText,
                            url: directResponse.url,
                            response: txt,
                            dataset: dataset
                        });
                        return { entries: [] };
                    }
                    const json = await directResponse.json();
                    completedFeeds++;
                    if (!isConsoleOpen()) {
                        const txt = loadingTextEl();
                        if (txt) txt.innerText = `SYNCING ${shortName} [${completedFeeds}/${activeDatasets.length}]`;
                    }
                    return json;
                }

                const json = await response.json();

                // Update UI: Complete (only if console is not open)
                completedFeeds++;
                if (!isConsoleOpen()) {
                    const txt = loadingTextEl();
                    if (txt) txt.innerText = `SYNCING ${shortName} [${completedFeeds}/${activeDatasets.length}]`;
                }

                return json;
            } catch (e) {
                console.error(`GFW API Error for ${dataset}:`, {
                    error: e.message,
                    stack: e.stack,
                    url: url,
                    dataset: dataset
                });
                return { entries: [] };
            }
        });

        // Wait for all feeds to return
        const results = await Promise.all(fetchPromises);

        // Log which method was used
        if (shipProxySource) {
            const sourceLabel = shipProxySource === 'php' ? 'BACKEND' : (shipProxySource === 'direct' ? 'DIRECT' : `THIRD-PARTY (${shipProxySource})`);
            logSystem(`NET: Ship data (GFW) via ${sourceLabel}`);
        }

        // Check if toggle was turned off during fetch
        if (!shipToggle || !shipToggle.checked) {
            MapLayerManager.clearLayerData('gfw-data');
            hideStatus();
            return;
        }

        // ANALYZE MISSING DATA & UPDATE STATUS BOX
        const emptyFeeds = [];
        results.forEach((data, index) => {
            const count = data.entries ? data.entries.length : 0;
            const type = activeDatasets[index].split(':')[0].split('-')[2].toUpperCase();
            if (count === 0) {
                logSystem(`INFO: 0 targets found for ${type}. (Source active, but no data in range)`);
                emptyFeeds.push(type);
            }
        });

        // UI: Done (only if console is not open)
        if (!isConsoleOpen()) {
            if (emptyFeeds.length > 0) {
                // Show warning for empty feeds
                updateLoadingStatus(`DONE. NO DATA FOR: ${emptyFeeds.join(', ')}`, 'text-red');
                // Keep visible for 5 seconds so user sees it
                setTimeout(() => {
                    hideStatus();
                    const txt = loadingTextEl();
                    if (txt) txt.className = 'text-dim'; // Reset
                }, 5000);
            } else {
                hideStatus();
            }
        }

        // Flatten all entries from results into a single array
        const allEvents = results.flatMap(r => r.entries || []);

        // Send data to worker for processing
        window.dataWorker.postMessage({
            type: 'PROCESS_SHIPS',
            data: allEvents,
            config: {
                entityLimit: entityLimit
            }
        });

    } catch (err) {
        hideStatus();
        logSystem(`ERR: Marine Feed Error - ${err.message}`);
        if (err.message && err.message.includes('401')) logSystem("AUTH: Check API Token.");
    }
}

// Event Listeners for Filters
const updateShipFilters = () => {
    // 1. Build the filter array for MapLibre
    // Start with 'any' to allow multiple types
    const typeFilters = ['any'];

    // Check each toggle and add its corresponding rawType to the list
    if (shipGapToggle.checked) typeFilters.push(['==', ['get', 'rawType'], 'gap']);
    if (shipEncounterToggle.checked) typeFilters.push(['==', ['get', 'rawType'], 'encounter']);
    if (shipLoiteringToggle.checked) typeFilters.push(['==', ['get', 'rawType'], 'loitering']);
    if (shipFishingToggle.checked) typeFilters.push(['==', ['get', 'rawType'], 'fishing']);
    if (shipPortToggle.checked) typeFilters.push(['==', ['get', 'rawType'], 'port_visit']);

    // 2. Apply Filter
    if (map && map.getLayer('ships')) {
        // If only 'any' is present (length 1), it means NO toggles are checked.
        if (typeFilters.length === 1) {
            map.setFilter('ships', ['==', 'rawType', 'NONE_SELECTED']);
            if (map.getLayer('ships-dots')) map.setFilter('ships-dots', ['==', 'rawType', 'NONE_SELECTED']);
        } else {
            map.setFilter('ships', typeFilters);
            if (map.getLayer('ships-dots')) map.setFilter('ships-dots', typeFilters);
        }
    }
};

