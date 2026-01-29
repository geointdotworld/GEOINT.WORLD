// LIVE FEED SCANNING... - lazily loaded
// Depends on globals: solanaWeb3, Toast (window.Toast), logSystem (optional)
// Uses: PHP_PROXY, PROXY_SERVICES, SOLANA_RPCS from globals.js

const el = id => document.getElementById(id);
const log = msg => (window.logSystem ? window.logSystem(msg) : console.log(msg));
const Toast = window.Toast;

// ========= Shared RPC Helper with Proxy Chain =========
// Priority: 1) Third-party CORS proxies, 2) Direct RPC
const RPC_TIMEOUT = 12000;
let activeRpcRoute = null; // Cache the working route { type: 'proxy'|'direct', url: string, endpoint: string, proxyName: string }

async function rpcWithProxyChain(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

    // Config
    const rpcs = ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'];

    // Third-party CORS proxies
    const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
        { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' }
    ];

    const fetchWithTimeout = (url, opts) => Promise.race([
        fetch(url, opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT))
    ]);

    // --- STRATEGY 0: Try Sticky Route (if exists) ---
    if (activeRpcRoute) {
        try {
            const r = await fetchWithTimeout(activeRpcRoute.url, fetchOpts);
            if (r.ok) {
                const d = await r.json();
                if (d.result !== undefined) return d.result;
            }
            console.warn(`RPC: Sticky route failed, invalidating...`);
            activeRpcRoute = null;
        } catch (e) {
            activeRpcRoute = null;
        }
    }

    // --- STRATEGY 1: Third-party Proxies ---
    for (const proxy of thirdPartyProxies) {
        for (const ep of rpcs) {
            try {
                const proxiedUrl = proxy.url + encodeURIComponent(ep);
                const r = await fetchWithTimeout(proxiedUrl, fetchOpts);
                if (r.ok) {
                    const d = await r.json();
                    if (d.result !== undefined) {
                        log(`SOL: RPC via ${proxy.name.toUpperCase()}`);
                        activeRpcRoute = { type: 'proxy', url: proxiedUrl, endpoint: ep, proxyName: proxy.name };
                        return d.result;
                    }
                }
            } catch (e) { }
        }
    }

    // --- STRATEGY 2: Direct ---
    for (const ep of rpcs) {
        try {
            const r = await fetchWithTimeout(ep, fetchOpts);
            if (r.ok) {
                const d = await r.json();
                if (d.result !== undefined) {
                    log(`SOL: RPC via DIRECT`);
                    activeRpcRoute = { type: 'direct', url: ep, endpoint: ep };
                    return d.result;
                }
            }
        } catch (e) { }
    }

    throw new Error('All RPC methods failed');
}

// ========= Memo Feed =========
const MemoFeed = {
    isLoading: false,
    isInitialized: false,
    MEMO_PROGRAM: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
    PDA_ADDRESS: 'HQvMbrAMGjMkcobUV56MN9zaryPo9NarLddrEfc1wmLP',
    TARGET_SIGNATURES: 2000, // Max signatures to fetch
    CHUNK_SIZE: 1000, // Max per RPC call

    async rpc(method, params) {
        return rpcWithProxyChain(method, params);
    },

    short(s) { return s ? s.slice(0, 4) + '...' + s.slice(-4) : ''; },
    esc(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); },

    timeAgo(ts) {
        if (!ts) return 'just now';
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hr${hr > 1 ? 's' : ''} ago`;
        const dy = Math.floor(hr / 24);
        return `${dy} day${dy > 1 ? 's' : ''} ago`;
    },







    // Unified Locate Handler
    locate(encodedJson, signature, timestamp, timeLabel) {
        try {
            let data = JSON.parse(decodeURIComponent(encodedJson));
            console.log('LOCATE: Raw parsed data:', data);

            // 1. Flatten raw data (critical for popup display)
            if (data.raw) {
                try {
                    const rawParsed = typeof data.raw === 'string' ? JSON.parse(data.raw) : data.raw;
                    data = { ...data, ...rawParsed };

                    // Explicitly cast numeric types for popup handlers
                    if (data.mag) data.mag = parseFloat(data.mag);
                    if (data.depth) data.depth = parseFloat(data.depth);
                    if (data.time) data.time = Number(data.time);

                    console.log('LOCATE: Flattened & Sanitized:', data);
                } catch (e) {
                    console.warn('LOCATE: Failed to parse raw data', e);
                }
            }

            // Fallback to transaction time if data.time is missing
            if (!data.time && timestamp) {
                data.time = Number(timestamp);
            }

            // Inject signature and mark as from live feed (to hide send button)
            data.signature = signature;
            data._fromLiveFeed = true;
            if (timeLabel) data._forceTimeLabel = timeLabel;

            if (data.lat && data.lng) {
                const coords = [parseFloat(data.lng), parseFloat(data.lat)];
                ModalManager.close('live-feed-modal');

                // Delegate to Centralized Registry
                if (window.InscriptionRegistry) {
                    window.InscriptionRegistry.handle(data, coords);
                } else {
                    console.error("InscriptionRegistry not found!");
                }
            } else {
                alert('No coordinates found in this inscription');
            }
        } catch (e) {
            console.error('Locate error:', e);
            alert('Could not parse location data');
        }
    },

    /**
     * Bulk fetch signatures using cursor-based pagination
     * Fetches up to TARGET_SIGNATURES in CHUNK_SIZE batches
     */
    renderMemos(memos) {
        const list = el('memo-feed-list');
        list.innerHTML = memos.map(m => `
            <div class="memo-wrapper">
                <div class="memo-author" style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <a href="https://solscan.io/account/${m.author}" target="_blank" rel="noopener">${this.short(m.author)}</a>
                        <span style="color:#888; margin-left:8px; font-size:11px;">${this.timeAgo(m.time)}</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="memo-scope-btn" title="Locate" onclick="MemoFeed.locate('${encodeURIComponent(m.txt)}', '${m.sig}', ${m.time}, '${this.timeAgo(m.time)}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </button>
                        <button class="memo-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(m.txt)}')).then(function(){this.style.color='#ff6800';setTimeout(()=>{this.style.color=''},1000)}.bind(this))" title="Copy Text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="memo-item">
                    <div class="memo-content">${this.esc(m.txt)}</div>
                    <div class="memo-footer">
                        <span>${new Date(m.time).toLocaleString()}</span>
                        <a href="https://solscan.io/tx/${m.sig}" target="_blank" rel="noopener" class="memo-sig">${this.short(m.sig)}</a>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // NEW: Render a single memo immediately (prepend to feed) with fade-in animation
    renderSingleMemo(memo) {
        const list = el('memo-feed-list');

        // Remove loader if still showing
        const loader = list.querySelector('.poly-loader-container');
        if (loader) loader.remove();

        // Remove placeholder if showing
        const placeholder = list.querySelector('.feed-placeholder');
        if (placeholder) placeholder.remove();

        const memoHtml = `
            <div class="memo-wrapper">
                <div class="memo-author" style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <a href="https://solscan.io/account/${memo.author}" target="_blank" rel="noopener">${this.short(memo.author)}</a>
                        <span style="color:#888; margin-left:8px; font-size:11px;">${this.timeAgo(memo.time)}</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="memo-scope-btn" title="Locate" onclick="MemoFeed.locate('${encodeURIComponent(memo.txt)}', '${memo.sig}', ${memo.time}, '${this.timeAgo(memo.time)}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                        </button>
                        <button class="memo-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(memo.txt)}')).then(function(){this.style.color='#ff6800';setTimeout(()=>this.style.color='',1000)}.bind(this))" title="Copy Text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="memo-item">
                    <div class="memo-content">${this.esc(memo.txt)}</div>
                    <div class="memo-footer">
                        <span>${new Date(memo.time).toLocaleString()}</span>
                        <a href="https://solscan.io/tx/${memo.sig}" target="_blank" rel="noopener" class="memo-sig">${this.short(memo.sig)}</a>
                    </div>
                </div>
            </div>
        `;

        // PREPEND (newest first) with fade-in animation
        const wrapper = document.createElement('div');
        wrapper.innerHTML = memoHtml;
        const memoElement = wrapper.firstElementChild;

        // Start invisible
        memoElement.style.opacity = '0';
        memoElement.style.transform = 'translateY(-10px)';
        memoElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        list.insertBefore(memoElement, list.firstChild);

        // Trigger fade-in animation
        setTimeout(() => {
            memoElement.style.opacity = '1';
            memoElement.style.transform = 'translateY(0)';
        }, 10);
    },

    /**
     * Helper: Extract memo text and author from a parsed transaction object
     * @param {object} tx - The JSON parsed transaction result
     * @param {string} signature - The transaction signature
     */
    extractMemoFromTx(tx, signature) {
        if (!tx) return null;

        try {
            const instructions = tx?.transaction?.message?.instructions || [];
            const innerInstructions = tx?.meta?.innerInstructions?.flatMap(i => i.instructions) || [];
            const allInstructions = [...instructions, ...innerInstructions];

            // Look for memo in all instructions
            const ix = allInstructions.find(i =>
                i.programId === this.MEMO_PROGRAM ||
                i.program === 'spl-memo' ||
                i.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
            );

            if (!ix) return null;

            let c = null;
            // Handle parsed format (program: 'spl-memo')
            if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') {
                c = ix.parsed;
            }
            // Handle raw format with programId
            else if (ix.data) {
                try {
                    c = new TextDecoder().decode(Uint8Array.from(atob(ix.data), x => x.charCodeAt(0)));
                } catch (e) { }
            }

            if (typeof c === 'string') c = c.replace(/\0/g, '').trim();

            if (c && c.length > 0) {
                const accountKeys = tx?.transaction?.message?.accountKeys || [];
                const author = accountKeys.find(k => k.signer)?.pubkey || accountKeys[0]?.pubkey || accountKeys[0] || 'Unknown';
                return { sig: signature, txt: c, time: (tx.blockTime || Date.now() / 1000) * 1000, author };
            }
        } catch (e) {
            console.warn(`Error parsing tx ${signature}:`, e);
        }
        return null;
    },

    async load(retryCount = 0) {
        if (this.isLoading && retryCount === 0) {
            console.log('SOL: Live Feed skipping redundant fetch (already loading).');
            return;
        }
        this.isLoading = true;
        const list = el('memo-feed-list'), scanning = el('feed-scanning');
        const MAX_MEMOS = 500;
        const MAX_RETRIES = 3;

        // 1. Load Cache & Build Index
        let cachedMemos = [];
        const cachedRaw = localStorage.getItem('cachedMemos');
        const cachedPDA = localStorage.getItem('cachedPDA');
        const knownSigs = new Set();

        // CACHE INVALIDATION: If PDA changed, wipe cache
        if (cachedPDA !== this.PDA_ADDRESS) {
            console.log('SOL: PDA changed. Clearing cache.');
            localStorage.removeItem('cachedMemos');
            localStorage.setItem('cachedPDA', this.PDA_ADDRESS);
            // cachedMemos remains empty []
        }
        else if (cachedRaw) {
            try {
                cachedMemos = JSON.parse(cachedRaw);
                if (Array.isArray(cachedMemos)) {
                    cachedMemos.forEach(m => knownSigs.add(m.sig));
                    this.renderMemos(cachedMemos); // Show stale data immediately
                } else {
                    cachedMemos = [];
                }
            } catch (e) {
                console.warn('Cache parse error', e);
                cachedMemos = [];
            }
        }

        const SPINNER_HTML = '<span class="live-feed-spinner"></span>';

        // UI State
        if (cachedMemos.length === 0) {
            scanning.textContent = '';
            if (retryCount === 0) {
                list.innerHTML = `
                    <div class="poly-loader-container" style="height: 100px;">
                        <div class="poly-loader"></div>
                    </div>
                `;
            }
        } else {
            scanning.innerHTML = `| ${cachedMemos.length} MEMOS (SYNCING...${SPINNER_HTML})`;
        }

        try {
            let before = null;
            let newMemos = [];
            let pageCount = 0;
            let hitKnownHistory = false;
            let totalProcessed = 0;

            log(`SOL: Smart Sync started. Retry: ${retryCount}. Known signatures: ${knownSigs.size}`);

            // PAGINATION LOOP
            while (newMemos.length < MAX_MEMOS && !hitKnownHistory) {
                pageCount++;
                scanning.innerHTML = `SYNCING [${newMemos.length}]${SPINNER_HTML}`;

                // 1. Fetch Signatures
                const sigParams = { limit: this.CHUNK_SIZE, commitment: 'confirmed' };
                if (before) sigParams.before = before;

                const batchSigs = await this.rpc('getSignaturesForAddress', [this.PDA_ADDRESS, sigParams]);

                if (!batchSigs || batchSigs.length === 0) {
                    console.log('SOL: End of history reached');
                    break;
                }

                // 2. Filter & Check Overlap
                let signaturesToProcess = [];
                for (const s of batchSigs) {
                    if (s.err) continue; // Skip failed txs

                    if (knownSigs.has(s.signature)) {
                        console.log(`SOL: Found known signature ${this.short(s.signature)} - OPTIMIZATION TRIGGERED. Stopping fetch.`);
                        hitKnownHistory = true;
                        break; // Stop collecting signatures from this batch
                    }
                    signaturesToProcess.push(s);
                }

                if (signaturesToProcess.length === 0 && hitKnownHistory) {
                    break; // Exact overlap start
                }

                // 3. Process New Transactions (REAL-TIME)
                console.log(`SOL: Processing ${signaturesToProcess.length} new sigs (Page ${pageCount})...`);

                // Reverse to process oldest-first, so prepending puts newest at top
                signaturesToProcess.reverse();

                // Process sequentially to show results in real-time
                for (const s of signaturesToProcess) {
                    try {
                        // Fetch transaction
                        const tx = await this.rpc('getTransaction', [s.signature, {
                            encoding: 'jsonParsed',
                            maxSupportedTransactionVersion: 0,
                            commitment: 'confirmed'
                        }]);

                        // Extract memo
                        const memo = this.extractMemoFromTx(tx, s.signature);

                        if (memo) {
                            // ✨ RENDER IMMEDIATELY
                            this.renderSingleMemo(memo);
                            newMemos.push(memo);

                            // Update counter in real-time
                            scanning.innerHTML = `SYNCING [${newMemos.length}]${SPINNER_HTML}`;

                            if (newMemos.length >= MAX_MEMOS) break;
                        }

                    } catch (err) {
                        console.warn(`Failed to process ${this.short(s.signature)}:`, err.message);
                    }
                }

                // Prepare next cursor (if we didn't hit history)
                if (!hitKnownHistory) {
                    before = batchSigs[batchSigs.length - 1].signature;
                }

                // Safety: break if no progress to avoid inf loops
                if (batchSigs.length < this.CHUNK_SIZE) break;
            }

            // 4. Merge & Save
            const finalMemos = [...newMemos, ...cachedMemos];

            // Deduplicate logic (integrity check)
            const uniqueMap = new Map();
            finalMemos.forEach(m => uniqueMap.set(m.sig, m));
            const uniqueMemos = Array.from(uniqueMap.values());

            // Sort & Trim
            uniqueMemos.sort((a, b) => b.time - a.time);
            const trimmedMemos = uniqueMemos.slice(0, MAX_MEMOS);

            log(`SOL: Sync complete. +${newMemos.length} new, ${trimmedMemos.length} total.`);

            this.renderMemos(trimmedMemos);
            localStorage.setItem('cachedMemos', JSON.stringify(trimmedMemos));
            scanning.textContent = `| ${trimmedMemos.length} MEMOS`;

            if (trimmedMemos.length === 0) {
                list.innerHTML = '<div class="feed-placeholder">No memos found.</div>';
                scanning.textContent = '| 0 MEMOS';
            }
            this.isLoading = false;

        } catch (e) {
            console.error(`Memo feed error (Attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, e);

            if (retryCount < MAX_RETRIES) {
                const backoff = (retryCount + 1) * 2000;
                scanning.textContent = `Retrying in ${backoff / 1000}s...`;

                if (cachedMemos.length === 0) {
                    list.innerHTML = `
                        <div class="poly-loader-container" style="height: 100px;">
                            <div class="poly-loader"></div>
                            <div class="poly-loader-text">CONNECTION FAILED. RETRYING (${retryCount + 1})...</div>
                        </div>
                    `;
                }

                setTimeout(() => this.load(retryCount + 1), backoff);
                return;
            }

            scanning.textContent = 'Connection Error';
            if (cachedMemos.length === 0) {
                list.innerHTML = `
                    <div class="feed-error">
                        <div style="margin-bottom:10px; color:#ff3333;">CONNECTION FAILED</div>
                        <div style="font-size:10px; color:#888;">${e.message}</div>
                        <button onclick="MemoFeed.load()" class="intel-btn" style="margin-top:15px; width:100%;">RETRY CONNECTION</button>
                    </div>`;
            }
            this.isLoading = false;
        }
    },

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Inject Spinner CSS
        const styleId = 'live-feed-spinner-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes liveFeedSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .live-feed-spinner {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border: 2px solid #ff6800;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: liveFeedSpin 1s linear infinite;
                    margin-left: 8px;
                    vertical-align: middle;
                }
                /* Popup Time Styling */
                .popup-time-label, .popup-time-display {
                    position: absolute;
                    top: 5px;
                    left: 10px;
                    color: #ff6800;
                    font-size: 9px;
                    font-weight: bold;
                    font-family: 'Courier New', monospace;
                    text-transform: uppercase;
                    background: rgba(0, 0, 0, 0.8);
                    padding: 2px 6px;
                    border: 1px solid #331a00;
                    border-radius: 4px;
                    z-index: 10;
                    pointer-events: none;
                    box-shadow: 0 0 5px rgba(0,0,0,0.5);
                }
                /* Ensure close button is on top */
                .maplibregl-popup-close-button { z-index: 20; }
            `;
            document.head.appendChild(style);
        }

        const refreshBtn = el('feed-refresh-btn');
        this.load();
        if (refreshBtn) {
            const newBtn = refreshBtn.cloneNode(true);
            refreshBtn.parentNode.replaceChild(newBtn, refreshBtn);
            newBtn.addEventListener('click', () => this.load());
        }
    }
};

// ========= Wallet Manager =========
const WalletManager = {
    wallet: null,
    pubkey: null,

    async rpc(method, params) {
        return rpcWithProxyChain(method, params);
    },

    showStatus(type, msg) {
        const el = document.getElementById('wallet-status-msg');
        if (!el) return;
        el.style.display = 'block';
        el.className = 'status-msg';
        el.style.background = type === 'error' ? 'rgba(51, 0, 0, 0.8)' : 'rgba(0, 51, 0, 0.8)';
        el.style.color = type === 'error' ? '#ff3333' : '#00ff00';
        el.style.border = type === 'error' ? '1px solid #ff3333' : '1px solid #00ff00';
        el.innerHTML = msg;
        setTimeout(() => el.style.display = 'none', 5000);
    },

    getProvider() {
        if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
        if (window.solana?.isPhantom) return window.solana;
        if (window.solflare?.isSolflare) return window.solflare;
        if (window.solana) return window.solana;
        return null;
    },

    async getSolPrice() {
        const priceUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
        const phpProxy = (typeof PHP_PROXY !== 'undefined') ? PHP_PROXY : 'proxy.php?url=';
        const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
            { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
            { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
            { url: 'https://corsproxy.io/?', name: 'corsproxyio' }
        ];

        // 1) PHP proxy
        try {
            const r = await fetch(phpProxy + encodeURIComponent(priceUrl));
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) return data.solana.usd;
            }
        } catch (e) {
            console.warn('WalletManager: Price fetch via PHP proxy failed:', e.message);
        }

        // 2) Third-party proxies
        for (const proxy of thirdPartyProxies) {
            try {
                const r = await fetch(proxy.url + encodeURIComponent(priceUrl));
                if (r.ok) {
                    const data = await r.json();
                    if (data?.solana?.usd) return data.solana.usd;
                }
            } catch (e) {
                console.warn(`WalletManager: Price fetch via ${proxy.name} failed: `, e.message);
            }
        }

        // 3) Direct
        try {
            const r = await fetch(priceUrl);
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) return data.solana.usd;
            }
        } catch (e) {
            console.warn('WalletManager: Direct price fetch failed:', e.message);
        }

        return null;
    },

    async toggle() {
        const btn = document.getElementById('w-btn');
        const statusEl = document.getElementById('w-status');
        const detailsEl = document.getElementById('w-details');
        const addrEl = document.getElementById('w-addr');
        const balEl = document.getElementById('w-balance');

        if (this.wallet) {
            try { await this.wallet.disconnect(); } catch { }
            this.wallet = this.pubkey = null;
            if (statusEl) { statusEl.textContent = 'NOT CONNECTED'; statusEl.style.color = '#ff6800'; }
            detailsEl?.classList.add('hidden');
            if (btn) btn.textContent = 'CONNECT WALLET';
            log('WALLET: Disconnected.');
            return;
        }

        const provider = this.getProvider();
        if (!provider) {
            this.showStatus('error', 'No Solana wallet found. Please install Phantom or Solflare.');
            return;
        }

        try {
            if (btn) btn.textContent = 'CONNECTING...';
            const { publicKey } = await provider.connect();
            this.wallet = provider;
            this.pubkey = publicKey;

            if (statusEl) { statusEl.textContent = 'CONNECTED'; statusEl.style.color = '#00ff00'; }
            if (addrEl) addrEl.textContent = publicKey.toString();
            if (balEl) balEl.textContent = 'Fetching...';
            detailsEl?.classList.remove('hidden');
            if (btn) btn.textContent = 'DISCONNECT';

            try {
                const balance = await this.rpc('getBalance', [publicKey.toString()]);
                const sol = (balance?.value || balance || 0) / 1e9;

                // Fetch price
                const price = await this.getSolPrice();
                let valText = `${sol.toFixed(4)} SOL`;
                if (price) {
                    const usd = sol * price;
                    valText += ` ($${usd.toFixed(2)})`;
                }

                if (balEl) balEl.textContent = valText;
            } catch (e) {
                console.error(e);
                if (balEl) balEl.textContent = 'Balance Error';
            }
            log(`WALLET: Connected ${publicKey.toString().slice(0, 6)}...`);
        } catch (e) {
            console.error(e);
            this.showStatus('error', 'Connection failed: ' + e.message);
            if (btn) btn.textContent = 'CONNECT WALLET';
        }
    },



    init() {
        const btn = document.getElementById('w-btn');
        if (btn) {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => this.toggle());
        }
    }
};

// ========= Memo Sender (Jupiter V6) =========
const MemoSender = {
    CFG: {
        POT: '9QCZdmZv8nY1iiiaQmzxsuuGXj4gTzH6JiBcTvqdeDB8',
        MEMO: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
        MAX: 560,
        BURN_TOKEN: '6z1HBtCLTJrzHYXH8AN8dY5sgT4C35k4YsaFiq79BAGS',
        SOL_MINT: 'So11111111111111111111111111111111111111112',
        TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        TOKEN_2022_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        ATA_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        JUP_KEY: '18d859ae-199c-4341-b7cc-787cecf3244c',
        SITE_PDA: 'HQvMbrAMGjMkcobUV56MN9zaryPo9NarLddrEfc1wmLP',
        CORS_PROXY: 'https://corsproxy.io/?',
        RPCS: [
            'https://solana.drpc.org',             // Best for CORS
            'https://solana-api.projectserum.com', // Good backup
            'https://rpc.ankr.com/solana',         // Backup
            'https://api.mainnet-beta.solana.com', // Official (Often fails CORS)
        ]
    },
    FEE_LAMPORTS: 5000000, // 0.005 SOL
    FEE_USD: 3, // Approx visual guide
    cachedSolPrice: null,
    lastPriceFetch: 0,

    init() {
        this.getSolPrice().catch(() => { });
        this.updateFeeDisplay(); // Initial set
    },

    async preFetch() {
        // Warm up price and RPC
        this.getSolPrice().catch(() => { });
        this.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]).catch(() => { });
    },

    // --- Demo RPC Implementation (Direct First -> Proxy) ---
    async rpc(method, params) {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

        // Strategy 1: Try ALL direct endpoints first
        for (let i = 0; i < this.CFG.RPCS.length; i++) {
            const ep = this.CFG.RPCS[i];
            const result = await this.tryRpcCall(ep, body, method, i);
            if (result !== null) return result;
        }

        // Strategy 2: If all direct failed, try via CORS Proxy (LAST OPTION)
        console.warn('All direct RPCs failed, trying CORS proxy...');
        for (let i = 0; i < this.CFG.RPCS.length; i++) {
            const ep = this.CFG.RPCS[i];
            const proxiedUrl = this.CFG.CORS_PROXY + encodeURIComponent(ep);
            const result = await this.tryRpcCall(proxiedUrl, body, method, i);
            if (result !== null) return result;
        }

        throw new Error('RPC failed');
    },

    async tryRpcCall(url, body, method, endpointIndex) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (r.ok) {
                const d = await r.json();
                if (d.result !== undefined) {
                    return d.result;
                }
            }
        } catch (e) {
            // Silent fail - try next endpoint
        }
        return null;
    },

    async getSolPrice() {
        const now = Date.now();
        if (this.cachedSolPrice && (now - this.lastPriceFetch < 300000)) return this.cachedSolPrice;

        try {
            const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) {
                    this.cachedSolPrice = data.solana.usd;
                    this.lastPriceFetch = now;
                    return data.solana.usd;
                }
            }
        } catch (e) { }
        return 0; // Fallback
    },

    updateFeeDisplay() {
        // Optional helper if we want to update UI somewhere, can be expanded
    },

    // --- Helpers ---
    getSitePDA() {
        const [pda] = solanaWeb3.PublicKey.findProgramAddressSync(
            [new TextEncoder().encode('geoint.world')],
            new solanaWeb3.PublicKey(this.CFG.MEMO)
        );
        return pda;
    },

    getATAAddress(owner, mint, useToken2022 = false) {
        const tokenProgram = useToken2022 ? this.CFG.TOKEN_2022_PROGRAM : this.CFG.TOKEN_PROGRAM;
        const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(
            [owner.toBuffer(), new solanaWeb3.PublicKey(tokenProgram).toBuffer(), mint.toBuffer()],
            new solanaWeb3.PublicKey(this.CFG.ATA_PROGRAM)
        );
        return ata;
    },

    async getTokenBalance(tokenAccount) {
        const addr = tokenAccount.toString();
        // Method 1: RPC
        try {
            const info = await this.rpc('getTokenAccountBalance', [addr]);
            if (info?.value?.amount) return BigInt(info.value.amount);
        } catch (e) { }

        // Method 2: Manual Parse
        try {
            const acctInfo = await this.rpc('getAccountInfo', [addr, { encoding: 'base64' }]);
            if (acctInfo?.value?.data) {
                const data = Uint8Array.from(atob(acctInfo.value.data[0]), c => c.charCodeAt(0));
                if (data.length >= 72) {
                    let amount = BigInt(0);
                    for (let i = 0; i < 8; i++) amount += BigInt(data[64 + i]) << BigInt(i * 8);
                    return amount;
                }
            }
        } catch (e) { }
        return BigInt(0);
    },

    createBurnInstruction(tokenAccount, mint, owner, amount, decimals, useToken2022 = false) {
        const data = new Uint8Array(9);
        data[0] = 8; // Burn (Opcode 8)
        const amountBigInt = BigInt(amount);
        for (let i = 0; i < 8; i++) data[1 + i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xff));

        const tokenProgram = useToken2022 ? this.CFG.TOKEN_2022_PROGRAM : this.CFG.TOKEN_PROGRAM;
        return new solanaWeb3.TransactionInstruction({
            programId: new solanaWeb3.PublicKey(tokenProgram),
            keys: [
                { pubkey: tokenAccount, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: true },
                { pubkey: owner, isSigner: true, isWritable: false }
            ],
            data: data
        });
    },

    // --- Jupiter API ---
    async getJupiterQuote(inputMint, outputMint, amount, slippageBps = 200) {
        try {
            const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
            const r = await fetch(url, { headers: { 'x-api-key': this.CFG.JUP_KEY } });
            if (r.ok) return await r.json();
            throw new Error('Jupiter Quote API failed');
        } catch (e) {
            console.error('JUP: Quote error:', e);
            throw e;
        }
    },

    async getJupiterSwapTransaction(quoteResponse, userPubkey) {
        try {
            const body = JSON.stringify({
                quoteResponse,
                userPublicKey: userPubkey.toString(),
                wrapAndUnwrapSol: true
            });
            const r = await fetch('https://api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.CFG.JUP_KEY },
                body
            });
            if (r.ok) {
                const data = await r.json();
                return data.swapTransaction;
            }
            throw new Error('Jupiter Swap API failed: ' + await r.text());
        } catch (e) {
            console.error('JUP: Swap error:', e);
            throw e;
        }
    },

    async waitForConfirmation(sig, maxAttempts = 15) {
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const result = await this.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]);
                const s = result?.value?.[0];
                if (s?.err) throw new Error('Transaction failed');
                if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return 'confirmed';
            } catch (e) {
                if (e.message === 'Transaction failed') throw e;
            }
        }
        return 'timeout';
    },

    formatEntityData(props, layer, coords) {
        // Legacy formatter kept for compatibility
        const ts = new Date().toISOString();
        let data = { type: layer, time: ts };
        if (layer === 'flights') data = { ...data, callsign: props.callsign, icao: props.icao, alt: props.altitude || props.altitudeRaw, spd: props.velocity || props.velocityRaw, cat: props.category };
        else if (layer === 'ships' || layer === 'ships-dots') data = { ...data, vessel: props.vesselName, flag: props.flag, mmsi: props.ssvid, event: props.type };
        else if (layer === 'space-objects') data = { ...data, name: props.name, satType: props.type, alt: props.altitude || props.altitudeRaw };
        else if (layer === 'radio-stations') data = { ...data, station: props.name, country: props.country, codec: props.codec };
        else if (layer === 'mesh-nodes') data = { ...data, node: props.nodeName, nodeId: props.nodeId, meshType: props.meshType };
        else if (layer === 'repeaters') data = { ...data, callsign: props.callsign, freq: props.frequency, loc: props.location };
        else if (layer === 'cables') data = { ...data, cable: props.name, status: props.status };
        else if (layer === 'earthquake-circles') data = { ...data, mag: props.mag, place: props.place, depth: props.depth };
        else data = { ...data, raw: JSON.stringify(props).substring(0, 200) };
        if (coords) { data.lat = coords[1]?.toFixed(4); data.lng = coords[0]?.toFixed(4); }
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        return JSON.stringify(data).substring(0, 500);
    },

    // --- Main Send Function ---
    async send(props, layer, coords) {
        let toast = null;

        // Wallet Check
        if (!WalletManager.wallet || !WalletManager.pubkey) {
            const provider = window.phantom?.solana || window.solana;
            if (provider && (provider.isConnected || provider.publicKey)) {
                WalletManager.wallet = provider;
                WalletManager.pubkey = provider.publicKey;
            } else {
                Toast.show('warn', 'WALLET NOT CONNECTED', 3000);
                const wBtn = document.getElementById('wallet-btn');
                if (wBtn) wBtn.click();
                return false;
            }
        }

        const wallet = WalletManager.wallet;
        const pubkey = WalletManager.pubkey;
        const memo = this.formatEntityData(props, layer, coords);

        // Fee Calculation
        let solPrice = this.cachedSolPrice || await this.getSolPrice();
        let feeLam = this.FEE_LAMPORTS;
        let feeDisplay = `${(feeLam / 1e9).toFixed(4)} SOL`;
        if (solPrice) {
            // Optional: dynamic fee adjustment based on USD? 
            // Demo uses static selectable value, defaulting to 0.005. We use that default.
            feeDisplay += ` (~$${(feeLam / 1e9 * solPrice).toFixed(2)})`;
        }

        toast = Toast.show('info', `INITIATING JUPITER INSCRIPTION...`);
        log(`MEMO: Starting Jupiter Flow. Fee: ${feeDisplay}`);

        try {
            // 0. Prep
            const bh = await this.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
            if (!bh?.value?.blockhash) throw new Error('Failed to get blockhash');

            // Split Fee
            const directLam = Math.floor(feeLam * 0.1);
            const swapLam = feeLam - directLam;

            const burnTokenMint = new solanaWeb3.PublicKey(this.CFG.BURN_TOKEN);
            const ata2022 = this.getATAAddress(pubkey, burnTokenMint, true);
            const ataLegacy = this.getATAAddress(pubkey, burnTokenMint, false);

            // 1. Snapshot Balances
            const [initial2022, initialLegacy] = await Promise.all([
                this.getTokenBalance(ata2022),
                this.getTokenBalance(ataLegacy)
            ]);
            const initialTotal = initial2022 > BigInt(0) ? initial2022 : initialLegacy;
            log(`MEMO: Init Balances: 2022=${initial2022}, Legacy=${initialLegacy}`);

            // 2. TX1: Jupiter Swap
            Toast.update(toast, 'info', 'TX 1/2: FETCHING JUPITER QUOTE...');
            const quote = await this.getJupiterQuote(this.CFG.SOL_MINT, this.CFG.BURN_TOKEN, swapLam, 200);

            Toast.update(toast, 'info', 'TX 1/2: SWAPPING SOL FOR TOKENS...');
            const swapTxBase64 = await this.getJupiterSwapTransaction(quote, pubkey);
            const swapTxBuf = Uint8Array.from(atob(swapTxBase64), c => c.charCodeAt(0));
            const swapTx = solanaWeb3.VersionedTransaction.deserialize(swapTxBuf);

            const sig1 = (await wallet.signAndSendTransaction(swapTx))?.signature || (await wallet.signAndSendTransaction(swapTx));
            Toast.update(toast, 'info', 'TX 1 SENT! CONFIRMING SWAP...');
            log(`MEMO: TX1 (Swap): ${sig1}`);

            await this.waitForConfirmation(sig1, 15);
            await new Promise(r => setTimeout(r, 2000)); // Propagate

            // 3. Find Tokens
            Toast.update(toast, 'info', 'TX 2/2: CHECKING TOKENS...');
            let balance2022 = BigInt(0), balanceLegacy = BigInt(0);
            let foundNewTokens = false;
            let use2022 = true;
            let finalAmount = BigInt(0);

            for (let i = 0; i < 15; i++) {
                const [b22, bLeg] = await Promise.all([this.getTokenBalance(ata2022), this.getTokenBalance(ataLegacy)]);
                balance2022 = b22; balanceLegacy = bLeg;

                if (balance2022 > initial2022) { foundNewTokens = true; use2022 = true; finalAmount = balance2022 - initial2022; break; }
                if (balanceLegacy > initialLegacy) { foundNewTokens = true; use2022 = false; finalAmount = balanceLegacy - initialLegacy; break; }

                await new Promise(r => setTimeout(r, 1500));
            }

            if (!foundNewTokens) {
                // Edge case: started with 0?
                if (initialTotal === BigInt(0)) {
                    if (balance2022 > BigInt(0)) { foundNewTokens = true; use2022 = true; finalAmount = balance2022; }
                    else if (balanceLegacy > BigInt(0)) { foundNewTokens = true; use2022 = false; finalAmount = balanceLegacy; }
                }
            }

            if (!foundNewTokens || finalAmount <= BigInt(0)) {
                throw new Error('Swap confirmed but tokens not found in wallet.');
            }

            const tokensToBurn = finalAmount;
            const userATA = use2022 ? ata2022 : ataLegacy;
            const burnDisplay = Number(tokensToBurn) / 1e6;

            // 4. TX2: Transfer + Memo + Burn
            Toast.update(toast, 'info', `FOUND ${burnDisplay.toFixed(0)} TOKENS! BUILDING TX2...`);

            const bh2 = await this.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
            const tx2 = new solanaWeb3.Transaction({ recentBlockhash: bh2.value.blockhash, feePayer: pubkey });
            tx2.add(solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

            // Transfer 10%
            if (directLam > 0) {
                tx2.add(solanaWeb3.SystemProgram.transfer({
                    fromPubkey: pubkey,
                    toPubkey: new solanaWeb3.PublicKey(this.CFG.POT),
                    lamports: directLam
                }));
            }

            // Memo (Site PDA)
            tx2.add(new solanaWeb3.TransactionInstruction({
                keys: [{ pubkey, isSigner: true, isWritable: false }, { pubkey: this.getSitePDA(), isSigner: false, isWritable: false }],
                programId: new solanaWeb3.PublicKey(this.CFG.MEMO),
                data: new TextEncoder().encode(memo)
            }));

            // Burn
            tx2.add(this.createBurnInstruction(userATA, burnTokenMint, pubkey, tokensToBurn, 6, use2022));

            Toast.update(toast, 'info', 'TX 2/2: APPROVE MEMO + BURN...');
            const sig2 = (await wallet.signAndSendTransaction(tx2))?.signature || (await wallet.signAndSendTransaction(tx2));

            Toast.update(toast, 'info', 'TX 2 SENT! FINALIZING...');
            log(`MEMO: TX2 (Burn): ${sig2}`);
            await this.waitForConfirmation(sig2, 10);

            Toast.update(toast, 'success', `SUCCESS! ${burnDisplay.toFixed(0)} TOKENS BURNED!`, 5000);
            log(`MEMO: Inscription Complete. Burned: ${burnDisplay}`);
            return sig2;

        } catch (e) {
            console.error('MEMO: Error', e);
            if (toast) Toast.update(toast, 'error', `FAILED: ${e.message.substring(0, 40)}`, 4000);
            return false;
        }
    }
};

// Expose to window for inline HTML handlers
window.MemoFeed = MemoFeed;
window.WalletManager = WalletManager;
window.MemoSender = MemoSender;

export { MemoFeed, WalletManager, MemoSender };