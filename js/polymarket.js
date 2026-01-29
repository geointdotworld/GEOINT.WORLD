// --- Poly Market Live Data Stream ---

const POLY_CACHE_KEY = 'polymarket_data_v7';
const POLY_CACHE_TTL = 30 * 60 * 1000; // Increased to 30 mins to respect 30k load time
let polyInterval = null;
let polyGroupEnabled = true;

let polyTags = [];

// Table sort state
let polySortState = {
    column: 'volume24',
    direction: 'desc'
};

// In-memory data to support 30k+ markets without sessionStorage limits
let polyMarketsRaw = [];      // ALWAYS raw outcomes for the table view
let polyMarketsCurrent = [];  // Current ticker data (can be grouped or raw)
let polyTableViewState = 'filtered'; // 'all' or 'filtered'
let polyTableSearchQuery = '';
let polyMinChance = 30; // Live filter state

// --- WebSocket Management ---
const POLY_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/';
let polyWs = null;
let polyWsSubscribedTokens = new Set();
let polyMarketToTokens = new Map(); // marketId -> [token1, token2]
let polyTokenToMarket = new Map(); // token -> marketId

async function initPolymarketSystem() {
    const isEnabled = localStorage.getItem('polymarket_enabled') === 'true'; // Default false
    polyGroupEnabled = localStorage.getItem('polymarket_group_enabled') !== 'false'; // Default true

    const groupToggle = document.getElementById('poly-group-toggle');
    if (groupToggle) {
        groupToggle.checked = polyGroupEnabled;
        groupToggle.addEventListener('change', (e) => {
            polyGroupEnabled = e.target.checked;
            localStorage.setItem('polymarket_group_enabled', polyGroupEnabled);
            // Re-fetch or at least re-process data to apply grouping change
            fetchPolymarketData();
        });
    }

    const polymarketToggle = document.getElementById('polymarket-toggle');
    if (polymarketToggle) {
        polymarketToggle.checked = isEnabled;
    }

    if (!isEnabled) {
        const ticker = document.getElementById('polymarket-ticker-container');
        if (ticker) ticker.style.display = 'none';
        if (typeof updateBottomStack === 'function') updateBottomStack();
        return;
    }

    if (typeof updateBottomStack === 'function') updateBottomStack();

    // Load filter tags
    // Load filter tags
    let savedFilter = localStorage.getItem('polymarket_filter');
    // Migration: If user has old default, update to new default
    if (!savedFilter || savedFilter === 'strike,trump,attack') {
        savedFilter = 'strike,trump,attack,iran,putin,israel';
        localStorage.setItem('polymarket_filter', savedFilter);
    }
    polyTags = savedFilter.split(',').map(s => s.trim()).filter(s => s);
    renderPolyTags();

    // Initialize Filters BEFORE rendering from cache
    let currentVol = localStorage.getItem('polymarket_min_vol');
    if (!currentVol) {
        currentVol = '5000';
        localStorage.setItem('polymarket_min_vol', currentVol);
    }
    const volumeInput = document.getElementById('poly-volume-input');
    if (volumeInput) volumeInput.value = currentVol;

    // Initialize single chance slider
    let currentChance = localStorage.getItem('polymarket_min_chance') || '30';
    polyMinChance = parseInt(currentChance);
    const chanceSlider = document.getElementById('poly-chance-slider');
    const chanceValue = document.getElementById('poly-chance-value');
    if (chanceSlider) chanceSlider.value = currentChance;
    if (chanceValue) chanceValue.textContent = currentChance + '%';

    const cached = loadPolyFromCache();
    if (cached) {
        polyMarketsCurrent = cached.markets || [];
        renderPolyTicker(polyMarketsCurrent);
    }

    if (!cached || (Date.now() - cached.timestamp > POLY_CACHE_TTL)) {
        await fetchPolymarketData();
    }

    startPolyCycle();
    setupPolyFilterListeners();
    setupPolyVolumeListeners();
    setupPolyChanceListeners();
    setupPolyShowAllListeners();
}

function renderPolyTags() {
    const tagList = document.getElementById('poly-tag-list');
    if (!tagList) return;

    tagList.innerHTML = polyTags.map((tag, index) => `
        <div class="poly-tag">
            <span>${tag.toUpperCase()}</span>
            <span class="poly-tag-remove" onclick="removePolyTag(${index})">×</span>
        </div>
    `).join('');
}

window.removePolyTag = function (index) {
    polyTags.splice(index, 1);
    updatePolyFilterState();
};

function updatePolyFilterState() {
    localStorage.setItem('polymarket_filter', polyTags.join(','));
    renderPolyTags();
    if (polyMarketsCurrent.length > 0) renderPolyTicker(polyMarketsCurrent);
}

function setupPolyFilterListeners() {
    const tagInput = document.getElementById('poly-tag-input');
    if (!tagInput) return;

    tagInput.addEventListener('input', (e) => {
        const val = tagInput.value;
        // Check for space or comma at the end
        if (val.endsWith(' ') || val.endsWith(',')) {
            const tag = val.slice(0, -1).trim();
            if (tag && !polyTags.includes(tag.toLowerCase())) {
                polyTags.push(tag.toLowerCase());
                tagInput.value = '';
                updatePolyFilterState();
            } else if (!tag) {
                tagInput.value = ''; // Clean up if just trailing space
            }
        }
    });

    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const tag = tagInput.value.trim();
            if (tag && !polyTags.includes(tag.toLowerCase())) {
                polyTags.push(tag.toLowerCase());
                tagInput.value = '';
                updatePolyFilterState();
            }
        } else if (e.key === 'Backspace' && tagInput.value === '' && polyTags.length > 0) {
            polyTags.pop();
            updatePolyFilterState();
        }
    });

    // Also handle focus for the container to focus the input
    const container = document.getElementById('poly-tag-container');
    if (container) {
        container.addEventListener('click', () => tagInput.focus());
    }
}

function setupPolyVolumeListeners() {
    const applyBtn = document.getElementById('poly-volume-apply-btn');
    const volumeInput = document.getElementById('poly-volume-input');

    if (applyBtn && volumeInput) {
        applyBtn.addEventListener('click', () => {
            const vol = volumeInput.value.trim();
            localStorage.setItem('polymarket_min_vol', vol);
            if (polyMarketsCurrent.length > 0) renderPolyTicker(polyMarketsCurrent);
        });

        volumeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                applyBtn.click();
            }
        });
    }
}

function setupPolyChanceListeners() {
    const slider = document.getElementById('poly-chance-slider');
    const valueEl = document.getElementById('poly-chance-value');

    // Initialize state from storage
    const saved = localStorage.getItem('polymarket_min_chance');
    if (saved !== null) polyMinChance = parseInt(saved);
    if (slider) slider.value = polyMinChance;
    if (valueEl) valueEl.textContent = polyMinChance + '%';

    // Inline debounce to ensure stability regardless of load order
    let renderTimeout;
    const triggerRender = () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            if (polyMarketsCurrent.length > 0) renderPolyTicker(polyMarketsCurrent);
        }, 15);
    };

    if (slider) {
        // Cross-browser update function
        const updateValue = () => {
            const val = parseInt(slider.value);
            polyMinChance = val;
            if (valueEl) valueEl.textContent = val + '%';
            triggerRender();
        };

        // Standard input event (Chrome, modern Firefox)
        slider.addEventListener('input', updateValue);

        // Firefox/LibreWolf: Also listen for mousemove while dragging
        let isDragging = false;
        slider.addEventListener('mousedown', () => { isDragging = true; });
        document.addEventListener('mouseup', () => {
            if (isDragging) { isDragging = false; updateValue(); }
        });
        slider.addEventListener('mousemove', () => { if (isDragging) updateValue(); });

        // Touch support for mobile
        slider.addEventListener('touchstart', () => { isDragging = true; });
        slider.addEventListener('touchend', () => { isDragging = false; updateValue(); });
        slider.addEventListener('touchmove', () => { if (isDragging) updateValue(); });

        // Save to localStorage on final change
        slider.addEventListener('change', (e) => {
            localStorage.setItem('polymarket_min_chance', e.target.value);
            if (polyMarketsCurrent.length > 0) renderPolyTicker(polyMarketsCurrent);
        });
    }
}

function setupPolyShowAllListeners() {
    const showAllBtn = document.getElementById('poly-show-all-btn');
    const tableSide = document.getElementById('poly-full-list-modal');
    const closeFullListBtn = document.getElementById('close-poly-full-list-btn');

    if (showAllBtn && tableSide && closeFullListBtn) {
        const toggleTable = (e) => {
            if (e) e.preventDefault();
            polyTableViewState = 'filtered';
            const allBtn = document.getElementById('poly-view-all-btn');
            const filterBtn = document.getElementById('poly-view-filtered-btn');
            if (allBtn) allBtn.classList.remove('active');
            if (filterBtn) filterBtn.classList.add('active');

            renderFullMarketTable(polyMarketsRaw);

            // On mobile, the composite modal might be hidden or z-indexed differently.
            // Explicitly ensure the main container is visible.
            const composite = document.getElementById('poly-composite-modal');
            if (composite) composite.style.display = 'flex';

            tableSide.style.display = 'flex';
        };

        showAllBtn.addEventListener('click', toggleTable);
        showAllBtn.addEventListener('touchstart', toggleTable, { passive: false });

        const allBtn = document.getElementById('poly-view-all-btn');
        const filterBtn = document.getElementById('poly-view-filtered-btn');

        if (allBtn && filterBtn) {
            allBtn.addEventListener('click', () => {
                polyTableViewState = 'all';
                allBtn.classList.add('active');
                filterBtn.classList.remove('active');
                renderFullMarketTable(polyMarketsRaw);
            });

            filterBtn.addEventListener('click', () => {
                polyTableViewState = 'filtered';
                filterBtn.classList.add('active');
                allBtn.classList.remove('active');
                renderFullMarketTable(polyMarketsRaw);
            });
        }

        const searchInput = document.getElementById('poly-table-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                polyTableSearchQuery = e.target.value.toLowerCase().trim();
                renderFullMarketTable(polyMarketsRaw);
            });
        }

        closeFullListBtn.addEventListener('click', () => {
            tableSide.style.display = 'none';
        });
    }
}

window.updatePolySort = function (column) {
    if (polySortState.column === column) {
        polySortState.direction = polySortState.direction === 'desc' ? 'asc' : 'desc';
    } else {
        polySortState.column = column;
        polySortState.direction = 'desc';
    }

    if (polyMarketsRaw.length > 0) {
        renderFullMarketTable(polyMarketsRaw);
    }
};

async function renderFullMarketTable(markets) {
    const container = document.getElementById('poly-table-container');
    if (!container) return;

    // Show loading spinner if no data yet (and we rely on polyMarketsRaw normally)
    if ((!polyMarketsRaw || polyMarketsRaw.length === 0) && (!markets || markets.length === 0)) {
        container.innerHTML = `
            <div class="poly-loader-container">
                <div class="poly-loader"></div>
                <div class="poly-loader-text">SCANNING MARKETS...</div>
            </div>
        `;
        return;
    }

    let displayMarkets = [...markets];

    // Apply Live Search Query
    if (polyTableSearchQuery) {
        displayMarkets = displayMarkets.filter(m =>
            (m.title || '').toLowerCase().includes(polyTableSearchQuery)
        );
    }

    // Apply Filtered View if active
    if (polyTableViewState === 'filtered') {
        const savedVol = localStorage.getItem('polymarket_min_vol');
        const minVol = (savedVol !== null) ? parseInt(savedVol) : 5000;
        const minChance = polyMinChance; // Use live state

        displayMarkets = displayMarkets.filter(m => {
            const titleLower = (m.title || '').toLowerCase();
            let keywordMatch = polyTags.length === 0;
            if (!keywordMatch) {
                for (const tag of polyTags) {
                    if (titleLower.includes(tag.toLowerCase())) {
                        keywordMatch = true;
                        break;
                    }
                }
            }
            if (!keywordMatch) return false;
            if (parseFloat(m.volume24 || 0) < minVol) return false;
            const prob = parseFloat(m.probability || 0);
            if (prob < minChance) return false;
            return true;
        });
    }

    // Apply Sorting
    const sorted = displayMarkets.sort((a, b) => {
        let valA = a[polySortState.column];
        let valB = b[polySortState.column];

        // Handle numeric conversion for volume and probability
        if (polySortState.column === 'createdAt') {
            valA = valA ? new Date(valA).getTime() : 0;
            valB = valB ? new Date(valB).getTime() : 0;
        } else {
            valA = parseFloat(valA || 0);
            valB = parseFloat(valB || 0);
        }

        if (polySortState.direction === 'asc') {
            return valA - valB;
        } else {
            return valB - valA;
        }
    });

    const getArrow = (col) => {
        if (polySortState.column !== col) return '';
        const symbol = polySortState.direction === 'desc' ? '▲' : '▼';
        return `<span class="poly-sort-arrow">${symbol}</span>`;
    };

    let html = `
        <table class="poly-market-table">
            <thead>
                <tr>
                    <th style="min-width: 200px;">MARKET QUESTION (${displayMarkets.length})</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updatePolySort('createdAt')">NEWEST${getArrow('createdAt')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updatePolySort('volume24')">24H VOL${getArrow('volume24')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updatePolySort('volumeTotal')">TOTAL VOL${getArrow('volumeTotal')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updatePolySort('probability')">CHANCE${getArrow('probability')}</th>
                </tr>
            </thead>
            <tbody>
    `;

    sorted.forEach(m => {
        // Apply title cleaning if needed (re-use logic or use stored clean title)
        let cleanTitle = m.title;
        // Strip outcomes for UI consistency
        cleanTitle = cleanTitle.replace(/(\s+[-:–]?\s*|\s+)(\(?\b(Yes|No)\b\)?)$/i, '').trim();
        cleanTitle = cleanTitle.replace(/\s+\b(Yes|No)\b\s+/gi, ' ').trim();

        const marketUrl = m.slug ? `https://polymarket.com/market/${m.slug}` : '#';
        const pClass = m.probability >= 50 ? 'poly-green' : (m.probability > 30 ? 'poly-yellow' : 'poly-red');

        // Extract a simple date for display (MM/DD)
        let dateStr = '—';
        if (m.createdAt) {
            try {
                const date = new Date(m.createdAt);
                // Display as MM/DD/YY for space efficiency in the table
                dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`;
            } catch (e) { }
        }

        html += `
            <tr>
                <td><a href="${marketUrl}" target="_blank" rel="noopener" class="poly-table-title">${cleanTitle}</a></td>
                <td style="text-align: center; color: #888; font-size: 11px;">${dateStr}</td>
                <td style="text-align: center;" class="poly-table-vol">${formatPolyVol(m.volume24)}</td>
                <td style="text-align: center;" class="poly-table-vol">${formatPolyVol(m.volumeTotal)}</td>
                <td style="text-align: center;" class="poly-table-prob ${pClass}">${m.probability}%</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function startPolyCycle() {
    if (polyInterval) clearInterval(polyInterval);
    polyInterval = setInterval(fetchPolymarketData, POLY_CACHE_TTL);
}

function stopPolyCycle() {
    if (polyInterval) {
        clearInterval(polyInterval);
        polyInterval = null;
    }
}

if (polymarketToggle) {
    polymarketToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        localStorage.setItem('polymarket_enabled', isEnabled);

        const ticker = document.getElementById('polymarket-ticker-container');

        if (isEnabled) {
            if (ticker) ticker.style.display = 'flex';
            if (typeof updateBottomStack === 'function') updateBottomStack();
            fetchPolymarketData();
            startPolyCycle();
        } else {
            if (ticker) ticker.style.display = 'none';
            if (typeof updateBottomStack === 'function') updateBottomStack();
            stopPolyCycle();
        }
    });
}

function loadPolyFromCache() {
    try {
        const cached = sessionStorage.getItem(POLY_CACHE_KEY);
        if (cached) {
            const data = JSON.parse(cached);
            if (data && data.markets) {
                polyMarketsRaw = data.marketsRaw || data.markets; // Fallback if old cache
                return data;
            }
        }
    } catch (e) { }
    return null;
}

// CORS proxy fallback removed - now using centralized fetchWithProxyChain
let polyProxySource = null; // Track which proxy was used for logging
let polyLoadedCount = 0; // Track total loaded for live updates

async function fetchBatch(offset, limit) {
    // Exact same URL format as MVP: closed=false only, no active filter
    const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${limit}&offset=${offset}`;
    try {
        const res = await fetchWithProxyChain(url);
        // Store proxy source for first successful batch (to log once)
        if (!polyProxySource && res.proxySource) {
            polyProxySource = res.proxySource;
        }
        const data = await res.json();
        const results = Array.isArray(data) ? data : (data.data || []);

        // Update live count as each batch completes
        polyLoadedCount += results.length;
        updatePolyLoadingStatus(`Loading markets...`, polyLoadedCount);

        return results;
    } catch (e) {
        // console.error(`POLY: Batch fetch failed at offset ${offset}`, e);
        return [];
    }
}

function updatePolyLoadingStatus(msg, current = null, total = 30000) {
    const statusEl = document.getElementById('poly-status-text');
    if (statusEl) statusEl.textContent = msg;

    const tickerContent = document.getElementById('polymarket-ticker-content');
    if (tickerContent) {
        tickerContent.style.animation = 'none';
        tickerContent.style.transform = 'none';

        let displayHtml = `<span class="poly-item" style="color: #888; text-transform: uppercase;">${msg}</span>`;

        if (current !== null) {
            const percent = Math.min(100, Math.floor((current / total) * 100));
            displayHtml = `
                <div style="display: flex; align-items: center; gap: 12px; width: 280px; padding: 0;">
                    <span class="poly-item" style="color: #1452f0; text-transform: uppercase; margin: 0 10px; white-space: nowrap; font-size: 11px; font-weight: bold; width: 90px;">SCANNING: ${percent}%</span>
                    <div style="flex-grow: 1; height: 5px; background: rgba(20, 82, 240, 0.15); border: 1px solid rgba(20, 82, 240, 0.5); position: relative; overflow: hidden; border-radius: 2px;">
                        <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${percent}%; background: #1452f0; box-shadow: 0 0 10px rgba(20, 82, 240, 0.6); transition: width 0.4s ease;"></div>
                    </div>
                </div>
            `;
        }

        tickerContent.innerHTML = `<div class="poly-box" style="border-color: rgba(20, 82, 240, 0.5); width: fit-content; min-width: 300px; height: 35px; justify-content: flex-start;">${displayHtml}</div>`;
    }
}

async function fetchPolymarketData() {
    try {
        polyProxySource = null; // Reset for new scan
        polyLoadedCount = 0; // Reset loaded count
        logSystem("POLY: Initiating deep unresolved market scan...");
        updatePolyLoadingStatus('Loading markets...');

        // Check if disabled right at start
        if (localStorage.getItem('polymarket_enabled') === 'false') {
            logSystem("POLY: Fetch aborted (disabled).");
            updatePolyLoadingStatus('Disabled');
            return;
        }

        // 200 limit, 45 parallel (3x faster), 600 batches (120k markets max)
        const limit = 200;
        const parallel = 45;
        const maxBatches = 600;

        let allMarkets = [];

        for (let i = 0; i < maxBatches; i += parallel) {
            // STOP CHECK: If user toggles off mid-scan
            if (localStorage.getItem('polymarket_enabled') === 'false') {
                logSystem("POLY: Scan halted by user.");
                break;
            }

            const batchIndices = Array.from({ length: Math.min(parallel, maxBatches - i) }, (_, j) => i + j);
            const batchNum = Math.floor(i / parallel) + 1;
            // logSystem(`POLY: Fetching unresolved batch ${batchNum}...`);

            // Show live loading count BEFORE fetch starts
            updatePolyLoadingStatus(`Fetching batch ${batchNum}...`, allMarkets.length);

            const results = await Promise.all(batchIndices.map(b => fetchBatch(b * limit, limit)));
            const flatResults = results.flat();
            allMarkets.push(...flatResults);

            // Update status AFTER results processed
            updatePolyLoadingStatus(`Loading markets...`, allMarkets.length);

            // Log proxy source after first batch (once)
            if (i === 0 && polyProxySource) {
                const sourceLabel = polyProxySource === 'php' ? 'BACKEND' : `THIRD-PARTY (${polyProxySource})`;
                logSystem(`NET: Polymarket data via ${sourceLabel}`);
            }
            // Stop only when the entire parallel set is empty
            const emptyCount = results.filter(r => !r || r.length === 0).length;
            if (emptyCount === results.length) {
                logSystem('POLY: Detected empty parallel set, ending scan.');
                break;
            }

            await new Promise(r => setTimeout(r, 150)); // Reduced delay for faster fetching
        }

        const totalFetched = allMarkets.length;
        updatePolyLoadingStatus(`Deduplicating markets...`, totalFetched);

        // Yield to UI thread
        await new Promise(r => setTimeout(r, 0));

        // Deduplicate using Map (fast)
        const uniqueMap = new Map();
        for (const m of allMarkets) {
            if (m) {
                const key = m.conditionId || m.id;
                if (key && !uniqueMap.has(key)) {
                    uniqueMap.set(key, m);
                }
            }
        }

        const uniqueCount = uniqueMap.size;
        updatePolyLoadingStatus(`Normalizing markets...`, uniqueCount);
        await new Promise(r => setTimeout(r, 0));

        // Normalize in chunks
        const transformed = [];
        let processed = 0;
        for (const m of uniqueMap.values()) {
            // Parse outcomePrices JSON
            let probability = 50;
            try {
                const outcomePrices = JSON.parse(m.outcomePrices || '[0.5]');
                probability = parseFloat(outcomePrices[0]);
            } catch (e) {
                probability = 0.5;
            }

            const q = m.question || '';

            // Outcome extraction
            let outcome = 'Yes';
            if (q.includes('Will NOT') || q.includes('will not')) outcome = 'No';
            else if (q.includes('above') || q.includes('over') || q.includes('higher')) outcome = 'Yes';
            else if (q.includes('below') || q.includes('under') || q.includes('lower')) outcome = 'No';
            else if (q.match(/\(([^)]{1,30})\)$/)) {
                const match = q.match(/\(([^)]{1,30})\)$/);
                if (match) outcome = match[1];
            }

            // Create groupKey by stripping dates from question to group related markets
            // e.g., "Israel strikes Iran by January 16, 2026?" → "Israel strikes Iran by ?"
            let groupKey = m.groupItemTitle;
            if (!groupKey) {
                // Strip date patterns to create common key for date-variant markets
                groupKey = q
                    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/gi, '')
                    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '')
                    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
                    .replace(/\b(Q[1-4])\s*\d{4}\b/gi, '')
                    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi, '')
                    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim() || q;
            }

            let title = q.trim();
            // Strip trailing outcomes like (Yes), (No), Yes, No, - Yes, etc.
            title = title.replace(/(\s+[-:–]?\s*|\s+)(\(?\b(Yes|No)\b\)?)$/i, '').trim();

            // Token extraction for WebSockets
            let clobTokens = [];
            try {
                if (m.clobTokenIds) {
                    clobTokens = JSON.parse(m.clobTokenIds);
                }
            } catch (e) { }

            transformed.push({
                title: title || 'Unknown',
                groupKey: groupKey,
                probability: (probability * 100).toFixed(0),
                volume24: parseFloat(m.volume24hr || 0),
                volumeTotal: parseFloat(m.volume || 0),
                createdAt: m.createdAt || '',
                slug: m.slug || '',
                id: m.conditionId || m.id,
                outcome: outcome,
                clobTokenIds: clobTokens
            });

            processed++;
            if (processed % 2000 === 0) {
                updatePolyLoadingStatus(`Normalizing markets...`, processed, uniqueCount);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (transformed.length > 0) {
            let normalized = [];

            if (polyGroupEnabled) {
                updatePolyLoadingStatus(`Grouping by market...`, transformed.length);
                await new Promise(r => setTimeout(r, 0));

                const groupedByMarket = {};
                transformed.forEach(m => {
                    const key = m.groupKey;
                    if (!groupedByMarket[key]) {
                        groupedByMarket[key] = {
                            title: m.title,
                            probability: m.probability,
                            volume24: m.volume24,
                            volumeTotal: m.volumeTotal,
                            createdAt: m.createdAt,
                            slug: m.slug,
                            id: m.id,
                            outcome: m.outcome || 'Yes',
                            clobTokenIds: m.clobTokenIds || []
                        };
                    } else {
                        groupedByMarket[key].volume24 += m.volume24;
                        groupedByMarket[key].volumeTotal += m.volumeTotal;
                        if (parseFloat(m.probability) > parseFloat(groupedByMarket[key].probability)) {
                            groupedByMarket[key].title = m.title;
                            groupedByMarket[key].probability = m.probability;
                            groupedByMarket[key].slug = m.slug;
                            groupedByMarket[key].id = m.id;
                            groupedByMarket[key].outcome = m.outcome || 'Yes';
                        }
                    }
                });
                normalized = Object.values(groupedByMarket);
                logSystem(`POLY: Grouped ${transformed.length} → ${normalized.length} unique questions`);
            } else {
                normalized = transformed;
                logSystem(`POLY: Raw outcomes enabled (${normalized.length} items)`);
            }

            // Always store the full raw list for the table view
            polyMarketsRaw = [...transformed];

            updatePolyLoadingStatus(`Sorting items...`, normalized.length);
            await new Promise(r => setTimeout(r, 0));

            // Default sort depends on current active sort if any, or 24h vol
            const sortCol = polySortState.column || 'volume24';
            normalized.sort((a, b) => {
                if (sortCol === 'createdAt') return new Date(b.createdAt) - new Date(a.createdAt);
                return (b[sortCol] || 0) - (a[sortCol] || 0);
            });

            // For the raw list, we also apply a baseline sort (Newest)
            polyMarketsRaw.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Store in RAM for the full table view (bypasses sessionStorage 5MB limit)
            polyMarketsCurrent = normalized;

            // Cache up to top 30k to provide a deeper historical and high-volume dataset
            const toCache = normalized.slice(0, 30000);
            // Store to cache
            try {
                const cacheObj = { timestamp: Date.now(), markets: toCache, marketsRaw: polyMarketsRaw.slice(0, 30000), totalCount: normalized.length };
                sessionStorage.setItem(POLY_CACHE_KEY, JSON.stringify(cacheObj));
            } catch (e) {
                console.warn("Poly: Failed to cache to sessionStorage", e);
            }
            try {
                localStorage.setItem('polymarket_data_v7', JSON.stringify(toCache));
            } catch (e) {
                console.warn("Poly: Failed to cache to localStorage", e);
            }

            renderPolyTicker(normalized);

            // If table view is open, refresh it with new data
            const composite = document.getElementById('poly-composite-modal');
            if (composite && composite.style.display !== 'none' && composite.style.display !== '') {
                const tableSide = document.getElementById('poly-full-list-modal');
                if (tableSide) {
                    renderFullMarketTable(polyMarketsRaw);
                }
            }

            logSystem(`POLY: Scan complete. ${normalized.length} unique market questions indexed.`);
        } else {
            logSystem('POLY: No unresolved markets found during scan.');
            updatePolyLoadingStatus('No markets found');
        }
    } catch (error) {
        console.error('Failed to fetch Poly markets:', error);
        const container = document.getElementById('polymarket-ticker-content');
        if (container && !container.textContent.includes('poly-item')) {
            // Use DOM creation
            const span = document.createElement('span');
            span.className = 'poly-item item-error';
            span.textContent = 'PolyMarket uplink unavailable. Retrying...';
            container.replaceChildren(span);
        }
    }
}

function formatPolyVol(v) {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
    return `$${v.toFixed(0)}`;
}


// Max items to render in ticker (prevents DOM overload)
const POLY_MAX_RENDER = 2000;

function renderPolyTicker(markets) {
    const container = document.getElementById('polymarket-ticker-content');
    if (!container) return;

    const savedVol = localStorage.getItem('polymarket_min_vol');
    const minVol = (savedVol !== null) ? parseInt(savedVol) : 5000;

    // Use live global state for chance filter
    const minChance = polyMinChance;
    const statusEl = document.getElementById('poly-filter-status');
    const showAllBtn = document.getElementById('poly-show-all-btn');

    // Show the "Show All" button if we have data
    if (showAllBtn) {
        showAllBtn.style.display = (markets && markets.length > 0) ? 'block' : 'none';
    }

    const seenIds = new Set();
    let matchCount = 0;

    // If multiple keywords, group by keyword for interleaving
    const keywordBuckets = polyTags.length > 1 ? {} : null;
    if (keywordBuckets) {
        for (const tag of polyTags) {
            keywordBuckets[tag.toLowerCase()] = [];
        }
    }

    const allMatches = []; // Used when no keywords or single keyword

    for (const m of markets) {
        if (seenIds.has(m.id)) continue;
        seenIds.add(m.id);

        let title = (m.title || '');
        title = title.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
        // Strip trailing outcomes (Yes/No) in all forms
        title = title.replace(/(\s+[-:–]?\s*|\s+)(\(?\b(Yes|No)\b\)?)$/i, '').trim();
        // Also strip standalone Yes/No anywhere (e.g., "X Yes by date")
        title = title.replace(/\s+\b(Yes|No)\b\s+/gi, ' ').trim();

        if (!title) continue;

        const titleOrigLower = (m.title || '').toLowerCase();

        // Check which keywords match
        let matchedKeyword = null;
        if (polyTags.length > 0) {
            for (const tag of polyTags) {
                if (titleOrigLower.includes(tag.toLowerCase())) {
                    matchedKeyword = tag.toLowerCase();
                    break;
                }
            }
            if (!matchedKeyword) continue;
        }

        if (parseFloat(m.volume24 || 0) < minVol) continue;
        const prob = parseFloat(m.probability || 0);
        if (prob < minChance) continue;

        matchCount++;

        // Build the HTML for this item
        let pClass = 'poly-yellow';
        let arrow = '−';

        if (prob >= 60) {
            pClass = 'poly-green';
            arrow = '▲';
        } else if (prob < 40) {
            pClass = 'poly-red';
            arrow = '▼';
        }

        const marketUrl = m.slug ? `https://polymarket.com/market/${m.slug}` : '#';

        // Create DOM elements directly (faster than innerHTML)
        const polyBox = document.createElement('div');
        polyBox.className = 'poly-box';

        if (m.slug) {
            const link = document.createElement('a');
            link.href = marketUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'poly-link';
            link.textContent = title;
            polyBox.appendChild(link);
        } else {
            const span = document.createElement('span');
            span.className = 'poly-item';
            span.textContent = title;
            polyBox.appendChild(span);
        }

        polyBox.appendChild(document.createTextNode(' '));

        const volSpan = document.createElement('span');
        volSpan.className = 'poly-volume';
        volSpan.textContent = formatPolyVol(m.volume24);
        polyBox.appendChild(volSpan);

        polyBox.appendChild(document.createTextNode(' '));

        const probSpan = document.createElement('span');
        probSpan.className = `poly-prob ${pClass}`;
        probSpan.textContent = `${arrow} ${m.probability}%`;
        polyBox.appendChild(probSpan);

        // Add to appropriate bucket or general list
        if (keywordBuckets && matchedKeyword) {
            keywordBuckets[matchedKeyword].push(polyBox);
        } else {
            allMatches.push(polyBox);
        }
    }

    // Interleave results if multiple keywords
    const elements = [];
    if (keywordBuckets) {
        const bucketKeys = Object.keys(keywordBuckets).filter(k => keywordBuckets[k].length > 0);
        const bucketIndices = {};
        for (const k of bucketKeys) bucketIndices[k] = 0;

        let lastKeyword = null;
        while (elements.length < POLY_MAX_RENDER) {
            // Find next bucket that's different from last used and has items
            let picked = null;
            for (const k of bucketKeys) {
                if (k !== lastKeyword && bucketIndices[k] < keywordBuckets[k].length) {
                    picked = k;
                    break;
                }
            }
            // If no different bucket available, use any bucket with items
            if (!picked) {
                for (const k of bucketKeys) {
                    if (bucketIndices[k] < keywordBuckets[k].length) {
                        picked = k;
                        break;
                    }
                }
            }
            if (!picked) break; // All buckets exhausted

            elements.push(keywordBuckets[picked][bucketIndices[picked]]);
            bucketIndices[picked]++;
            lastKeyword = picked;
        }
    } else {
        // No interleaving needed
        for (let i = 0; i < Math.min(allMatches.length, POLY_MAX_RENDER); i++) {
            elements.push(allMatches[i]);
        }
    }

    if (statusEl) {
        const renderNote = matchCount > POLY_MAX_RENDER ? ` (showing top ${POLY_MAX_RENDER.toLocaleString()})` : '';
        const filters = [];
        if (polyTags.length > 0) filters.push(`Tags: [${polyTags.join(', ')}]`);
        if (minVol > 0) filters.push(`Vol: >${formatPolyVol(minVol)}`);
        if (minChance > 0) filters.push(`Chance: >${minChance}%`);

        statusEl.textContent = filters.length > 0
            ? `Active ${filters.join(' | ')} (${matchCount.toLocaleString()} matches${renderNote})`
            : `${matchCount.toLocaleString()} markets loaded${renderNote}`;
    }

    const headerCount = document.getElementById('poly-header-count');
    if (headerCount) headerCount.textContent = `(${matchCount.toLocaleString()})`;

    // Build fragment instead of HTML string (faster!)
    const fragment = document.createDocumentFragment();

    if (elements.length === 0 && polyTags.length > 0) {
        const errorBox = document.createElement('div');
        errorBox.className = 'poly-box';
        const errorSpan = document.createElement('span');
        errorSpan.className = 'poly-item item-error';
        errorSpan.textContent = `No markets found for [${polyTags.join(', ')}]`;
        errorBox.appendChild(errorSpan);
        fragment.appendChild(errorBox);
    } else {
        // Add elements twice for seamless scrolling
        elements.forEach(el => fragment.appendChild(el.cloneNode(true)));
        elements.forEach(el => fragment.appendChild(el.cloneNode(true)));
    }

    // Reset animation
    container.style.animation = 'none';
    void container.offsetWidth;

    // Replace content efficiently
    container.replaceChildren(fragment);

    tryStartPolyTickerAnimation();

    // Update WebSocket subscriptions for currently visible filtered markets
    updatePolyWsSubscriptions(markets);
}

function tryStartPolyTickerAnimation(retryCount = 0) {
    const container = document.getElementById('polymarket-ticker-content');
    if (!container) return;

    if (document.hidden) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) tryStartPolyTickerAnimation();
        }, { once: true });
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const fullWidth = container.scrollWidth;

            // If width is 0, browser hasn't laid it out yet. Retry.
            if (fullWidth <= 0) {
                if (retryCount < 10) {
                    setTimeout(() => tryStartPolyTickerAnimation(retryCount + 1), 100);
                }
                return;
            }

            // GUARD: Do not scroll if only a single item (like "Loading..." or error)
            // or if the content is narrower than the actual container.
            const wrapper = document.getElementById('polymarket-ticker-wrapper');
            if (container.children.length <= 1 || fullWidth / 2 <= (wrapper ? wrapper.offsetWidth : 1000)) {
                container.style.animation = 'none';
                container.style.transform = 'none';
                return;
            }

            const scrollSpeed = 40; // Slightly slower than GDELT for readability
            const duration = (fullWidth / 2) / scrollSpeed;
            container.style.animation = `polyTicker ${duration}s linear infinite`;
        });
    });
}

document.addEventListener('DOMContentLoaded', initPolymarketSystem);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tryStartPolyTickerAnimation();
});

// --- WebSocket Logic ---

function updatePolyWsSubscriptions(allMarkets) {
    if (!polyWs || polyWs.readyState !== WebSocket.OPEN) {
        initPolyWs(); // Ensure connected
        return;
    }

    // Get tokens for markets that pass filters
    const filteredTokens = new Set();
    const minVol = parseInt(localStorage.getItem('polymarket_min_vol') || '5000');
    const minChance = parseInt(localStorage.getItem('polymarket_min_chance') || '30');

    allMarkets.forEach(m => {
        // Simple filter check
        let keywordMatch = polyTags.length === 0;
        if (!keywordMatch) {
            const title = (m.title || '').toLowerCase();
            for (const tag of polyTags) {
                if (title.includes(tag)) {
                    keywordMatch = true;
                    break;
                }
            }
        }

        if (keywordMatch && parseFloat(m.volume24 || 0) >= minVol && parseFloat(m.probability || 0) >= minChance) {
            if (m.clobTokenIds && Array.isArray(m.clobTokenIds)) {
                m.clobTokenIds.forEach(token => {
                    filteredTokens.add(token);
                    polyTokenToMarket.set(token, m.id);
                });
            }
        }
    });

    const tokensToSub = [...filteredTokens].filter(t => !polyWsSubscribedTokens.has(t));
    const tokensToUnsub = [...polyWsSubscribedTokens].filter(t => !filteredTokens.has(t));

    if (tokensToSub.length > 0) {
        polyWs.send(JSON.stringify({
            type: "subscribe",
            channels: ["market"],
            tokens: tokensToSub
        }));
        tokensToSub.forEach(t => polyWsSubscribedTokens.add(t));
        // console.log(`POLY: WebSocket subscribed to ${tokensToSub.length} new tokens`);
    }

    if (tokensToUnsub.length > 0) {
        polyWs.send(JSON.stringify({
            type: "unsubscribe",
            channels: ["market"],
            tokens: tokensToUnsub
        }));
        tokensToUnsub.forEach(t => polyWsSubscribedTokens.delete(t));
    }
}

function initPolyWs() {
    if (polyWs && (polyWs.readyState === WebSocket.CONNECTING || polyWs.readyState === WebSocket.OPEN)) return;

    // console.log('POLY: Initializing WebSocket...');
    polyWs = new WebSocket(POLY_WS_URL);

    polyWs.onopen = () => {
        logSystem("POLY: Price WebSocket established.");
        // If we already have filtered data, subscribe
        if (polyMarketsCurrent.length > 0) {
            updatePolyWsSubscriptions(polyMarketsCurrent);
        }
    };

    polyWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data)) {
                data.forEach(msg => handlePolyWsMessage(msg));
            } else {
                handlePolyWsMessage(data);
            }
        } catch (e) { }
    };

    polyWs.onclose = () => {
        // console.warn('POLY: WebSocket disconnected, retrying in 5s...');
        polyWsSubscribedTokens.clear();
        setTimeout(initPolyWs, 5000);
    };

    polyWs.onerror = (e) => {
        // console.error('POLY: WebSocket error', e);
    };
}

function handlePolyWsMessage(msg) {
    // We care about price changes
    if (msg.asset_id && msg.price) {
        const marketId = polyTokenToMarket.get(msg.asset_id);
        if (!marketId) return;

        // Update probability (price is 0-1, convert to %)
        const newProb = (parseFloat(msg.price) * 100).toFixed(0);

        // Update both state arrays
        let changed = false;
        [polyMarketsCurrent, polyMarketsRaw].forEach(list => {
            const market = list.find(m => m.id === marketId);
            if (market && market.probability !== newProb) {
                market.probability = newProb;
                changed = true;
            }
        });

        if (changed) {
            updatePolyLiveUI(marketId, newProb);
        }
    }
}

function updatePolyLiveUI(marketId, newProb) {
    const market = polyMarketsCurrent.find(m => m.id === marketId);
    if (!market) return;

    // 1. Update Ticker (if visible)
    const tickerLinks = document.querySelectorAll(`a[href*="/market/${market.slug}"]`);
    tickerLinks.forEach(link => {
        const probSpan = link.parentElement.querySelector('.poly-prob');
        if (probSpan) {
            const probVal = parseFloat(newProb);
            let pClass = 'poly-yellow';
            let arrow = '−';
            if (probVal >= 60) { pClass = 'poly-green'; arrow = '▲'; }
            else if (probVal < 40) { pClass = 'poly-red'; arrow = '▼'; }

            probSpan.className = `poly-prob ${pClass}`;
            probSpan.innerHTML = `${arrow} ${newProb}%`;
        }
    });

    // 2. Update Table (if visible)
    const tableRows = document.querySelectorAll('.poly-market-table tbody tr');
    tableRows.forEach(row => {
        const link = row.querySelector('a');
        if (link && link.href.includes(market.slug)) {
            const probTd = row.querySelector('.poly-table-prob');
            if (probTd) {
                const probVal = parseFloat(newProb);
                let pClass = 'poly-green';
                if (probVal < 50) pClass = probVal > 30 ? 'poly-yellow' : 'poly-red';

                probTd.className = `poly-table-prob ${pClass}`;
                probTd.textContent = `${newProb}%`;
            }
        }
    });
}
