// --- Live TV Module ---

(function () {
    const API_URL = 'https://live-news-api.tk.gg/api/channels';
    let currentStreams = [];
    let currentSort = 'viewers';
    let autoRefreshInterval = null;

    // Elements
    let modal, grid, statusEl, titleEl, refreshBtn, closeBtn, toggle;
    let settingsBtn, overlayContainer;

    function initLiveTV() {
        console.log('LIVETV: Initializing...');

        modal = document.getElementById('livetv-modal');
        grid = document.getElementById('livetv-grid');
        statusEl = document.getElementById('livetv-status');
        titleEl = document.getElementById('livetv-title');
        refreshBtn = document.getElementById('livetv-refresh-btn');
        closeBtn = document.getElementById('close-livetv-btn');
        toggle = document.getElementById('livetv-toggle');
        settingsBtn = document.getElementById('livetv-settings-btn');
        overlayContainer = document.getElementById('livetv-overlay-container');

        if (!toggle) {
            console.warn('LIVETV: Toggle not found, aborting init.');
            return;
        }

        setupListeners();
    }

    function setupListeners() {
        toggle.addEventListener('change', (e) => {
            if (e.target.checked) openLiveTV();
            else closeLiveTV();
        });

        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                toggle.checked = true;
                openLiveTV();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                toggle.checked = false;
                closeLiveTV();
            });
        }

        if (refreshBtn) refreshBtn.addEventListener('click', loadStreams);

        // Click Outside to Close
        window.addEventListener('click', (e) => {
            if (modal && modal.style.display === 'flex') {
                const content = modal.querySelector('.livetv-content');
                const toggleLabel = toggle ? toggle.closest('.toggle-container') : null;

                // Check if click is outside modal content AND not inside the toggle label (checkbox/span) AND not the settings button
                if (content && !content.contains(e.target) &&
                    (!toggleLabel || !toggleLabel.contains(e.target)) &&
                    (!settingsBtn || !settingsBtn.contains(e.target))) {

                    toggle.checked = false;
                    closeLiveTV();
                }
            }
        });
    }

    function openLiveTV() {
        if (modal) {
            modal.style.display = 'flex';
            loadStreams();
            startAutoRefresh();
        }
    }

    function closeLiveTV() {
        if (modal) {
            modal.style.display = 'none';
        }
        stopAutoRefresh();
        if (grid) grid.innerHTML = '';
    }

    function startAutoRefresh() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(loadStreams, 5 * 60 * 1000); // 5 mins
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    async function loadStreams() {
        if (!grid || !statusEl) return;

        grid.innerHTML = '';
        statusEl.innerHTML = '<span class="blink">LOADING LIVE STREAMS...</span>';
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            if (!Array.isArray(data) || data.length === 0) {
                statusEl.innerHTML = 'NO LIVE STREAMS AVAILABLE';
                if (titleEl) titleEl.innerHTML = '// LIVE NEWS STREAMS <span style="color: #444;">|</span> CHANNELS: <span style="color: #fff;">0</span>';
                if (refreshBtn) refreshBtn.disabled = false;
                return;
            }

            currentStreams = data;
            statusEl.innerHTML = `<span style="color: #00ff00;">ONLINE</span>`;
            const sorted = sortStreams(data, currentSort);
            displayStreams(sorted);

        } catch (error) {
            console.error('LIVETV: Error fetching streams:', error);
            statusEl.innerHTML = `<span style="color: #ff3333;">ERROR: ${error.message}</span>`;
            grid.innerHTML = `<div class="livetv-error">${error.message}</div>`;
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    function sortStreams(streams, sortBy) {
        return [...streams].sort((a, b) => (b.liveData?.concurrentViewers || 0) - (a.liveData?.concurrentViewers || 0));
    }

    function displayStreams(streams) {
        if (!grid) return;
        grid.innerHTML = '';
        grid.className = 'livetv-grid list-mode';

        if (titleEl) {
            titleEl.innerHTML = `// LIVE NEWS STREAMS <span style="color: #444;">|</span> CHANNELS: <span style="color: #fff;">${streams.length}</span>`;
        }

        streams.forEach(stream => {
            const item = document.createElement('div');
            item.className = 'livetv-list-item';

            item.onclick = (e) => {
                if (e.target.type !== 'checkbox') {
                    const cb = item.querySelector('input[type="checkbox"]');
                    cb.checked = !cb.checked;
                    toggleStreamOnMap(stream, cb.checked);
                }
            };

            const viewers = stream.liveData?.concurrentViewers || 0;
            const isAlreadyActive = document.getElementById(`livetv-player-${stream.videoId}`);

            item.innerHTML = `
                <div style="margin-right: 10px; display: flex; align-items: center;">
                    <label class="toggle-container" style="min-height: 0; width: auto; flex: 0 0 auto; margin: 0;">
                        <input type="checkbox" ${isAlreadyActive ? 'checked' : ''} onclick="event.stopPropagation()">
                        <span class="checkmark" style="height: 11px; width: 11px; margin-right: 0;"></span>
                    </label>
                </div>
                <span class="livetv-list-channel">${stream.channelTitle}</span>
                <span class="livetv-list-separator">|</span>
                <span class="livetv-list-title" title="${stream.title}">${stream.title}</span>
                <span class="livetv-list-viewers">${viewers > 0 ? formatViewers(viewers) : 'LIVE'}</span>
            `;

            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleStreamOnMap(stream, e.target.checked);
            };

            grid.appendChild(item);
        });
    }

    function toggleStreamOnMap(stream, isActive) {
        if (!overlayContainer) return;

        const existing = document.getElementById(`livetv-player-${stream.videoId}`);

        if (isActive) {
            if (existing) return;

            const player = document.createElement('div');
            player.id = `livetv-player-${stream.videoId}`;
            player.className = 'livetv-float-player';
            // Set initial dimensions explicitly
            player.style.width = '320px';
            player.style.height = '200px';

            player.innerHTML = `
                <div class="resize-handle handle-nw" data-dir="nw"></div>
                <div class="resize-handle handle-ne" data-dir="ne"></div>
                <div class="resize-handle handle-sw" data-dir="sw"></div>
                <div class="resize-handle handle-se" data-dir="se"></div>

                <div class="livetv-float-header">
                    <span class="livetv-float-title" title="${stream.title}">${stream.channelTitle}</span>
                    <span class="livetv-float-close" onclick="closeStream('${stream.videoId}')">[X]</span>
                </div>
                <div class="livetv-float-iframe-container">
                    <button class="iframe-cover-btn" style="position: absolute; top:0; left:0; width:100%; height:100%; opacity:0; z-index:1; cursor: pointer;" onclick="this.style.display='none'"></button>
                    <iframe 
                        src="https://www.youtube.com/embed/${stream.videoId}?autoplay=1&mute=0" 
                        allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture" 
                        allowfullscreen>
                    </iframe>
                </div>
            `;

            overlayContainer.appendChild(player);

            // Make Draggable
            const header = player.querySelector('.livetv-float-header');
            makeDraggable(player, header);

            // Make Resizable
            const handles = player.querySelectorAll('.resize-handle');
            handles.forEach(handle => makeResizable(player, handle, handle.dataset.dir));

        } else {
            if (existing) {
                existing.remove();
            }
        }
    }

    function makeResizable(element, handle, dir) {
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Ensure absolute/fixed position before resizing
            // Similar logic as drag, calculate rect and set fixed
            const rect = element.getBoundingClientRect();
            if (element.style.position !== 'fixed') {
                element.style.position = 'fixed';
                element.style.top = rect.top + "px";
                element.style.left = rect.left + "px";
                element.style.width = rect.width + "px";
                element.style.height = rect.height + "px";
            }

            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = parseInt(getComputedStyle(element).width, 10);
            const startHeight = parseInt(getComputedStyle(element).height, 10);
            const startTop = rect.top;
            const startLeft = rect.left;

            function doDrag(e) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                if (dir === 'se') {
                    element.style.width = startWidth + dx + 'px';
                    element.style.height = startHeight + dy + 'px';
                } else if (dir === 'sw') {
                    element.style.width = startWidth - dx + 'px';
                    element.style.left = startLeft + dx + 'px';
                    element.style.height = startHeight + dy + 'px';
                } else if (dir === 'ne') {
                    element.style.width = startWidth + dx + 'px';
                    element.style.height = startHeight - dy + 'px';
                    element.style.top = startTop + dy + 'px';
                } else if (dir === 'nw') {
                    element.style.width = startWidth - dx + 'px';
                    element.style.left = startLeft + dx + 'px';
                    element.style.height = startHeight - dy + 'px';
                    element.style.top = startTop + dy + 'px';
                }
            }

            function stopDrag() {
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            }

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            // e.preventDefault(); // Don't prevent default here as it might block clicks? No, dragging usually wants prevent.
            e.preventDefault();

            const rect = element.getBoundingClientRect();

            if (element.style.position !== 'fixed') {
                element.style.position = 'fixed';
                element.style.top = rect.top + "px";
                element.style.left = rect.left + "px";
                element.style.width = rect.width + "px";
                element.style.height = rect.height + "px";
                // Enforce current dimensions on detach
            }

            pos3 = e.clientX;
            pos4 = e.clientY;

            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();

            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    window.closeStream = function (videoId) {
        const player = document.getElementById(`livetv-player-${videoId}`);
        if (player) player.remove();
        if (grid) loadStreams();
    };

    function formatViewers(count) {
        if (!count) return '0';
        count = parseInt(count);
        if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
        return count.toString();
    }

    window.initLiveTV = initLiveTV;
    window.addEventListener('DOMContentLoaded', initLiveTV);

})();
