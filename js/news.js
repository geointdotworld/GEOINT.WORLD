// --- GDELT News Ticker ---

const CACHE_KEY = 'gdelt_news_data';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let newsInterval = null;
let gdeltTags = ['military', 'conflict', 'attack'];
let gdeltNegativeTags = ['jail', 'court', 'trial', 'arrest', 'pop', 'celebrity', 'sports', 'entertainment', 'fashion', 'music'];
let gdeltRawArticles = [];
window.gdeltRawArticles = gdeltRawArticles; // Expose for ui.js
let gdeltTableSearchQuery = '';
let gdeltTimeframe = localStorage.getItem('gdelt_timeframe');
if (!gdeltTimeframe || gdeltTimeframe === '15m' || gdeltTimeframe === '15min') {
    gdeltTimeframe = '1h';
    localStorage.setItem('gdelt_timeframe', '1h');
}

// Table sort state
let gdeltSortState = {
    column: 'seendate',
    direction: 'desc'
};

async function initNewsSystem() {
    console.log('GDELT: initNewsSystem starting...');
    if (typeof logSystem === 'function') {
        logSystem('SYS: News module initializing...');
    }

    // 0. Check settings / toggle state
    const isEnabled = localStorage.getItem('gdelt_enabled') === 'true'; // Default false
    console.log('GDELT: isEnabled =', isEnabled, ', localStorage value =', localStorage.getItem('gdelt_enabled'));

    if (typeof logSystem === 'function' && !isEnabled) {
        logSystem('SYS: News feed currently disabled in settings.');
    }

    // Load saved filter
    const savedFilter = localStorage.getItem('gdelt_filter');
    if (savedFilter) {
        gdeltTags = savedFilter.split(',').filter(s => s.trim());
    } else {
        localStorage.setItem('gdelt_filter', gdeltTags.join(','));
    }

    // Load saved negative filter
    const savedNegFilter = localStorage.getItem('gdelt_neg_filter');
    if (savedNegFilter) {
        gdeltNegativeTags = savedNegFilter.split(',').filter(s => s.trim());
    } else {
        localStorage.setItem('gdelt_neg_filter', gdeltNegativeTags.join(','));
    }

    renderGdeltTags();
    renderGdeltNegativeTags();
    updateGdeltTimeframeUI();
    setupGdeltFilterListeners();
    setupGdeltNegativeFilterListeners();
    setupGdeltTableListeners();
    setupGdeltTimeframeListeners();

    // Set checkbox state if it exists
    if (gdeltToggle) {
        gdeltToggle.checked = isEnabled;
    }

    if (!isEnabled) {
        console.log('GDELT: Disabled, returning early');
        const ticker = document.getElementById('news-ticker-container');
        if (ticker) ticker.style.display = 'none';
        if (typeof updateBottomStack === 'function') updateBottomStack();
        return; // Don't fetch or set interval if disabled
    }

    if (typeof updateBottomStack === 'function') updateBottomStack();

    // 1. Try to load from cache immediately for instant render
    const cached = loadFromCache();
    if (cached) {
        console.log('GDELT: Loaded from cache, articles:', cached.articles?.length);
        gdeltRawArticles = cached.articles;
        window.gdeltRawArticles = gdeltRawArticles; // Keep window reference in sync
        renderTicker(cached.articles);

        // Show 'See news' button if we have data
        const showAllBtn = document.getElementById('gdelt-show-all-btn');
        if (showAllBtn) showAllBtn.style.display = 'block';
    }

    // 2. Fetch fresh data if cache is missing or expired
    if (!cached || (Date.now() - cached.timestamp > CACHE_TTL)) {
        console.log('GDELT: Fetching fresh data...');
        await fetchNewsData();
    } else {
        console.log('GDELT: Using cached data, not fetching');
    }

    // 3. Set interval to keep data fresh
    startNewsCycle();
}

function renderGdeltTags() {
    const tagList = document.getElementById('gdelt-tag-list');
    if (!tagList) return;

    tagList.innerHTML = gdeltTags.map((tag, index) => `
        <div class="poly-tag">
            <span>${tag}</span>
            <span class="poly-tag-remove" onclick="removeGdeltTag(${index})">×</span>
        </div>
    `).join('');
}

window.removeGdeltTag = function (index) {
    gdeltTags.splice(index, 1);
    updateGdeltFilterState();
};

function updateGdeltFilterState() {
    localStorage.setItem('gdelt_filter', gdeltTags.join(','));
    renderGdeltTags();
    fetchNewsData(); // Re-fetch with new tags
}

function setupGdeltFilterListeners() {
    const tagInput = document.getElementById('gdelt-tag-input');
    if (!tagInput) return;

    tagInput.addEventListener('input', (e) => {
        const val = tagInput.value;
        if (val.endsWith(' ') || val.endsWith(',')) {
            const tag = val.slice(0, -1).trim();
            if (tag && !gdeltTags.includes(tag.toLowerCase())) {
                gdeltTags.push(tag.toLowerCase());
                tagInput.value = '';
                updateGdeltFilterState();
            } else if (!tag) {
                tagInput.value = '';
            }
        }
    });

    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const tag = tagInput.value.trim();
            if (tag && !gdeltTags.includes(tag.toLowerCase())) {
                gdeltTags.push(tag.toLowerCase());
                tagInput.value = '';
                updateGdeltFilterState();
            }
        } else if (e.key === 'Backspace' && tagInput.value === '' && gdeltTags.length > 0) {
            gdeltTags.pop();
            updateGdeltFilterState();
        }
    });

    const container = document.getElementById('gdelt-tag-container');
    if (container) {
        container.addEventListener('click', () => tagInput.focus());
    }
}

function renderGdeltNegativeTags() {
    const tagList = document.getElementById('gdelt-neg-tag-list');
    if (!tagList) return;

    tagList.innerHTML = gdeltNegativeTags.map((tag, index) => `
        <div class="poly-tag">
            <span>-${tag}</span>
            <span class="poly-tag-remove" onclick="removeGdeltNegativeTag(${index})">×</span>
        </div>
    `).join('');
}

window.removeGdeltNegativeTag = function (index) {
    gdeltNegativeTags.splice(index, 1);
    updateGdeltNegativeFilterState();
};

function updateGdeltNegativeFilterState() {
    localStorage.setItem('gdelt_neg_filter', gdeltNegativeTags.join(','));
    renderGdeltNegativeTags();
    fetchNewsData(); // Re-fetch with new negative tags
}

function setupGdeltNegativeFilterListeners() {
    const tagInput = document.getElementById('gdelt-neg-tag-input');
    if (!tagInput) return;

    tagInput.addEventListener('input', (e) => {
        const val = tagInput.value;
        if (val.endsWith(' ') || val.endsWith(',')) {
            const tag = val.slice(0, -1).trim();
            if (tag && !gdeltNegativeTags.includes(tag.toLowerCase())) {
                gdeltNegativeTags.push(tag.toLowerCase());
                tagInput.value = '';
                updateGdeltNegativeFilterState();
            } else if (!tag) {
                tagInput.value = '';
            }
        }
    });

    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const tag = tagInput.value.trim();
            if (tag && !gdeltNegativeTags.includes(tag.toLowerCase())) {
                gdeltNegativeTags.push(tag.toLowerCase());
                tagInput.value = '';
                updateGdeltNegativeFilterState();
            }
        } else if (e.key === 'Backspace' && tagInput.value === '' && gdeltNegativeTags.length > 0) {
            gdeltNegativeTags.pop();
            updateGdeltNegativeFilterState();
        }
    });

    const container = document.getElementById('gdelt-neg-tag-container');
    if (container) {
        container.addEventListener('click', () => tagInput.focus());
    }
}


function updateGdeltTimeframeUI() {
    const btns = document.querySelectorAll('.gdelt-time-btn');
    btns.forEach(btn => {
        if (btn.getAttribute('data-time') === gdeltTimeframe) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function setupGdeltTimeframeListeners() {
    const btns = document.querySelectorAll('.gdelt-time-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tf = btn.getAttribute('data-time');
            if (gdeltTimeframe === tf) return;
            gdeltTimeframe = tf;
            localStorage.setItem('gdelt_timeframe', tf);
            updateGdeltTimeframeUI();
            fetchNewsData(); // Re-fetch for new timeframe
        });
    });
}

/**
 * Returns the fully constructed GDELT API URL based on current state
 * If keyword is provided, fetches only for that keyword.
 * Supports custom timeframe via customStart/customEnd (Date objects).
 */
function constructGdeltUrl(singleKeyword = null, customStart = null, customEnd = null) {
    let startStr, endStr;

    if (customStart && customEnd) {
        startStr = formatGdeltDate(customStart);
        endStr = formatGdeltDate(customEnd);
    } else {
        const now = new Date();
        const end = new Date(now);
        let start = new Date(now);
        if (gdeltTimeframe === '1h') start.setUTCHours(now.getUTCHours() - 1);
        else if (gdeltTimeframe === '6h') start.setUTCHours(now.getUTCHours() - 6);
        else if (gdeltTimeframe === '12h') start.setUTCHours(now.getUTCHours() - 12);
        else if (gdeltTimeframe === '24h') start.setUTCHours(now.getUTCHours() - 24);
        else start.setUTCHours(now.getUTCHours() - 1);

        startStr = formatGdeltDate(start);
        endStr = formatGdeltDate(end);
    }

    const baseUrl = "https://api.gdeltproject.org/api/v2/doc/doc";

    let queryTags = '';
    if (singleKeyword) {
        queryTags = singleKeyword;
    } else {
        queryTags = gdeltTags.length > 0 ? (gdeltTags.length > 1 ? `(${gdeltTags.join(' OR ')})` : gdeltTags[0]) : '(military OR conflict OR attack)';
    }

    let exclusionString = "-sourcecountry:IN -sourcecountry:NG";
    if (gdeltNegativeTags.length > 0) {
        const negPart = gdeltNegativeTags.map(t => `-${t}`).join(' ');
        exclusionString += ` ${negPart}`;
    }

    const queryParams = new URLSearchParams({
        query: `${queryTags} sourcelang:English ${exclusionString}`,
        startdatetime: startStr,
        enddatetime: endStr,
        mode: "artlist",
        format: "json",
        maxrecords: "250"
    });

    return `${baseUrl}?${queryParams.toString()}`;
}


function setupGdeltTableListeners() {
    const searchInput = document.getElementById('gdelt-table-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            gdeltTableSearchQuery = e.target.value.toLowerCase().trim();
            renderFullNewsTable(gdeltRawArticles);
        });
    }

    const showAllBtn = document.getElementById('gdelt-show-all-btn');
    if (showAllBtn) {
        showAllBtn.addEventListener('click', () => {
            const tableSide = document.getElementById('gdelt-full-list-modal');
            const analyticsSide = document.getElementById('gdelt-analytics-modal');
            if (tableSide && analyticsSide) {
                tableSide.style.display = 'flex';
                analyticsSide.style.display = 'none';
                renderFullNewsTable(gdeltRawArticles);
            }
        });
    }

    const closeFullBtn = document.getElementById('close-news-full-list-btn');
    if (closeFullBtn) {
        closeFullBtn.addEventListener('click', () => {
            const tableSide = document.getElementById('gdelt-full-list-modal');
            const analyticsSide = document.getElementById('gdelt-analytics-modal');
            if (tableSide && analyticsSide) {
                tableSide.style.display = 'none';
                analyticsSide.style.display = 'flex';
            }
        });
    }

    const fetchBtn = document.getElementById('gdelt-fetch-btn');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', () => {
            fetchNewsData();
        });
    }
}

window.updateGdeltSort = function (column) {
    if (gdeltSortState.column === column) {
        gdeltSortState.direction = gdeltSortState.direction === 'desc' ? 'asc' : 'desc';
    } else {
        gdeltSortState.column = column;
        gdeltSortState.direction = 'desc';
    }

    if (gdeltRawArticles.length > 0) {
        renderFullNewsTable(gdeltRawArticles);
    }
};

function startNewsCycle() {
    if (newsInterval) clearInterval(newsInterval);
    newsInterval = setInterval(fetchNewsData, CACHE_TTL);
}

function stopNewsCycle() {
    if (newsInterval) {
        clearInterval(newsInterval);
        newsInterval = null;
    }
}

// Add toggle listener
if (gdeltToggle) {
    gdeltToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        localStorage.setItem('gdelt_enabled', isEnabled);

        const ticker = document.getElementById('news-ticker-container');

        if (isEnabled) {
            if (ticker) ticker.style.display = 'flex';
            if (typeof updateBottomStack === 'function') updateBottomStack();
            fetchNewsData();
            startNewsCycle();
        } else {
            if (ticker) ticker.style.display = 'none';
            if (typeof updateBottomStack === 'function') updateBottomStack();
            stopNewsCycle();
        }
    });
}

function loadFromCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { console.error("Cache parse error", e); }
    return null;
}

// Helper to format date as YYYYMMDDHHMMSS (using UTC as requested for GDELT)
function formatGdeltDate(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mi = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

async function fetchNewsData() {
    const fetchBtn = document.getElementById('gdelt-fetch-btn');
    const consoleWrapper = document.getElementById('gdelt-console-wrapper');
    const showAllBtn = document.getElementById('gdelt-show-all-btn');
    const headerCount = document.getElementById('gdelt-header-count'); // Count element

    if (fetchBtn) {
        fetchBtn.innerText = 'FETCHING DATA...';
        fetchBtn.disabled = true;
        fetchBtn.style.opacity = '0.5';
    }

    if (headerCount) headerCount.innerText = ''; // Clear previous count

    // STATE START: Show console, Hide button
    if (consoleWrapper) consoleWrapper.style.display = 'block';
    if (showAllBtn) showAllBtn.style.setProperty('display', 'none', 'important');

    try {
        const tagsToFetch = gdeltTags.length > 0 ? gdeltTags : ['military'];

        // STOP CHECK: If disabled
        if (localStorage.getItem('gdelt_enabled') === 'false') {
            updateNewsLoadingStatus('Feed Disabled');
            return;
        }

        updateNewsLoadingStatus(`Initializing fetch for ${tagsToFetch.length} keywords...`);

        // Get global timeframe dates
        const now = new Date();
        const end = new Date(now);
        let start = new Date(now);
        if (gdeltTimeframe === '1h') start.setUTCHours(now.getUTCHours() - 1);
        else if (gdeltTimeframe === '6h') start.setUTCHours(now.getUTCHours() - 6);
        else if (gdeltTimeframe === '12h') start.setUTCHours(now.getUTCHours() - 12);
        else if (gdeltTimeframe === '24h') start.setUTCHours(now.getUTCHours() - 24);
        else start.setUTCHours(now.getUTCHours() - 1);

        // Initialize Console
        const consoleOut = document.getElementById('gdelt-console-output');
        if (consoleOut) {
            consoleOut.innerHTML = ``; // Clear previous output
        }

        // Sequential fetching for each keyword
        const allArticles = [];
        let keywordIndex = 0;
        let runningTotal = 0; // Track loaded articles for status

        for (const tag of tagsToFetch) {
            // STOP CHECK: If disabled mid-loop
            if (localStorage.getItem('gdelt_enabled') === 'false') {
                console.log('GDELT: Fetch halted by user.');
                break;
            }

            // Update UI status
            const searchTag = tag.toUpperCase();
            updateNewsLoadingStatus(`LOADED: ${runningTotal} | SEARCHING: ${searchTag}`);

            if (consoleOut) {
                // Remove leading newline for the very first item to exclude ANY whitespace gap
                const leadingNewline = keywordIndex === 0 ? '' : '\n';
                const separator = `${leadingNewline}▶ FETCHING KEYWORD: ${searchTag}\n──────────────────────────────`;
                logToGdeltConsole(separator); // Use hacker console
            }

            const articles = await fetchKeywordRecursive(tag, start, end, 0);
            // Attach keyword for sorting
            articles.forEach(a => a.keyword = tag);
            allArticles.push(...articles);
            runningTotal += articles.length;
            keywordIndex++;
        }


        // Deduplication using URL
        const uniqueArticles = [];
        const seenUrls = new Set();

        allArticles.forEach(article => {
            if (!article.url || seenUrls.has(article.url)) return;
            seenUrls.add(article.url);
            uniqueArticles.push(article);
        });

        console.log(`GDELT: Aggregation complete. ${allArticles.length} total, ${uniqueArticles.length} unique.`);

        if (uniqueArticles.length > 0) {
            gdeltRawArticles = uniqueArticles;
            window.gdeltRawArticles = gdeltRawArticles; // Keep window reference in sync

            // Update Header Count
            const headerCount = document.getElementById('gdelt-header-count');
            if (headerCount) headerCount.innerText = `(${uniqueArticles.length})`;

            // Save to cache
            try {
                const cacheObj = { timestamp: Date.now(), articles: gdeltRawArticles };
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheObj));
            } catch (e) {
                console.warn("GDELT: Failed to cache to sessionStorage", e);
            }

            // Render
            renderTicker(gdeltRawArticles);

            // Re-render table if open
            const tableSide = document.getElementById('gdelt-full-list-modal');
            if (tableSide && tableSide.style.display !== 'none') {
                renderFullNewsTable(gdeltRawArticles);
            }

            // Show 'See markets' button on mobile if we have data
            const showAllBtn = document.getElementById('gdelt-show-all-btn');
            if (showAllBtn) showAllBtn.style.display = 'block';

            if (typeof logSystem === 'function') {
                logSystem(`NET: GDELT aggregated ${uniqueArticles.length} articles.`);
            }
        } else {
            console.warn('GDELT: No articles returned for any keyword');
            updateNewsLoadingStatus('No recent articles found.');
        }
    } catch (error) {
        console.error('GDELT: ERROR in fetchNewsData:', error);
        if (typeof logSystem === 'function') {
            logSystem(`ERR: GDELT aggregation failed - ${error.message}`);
        }

        const container = document.getElementById('news-ticker-content');
        if (container && !container.innerHTML.includes('news-item')) {
            container.innerHTML = `<span class="news-item item-error">Unable to establish GDELT uplink: ${error.message}</span>`;
        }
    } finally {
        // IMMEDIATE HIDE: Stop typing and clear queue
        GdeltHackerConsole.stop();

        // STATE END: Hide console
        const consoleWrapper = document.getElementById('gdelt-console-wrapper');
        if (consoleWrapper) consoleWrapper.style.display = 'none';

        if (fetchBtn) {
            fetchBtn.innerText = 'FETCH LATEST DATA';
            fetchBtn.disabled = false;
            fetchBtn.style.opacity = '1';
        }
    }
}

async function fetchKeywordRecursive(tag, startTime, endTime, depth, label = "Attempt", isLastChild = true, parentPrefix = "") {
    // Safety depth limit
    const MAX_SPLIT_DEPTH = 100;
    const MIN_TIME_WINDOW = 2 * 60 * 1000; // 2 minutes

    // ASCII Tree Logging Setup
    // If depth 0, we just show "│" then the branch.
    // Ideally:
    // Depth 0:
    // │
    // ├─ Attempt: ...
    //
    // Depth 1 (Split):
    // │  └─ Result: ... -> Splitting
    // │
    // └─ Split into two halves
    //    │
    //    ├─ Half 1: ...
    //
    // This requires passing down the prefix string.

    let currentPrefix = parentPrefix;
    if (depth > 0) {
        currentPrefix += isLastChild ? "   " : "│  ";
    }

    // For the current line itself:
    // If depth 0: parentPrefix is empty. default to "├─ " or similar?
    // User example start:
    // Initial Query: ...
    // │
    // ├─ Attempt: ...

    let branchSymbol = isLastChild ? "└─ " : "├─ ";
    if (depth === 0) {
        branchSymbol = "├─ "; // Root is always a 'middle' child visually of the query header
        currentPrefix = "│  "; // The children of root get this
    }

    const myIndent = parentPrefix + branchSymbol;

    // Time window safety checking
    if ((endTime.getTime() - startTime.getTime()) < MIN_TIME_WINDOW) {
        logToGdeltConsole(`${myIndent}${label}: [SKIP] Window < 2m`);
        return [];
    }

    const targetUrl = constructGdeltUrl(tag, startTime, endTime);

    // Log Request
    // Format: "Half 1: 00:00 -> 11:59"
    logToGdeltConsole(`${myIndent}${label}: ${formatReadableTime(startTime)} -> ${formatReadableTime(endTime)}`);

    console.log(`GDELT: [Depth ${depth}] [${label}] ${tag} | ${formatGdeltDate(startTime)} - ${formatGdeltDate(endTime)}`);

    // STOP CHECK BEFORE NETWORK CALL implies recursion will stop too
    if (localStorage.getItem('gdelt_enabled') === 'false') {
        return [];
    }

    try {
        const response = await fetchWithProxyChain(targetUrl);
        if (!response.ok) {
            logToGdeltConsole(`${currentPrefix}└─ [ERROR] HTTP ${response.status}`);
            return [];
        }
        const data = await response.json();
        const articles = data.articles || [];
        const count = articles.length;

        // If GDELT returns precisely 250 records, it's likely capped.
        if (count >= 250 && depth < MAX_SPLIT_DEPTH) {
            // Log Result Capped
            logToGdeltConsole(`${currentPrefix}├─ Result: ${count} articles (CAPPED)`);
            logToGdeltConsole(`${currentPrefix}│`);

            // Log Split Action
            logToGdeltConsole(`${currentPrefix}└─ Split ${label === 'Attempt' ? 'into two halves' : label + ' again'}`);
            logToGdeltConsole(`${currentPrefix}   │`);

            const midTime = new Date(startTime.getTime() + (endTime.getTime() - startTime.getTime()) / 2);

            // Generate Sub-Labels
            // Logic:
            // - Attempt -> Half 1, Half 2
            // - Half 1 -> Half 1A, Half 1B
            // - Half 1A -> Half 1A-i, Half 1A-ii
            // - Half 1A-i -> Half 1A-i-1, Half 1A-i-2 (fallback)

            let label1, label2;
            if (label === "Attempt") {
                label1 = "Half 1";
                label2 = "Half 2";
            } else if (label.includes("Half")) {
                const suffix = label.replace("Half ", ""); // e.g. "1", "2", "1A"
                // Check last char
                if (/^\d+$/.test(suffix)) {
                    // Ends in number (1, 2), add letters
                    label1 = `Half ${suffix}A`;
                    label2 = `Half ${suffix}B`;
                } else if (/[A-Z]$/.test(suffix)) {
                    // Ends in letter (A, B), add roman numerals
                    label1 = `Half ${suffix}-i`;
                    label2 = `Half ${suffix}-ii`;
                } else {
                    // Fallback
                    label1 = `${label}-1`;
                    label2 = `${label}-2`;
                }
            } else {
                label1 = `${label}-1`;
                label2 = `${label}-2`;
            }

            // New prefix for children of the split
            // The split line was: parentPrefix + "   └─ Split..."
            // So children need: parentPrefix + "      "
            const childPrefix = currentPrefix + "   ";

            // Fetch both halves in parallel (sequential loop handles root, recursion is parallel)
            const [half1, half2] = await Promise.all([
                fetchKeywordRecursive(tag, startTime, midTime, depth + 1, label1, false, childPrefix),
                fetchKeywordRecursive(tag, midTime, endTime, depth + 1, label2, true, childPrefix)
            ]);

            return [...half1, ...half2];
        } else {
            // Not capped - Merge into single line as requested
            const status = count >= 250 ? "(CAPPED - MAX DEPTH)" : "(under 250)";
            logToGdeltConsole(`${currentPrefix}└─ Result: ${count} articles ${status}`);
            return articles;
        }

    } catch (e) {
        console.error(`GDELT: Keyword [${tag}] fetch failed at depth ${depth}:`, e);
        logToGdeltConsole(`${currentPrefix}└─ [FAIL] ${e.message}`);
        return [];
    }
}

const GdeltHackerConsole = {
    queue: [],
    isTyping: false,
    el: null,
    resolveCompletion: null,

    init() {
        this.el = document.getElementById('gdelt-console-output');
        this.queue = [];
        this.isTyping = false;
    },

    log(msg, isWarning = false) {
        if (!this.el) this.init();
        if (!this.el) return;
        this.queue.push({ text: msg, isWarning });
        this.processQueue();
    },

    async waitForCompletion() {
        if (this.queue.length === 0 && !this.isTyping) return Promise.resolve();
        return new Promise(resolve => {
            this.resolveCompletion = resolve;
        });
    },

    stop() {
        this.queue = [];
        this.isTyping = false;
        if (this.el) this.el.innerHTML = '';
    },

    processQueue() {
        if (this.isTyping || this.queue.length === 0) {
            if (this.queue.length === 0 && !this.isTyping && this.resolveCompletion) {
                this.resolveCompletion();
                this.resolveCompletion = null;
            }
            return;
        }

        this.isTyping = true;
        const item = this.queue.shift();
        // Trim trailing whitespace to prevent empty space at bottom
        if (item.text) item.text = item.text.trimEnd();

        const span = document.createElement('div');
        if (item.isWarning) span.style.color = '#ffcc00';
        // Ensure exact monospace alignment by preserving whitespace
        span.style.whiteSpace = 'pre-wrap';
        this.el.appendChild(span);

        let i = 0;
        const typeChar = () => {
            // Check if stopped mid-typing
            if (!this.el || this.queue === null) return;

            // TYPE FASTER: Process 2 chars at once
            let charsToAdd = "";
            let charsToProcess = 2;

            while (charsToProcess > 0 && i < item.text.length) {
                charsToAdd += item.text.charAt(i);
                i++;
                charsToProcess--;
            }

            if (charsToAdd.length > 0) {
                span.textContent += charsToAdd;
                this.el.parentElement.scrollTop = this.el.parentElement.scrollHeight;

                if (i < item.text.length) {
                    // Ultra-fast "hacker" speed (0-2ms) - occasionally pause for realism
                    // Reduced pause probability and duration
                    const delay = Math.random() > 0.98 ? 10 : 1;
                    setTimeout(typeChar, delay);
                } else {
                    this.isTyping = false;
                    this.processQueue();
                }
            } else {
                this.isTyping = false;
                this.processQueue();
            }
        };
        typeChar();
    }
};

// Wrapper compatibility
function logToGdeltConsole(msg, isWarning = false) {
    GdeltHackerConsole.log(msg, isWarning);
}

function formatReadableTime(date) {
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function renderTicker(articles) {
    const container = document.getElementById('news-ticker-content');
    if (!container) return; // Safely exit if on index.html (headless mode)

    let html = '';
    const seenTitles = new Set();

    articles.forEach(article => {
        const title = (article.title || '').trim();
        if (!title || seenTitles.has(title)) return;
        seenTitles.add(title);

        const country = article.sourcecountry ? `[${article.sourcecountry}]` : '';
        const url = article.url || '#';

        html += `<span class="news-box"><span class="news-country">${country}</span> <a href="${url}" target="_blank" rel="noopener" class="news-link">${title}</a></span>`;
    });

    // Reset animation and force reflow
    container.style.animation = 'none';
    void container.offsetWidth;

    // Duplicate content for seamless scrolling
    container.innerHTML = html + html;

    // Trigger animation start
    tryStartTickerAnimation();
}

/**
 * Robustly renders the full news table with search filtering
 */
async function renderFullNewsTable(articles) {
    const container = document.getElementById('gdelt-table-container');
    if (!container) return;

    // Show loading spinner if no data yet
    if (!articles || articles.length === 0) {
        container.innerHTML = `
            <div class="poly-loader-container">
                <div class="poly-loader"></div>
                <div class="poly-loader-text">SCANNING GLOBAL NEWS...</div>
            </div>
        `;
        return;
    }

    let displayArticles = [...articles];

    // Apply Live Search Query
    if (gdeltTableSearchQuery) {
        displayArticles = displayArticles.filter(a =>
            (a.title || '').toLowerCase().includes(gdeltTableSearchQuery) ||
            (a.sourcecountry || '').toLowerCase().includes(gdeltTableSearchQuery) ||
            (a.domain || '').toLowerCase().includes(gdeltTableSearchQuery)
        );
    }

    // Apply Sorting
    displayArticles.sort((a, b) => {
        let valA = (a[gdeltSortState.column] || '').toString().toLowerCase();
        let valB = (b[gdeltSortState.column] || '').toString().toLowerCase();

        // Specific handling for dates (ISO-ish strings from GDELT: 20260115T...)
        if (gdeltSortState.column === 'seendate') {
            // These are lexicographically sortable as strings, but let's be explicit
            if (gdeltSortState.direction === 'asc') return valA.localeCompare(valB);
            return valB.localeCompare(valA);
        }

        if (gdeltSortState.direction === 'asc') return valA.localeCompare(valB);
        return valB.localeCompare(valA);
    });

    const getArrow = (col) => {
        if (gdeltSortState.column !== col) return '';
        const symbol = gdeltSortState.direction === 'desc' ? '▲' : '▼';
        return `<span class="poly-sort-arrow">${symbol}</span>`;
    };

    let html = `
        <table class="poly-market-table">
            <thead>
                <tr>
                    <th style="min-width: 300px; cursor: pointer;" onclick="updateGdeltSort('title')">NEWS HEADLINE (${displayArticles.length})${getArrow('title')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updateGdeltSort('keyword')">KEYWORD${getArrow('keyword')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updateGdeltSort('domain')">SOURCE${getArrow('domain')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updateGdeltSort('sourcecountry')">COUNTRY${getArrow('sourcecountry')}</th>
                    <th style="text-align: center; cursor: pointer;" onclick="updateGdeltSort('seendate')">DATE${getArrow('seendate')}</th>
                </tr>
            </thead>
            <tbody>
    `;

    displayArticles.forEach(a => {
        const title = (a.title || 'Untitled').trim();
        const url = a.url || '#';
        const source = a.domain || 'Unknown';
        const country = a.sourcecountry || 'N/A';
        const dateRaw = a.seendate || '';
        const keyword = (a.keyword || '').toUpperCase();
        let dateStr = '—';

        if (dateRaw) {
            // GDELT date format: 20260115T150000Z or 20260115150000
            try {
                // regex to parse YYYYMMDDTHHMMSSZ or YYYYMMDDHHMMSS
                const match = dateRaw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);

                if (match) {
                    // improvements: construct explicit ISO string to ensure consistent parsing
                    const isoString = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
                    let dateObj = new Date(isoString);

                    // HEURISTIC: If browser reports UTC (offset 0), assume user is PST (offset 480) 
                    // because they explicitly complained about it showing GMT/2pm instead of 8am.
                    const sysOffset = new Date().getTimezoneOffset();
                    if (sysOffset === 0) {
                        // Shift time by -8 hours (PST) purely for display purposes
                        // 14:00 UTC -> 6:00 AM PST
                        dateObj = new Date(dateObj.getTime() - (8 * 60 * 60 * 1000));
                    }

                    // Format to local time (now shifted if needed)
                    // Remove 'timeZoneName' to avoid "GMT" label which confused the user
                    const localDate = dateObj.toLocaleDateString();
                    const localTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    dateStr = `${localDate} ${localTime}`;
                } else {
                    dateStr = dateRaw; // Fallback
                }
            } catch (e) { }
        }

        html += `
            <tr>
                <td><a href="${url}" target="_blank" rel="noopener" class="poly-table-title">${title}</a></td>
                <td style="text-align: center; color: #ff3333; font-weight: bold;">${keyword}</td>
                <td style="text-align: center; color: #888;">${source}</td>
                <td style="text-align: center; color: #ff6800; font-weight: bold;">${country}</td>
                <td style="text-align: center; color: #888; font-size: 11px;">${dateStr}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

/**
 * Robustly starts the ticker animation, retrying if dimensions aren't ready (e.g. preloading)
 */
function tryStartTickerAnimation(retryCount = 0) {
    const container = document.getElementById('news-ticker-content');
    if (!container) return;

    // If page is hidden, wait for visibility (important for preloading)
    if (document.hidden) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) tryStartTickerAnimation();
        }, { once: true });
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const fullWidth = container.scrollWidth;

            // If width is 0, browser hasn't laid it out yet. Retry.
            if (fullWidth <= 0) {
                if (retryCount < 10) {
                    setTimeout(() => tryStartTickerAnimation(retryCount + 1), 100);
                }
                return;
            }

            // GUARD: Do not scroll if only a single item (like "Loading..." or error)
            // or if the content is narrower than the actual container.
            const wrapper = document.getElementById('news-ticker-wrapper');
            if (container.children.length <= 1 || fullWidth / 2 <= (wrapper ? wrapper.offsetWidth : 1000)) {
                container.style.animation = 'none';
                container.style.transform = 'none';
                return;
            }

            const scrollSpeed = 50;
            const duration = (fullWidth / 2) / scrollSpeed;

            // Apply dynamic duration and restart animation
            container.style.animation = `newsTicker ${duration}s linear infinite`;
        });
    });
}

function updateNewsLoadingStatus(msg) {
    const container = document.getElementById('news-ticker-content');
    if (container) {
        // Use news-box for orange accent, matching GDELT theme
        container.style.animation = 'none';
        container.style.transform = 'none';
        container.innerHTML = `<div class="news-box"><span class="news-item" style="color: #888; text-transform: uppercase;">${msg}</span></div>`;
    }
}

// Start
document.addEventListener('DOMContentLoaded', initNewsSystem);
// Handle visibility changes globally to ensure animation is active when user returns
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tryStartTickerAnimation();
});
