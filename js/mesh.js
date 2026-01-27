// --- Mesh Data Logic (Meshtastic Network & MeshCore) ---

const MESH_API_URL = 'https://meshmap.net/nodes.json';
const MESHCORE_API_URL = 'https://map.meshcore.dev/api/v1/nodes';
const POLL_INTERVAL_MS = 600000; // 10 minutes

let meshNodes = new Map(); // Meshtastic nodes
let meshcoreNodes = new Map(); // MeshCore nodes
let meshInterval = null;
let meshcoreInterval = null;

// Filter states
let meshtasticFilters = {
    CLIENT: true,
    CLIENT_MUTE: true,
    CLIENT_BASE: true,
    ROUTER: true,
    REPEATER: true,
    ROUTER_LATE: true,
    TRACKER: true,
    SENSOR: true
};

let meshcoreFilters = {
    'Client': true,
    'Repeater': true,
    'Room Server': true,
    'Sensor': true
};

// Export to window for UI access
window.meshtasticFilters = meshtasticFilters;
window.meshcoreFilters = meshcoreFilters;

// Proxy functions now use centralized fetchWithProxyFallback from utils.js

function parseCoordinate(value) {
    if (typeof value !== 'number') return null;
    if (Math.abs(value) > 1000) {
        return value / 1e7;
    }
    return value;
}

function extractNodeName(node) {
    if (node.shortName) return node.shortName;
    if (node.longName) return node.longName;
    return 'UNKNOWN';
}

function extractSignalStrength(node) {
    if (node.snr !== undefined && node.snr !== null) return node.snr;
    if (node.rssi !== undefined && node.rssi !== null) return node.rssi;
    return null;
}

function calculateSignalPercentage(signalStrength) {
    if (signalStrength === null) return null;
    if (Math.abs(signalStrength) <= 20) {
        return Math.max(0, Math.min(100, ((signalStrength + 20) / 40) * 100));
    }
    return Math.max(0, Math.min(100, ((signalStrength + 100) / 100) * 100));
}

function getSignalColor(signalPercentage) {
    if (signalPercentage === null) return '#888888';
    if (signalPercentage < 33) return '#ff0000';
    if (signalPercentage < 66) return '#ff6800';
    return '#00ff00';
}

function getMeshcoreNodeColor(nodeType) {
    // Different colors for different MeshCore node types
    const colorMap = {
        'Client': '#00aaff',      // Blue for clients
        'Repeater': '#ff6800',    // Orange for repeaters
        'Room Server': '#00ff00', // Green for room servers
        'Sensor': '#ff00ff'       // Magenta for sensors
    };
    return colorMap[nodeType] || '#ff6800'; // Default to orange
}

async function fetchMeshNodes() {
    // Fundamental check: Do not fetch if mesh toggle is disabled or meshtastic toggle is disabled
    if (!meshToggle || !meshToggle.checked || !meshtasticToggle || !meshtasticToggle.checked) {
        // Clear meshtastic nodes from map
        meshNodes.clear();
        updateCombinedMeshData();
        // Hide status bar
        hideStatus();
        return;
    }

    try {
        if (typeof map === 'undefined' || !map) {
            logSystem("MESH: Map not initialized. Please wait...");
            return;
        }

        updateLoadingStatus('LOADING MESHTASTIC NODES...', 'text-dim');

        logSystem("MESH: Fetching Meshtastic node data...");

        // Use fetchWithProxyChain (PHP proxy first, third-party fallback)
        const response = await fetchWithProxyChain(MESH_API_URL);
        const proxySource = response.proxySource || 'unknown';
        const sourceLabel = proxySource === 'php' ? 'BACKEND' : `THIRD-PARTY (${proxySource})`;
        logSystem(`NET: Meshtastic data (meshmap.net) via ${sourceLabel}`);

        const data = await response.json();

        const nodesArray = Object.values(data);

        // Check if toggle was turned off during fetch
        if (!meshToggle || !meshToggle.checked || !meshtasticToggle || !meshtasticToggle.checked) {
            meshNodes.clear();
            updateCombinedMeshData();
            const loadingBar = document.getElementById('status-box');
            if (loadingBar) loadingBar.style.display = 'none';
            return;
        }

        logSystem(`MESH: Received ${nodesArray.length} nodes from meshmap.net`);

        meshNodes.clear(); // Clear old meshtastic nodes
        const features = [];
        let validNodes = 0;
        let invalidNodes = 0;

        for (const node of nodesArray) {
            try {
                const lat = parseCoordinate(node.latitude);
                const lon = parseCoordinate(node.longitude);

                if (lat === null || lon === null ||
                    lat < -90 || lat > 90 ||
                    lon < -180 || lon > 180) {
                    invalidNodes++;
                    continue;
                }

                const nodeId = `meshtastic-${node.id || node.nodeId || `node-${validNodes}`}`;
                const nodeName = extractNodeName(node);
                const shortName = node.shortName || node.short_name || null;
                const altitude = node.altitude !== undefined ? node.altitude : null;
                const battery = node.battery_level !== undefined ? node.battery_level :
                    (node.battery !== undefined ? node.battery : null);
                const batteryState = node.battery_state || node.batteryState || null; // "Plugged In" or percentage
                const voltage = node.voltage !== undefined ? node.voltage : null;
                const signalStrength = extractSignalStrength(node);
                const signalPercentage = calculateSignalPercentage(signalStrength);
                const role = node.role || node.nodeRole || null;
                const hardware = node.hardware || node.hwModel || null;
                const firmware = node.firmware || node.firmwareVersion || null;
                const region = node.region || node.loraRegion || null;
                const modemPreset = node.modemPreset || node.modem_preset || null;
                const hasDefaultChannel = node.hasDefaultChannel !== undefined ? node.hasDefaultChannel : null;
                const airUtil = node.airUtil !== undefined ? node.airUtil : (node.air_util !== undefined ? node.air_util : null);
                const hexId = node.hexId || node.hex_id || node.id ? `!${parseInt(node.id).toString(16)}` : null;
                const numericId = node.id || node.nodeId || null;
                const lastHeard = node.lastHeard || node.last_heard || node.lastSeen || null;
                const positionPrecision = node.positionPrecision || node.position_precision || node.precision || null;
                const localNodes = node.localNodes !== undefined ? node.localNodes : (node.local_nodes !== undefined ? node.local_nodes : null);
                const mqttConnected = node.mqttConnected !== undefined ? node.mqttConnected : (node.mqtt_connected !== undefined ? node.mqtt_connected : null);
                const mqttLastSeen = node.mqttLastSeen || node.mqtt_last_seen || null;
                // Meshtastic nodes are always red
                const signalColor = '#ff0000';

                meshNodes.set(nodeId, {
                    nodeId,
                    lat,
                    lon,
                    altitude,
                    battery,
                    batteryState,
                    voltage,
                    signalStrength,
                    signalPercentage,
                    nodeName,
                    shortName,
                    role,
                    hardware,
                    firmware,
                    region,
                    modemPreset,
                    hasDefaultChannel,
                    airUtil,
                    hexId,
                    numericId,
                    lastHeard,
                    positionPrecision,
                    localNodes,
                    mqttConnected,
                    mqttLastSeen,
                    meshType: 'meshtastic',
                    timestamp: Date.now()
                });

                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lon, lat]
                    },
                    properties: {
                        nodeId,
                        nodeName,
                        meshType: 'meshtastic',
                        altitude: altitude !== null ? altitude : 'N/A',
                        battery: battery !== null ? `${battery}%` : 'N/A',
                        signalStrength: signalStrength !== null ? signalStrength : 'N/A',
                        signalPercentage: signalPercentage !== null ? `${Math.round(signalPercentage)}%` : 'N/A',
                        signalColor
                    }
                });

                validNodes++;
            } catch (error) {
                invalidNodes++;
                console.error('Error processing node:', error);
            }
        }

        logSystem(`MESH: Processed ${validNodes} valid Meshtastic nodes, ${invalidNodes} invalid nodes`);

        // Final check before updating map - ensure toggle is still on
        if (!meshToggle || !meshToggle.checked || !meshtasticToggle || !meshtasticToggle.checked) {
            meshNodes.clear();
            updateCombinedMeshData();
            const loadingBar = document.getElementById('status-box');
            if (loadingBar) loadingBar.style.display = 'none';
            return;
        }

        // Merge with meshcore nodes and update map
        updateCombinedMeshData();

        // Check if MeshCore is also enabled and loaded
        const meshcoreToggle = document.getElementById('meshcore-toggle');
        const meshcoreActive = meshcoreToggle && meshcoreToggle.checked;

        // Hide loading bar if MeshCore is not enabled or already loaded
        if (!meshcoreActive || meshcoreNodes.size > 0) {
            hideStatus();
        } else {
            // Still waiting for MeshCore
            updateLoadingStatus(`MESH: ${meshNodes.size.toLocaleString()} MESHTASTIC NODES LOADED, WAITING FOR MESHCORE...`, '');
        }

    } catch (error) {
        logSystem(`ERR: Failed to fetch mesh nodes - ${error.message}`);
        console.error('Mesh fetch error:', error);

        const loadingBar = document.getElementById('status-box');
        const loadingText = document.getElementById('loading-text');
        if (loadingBar && loadingText) {
            loadingText.innerText = 'MESH: FETCH ERROR';
            loadingText.className = '';
        }
    }
}

async function fetchMeshcoreNodes() {
    // Fundamental check: Do not fetch if mesh toggle is disabled or meshcore toggle is disabled
    if (!meshToggle || !meshToggle.checked || !meshcoreToggle || !meshcoreToggle.checked) {
        // Clear meshcore nodes from map
        meshcoreNodes.clear();
        updateCombinedMeshData();
        // Hide status bar
        hideStatus();
        return;
    }

    try {
        if (typeof map === 'undefined' || !map) {
            logSystem("MESHCORE: Map not initialized. Please wait...");
            return;
        }

        logSystem("MESHCORE: Fetching MeshCore node data...");

        updateLoadingStatus('LOADING MESHCORE NODES...', 'text-dim');

        // Use fetchWithProxyChain (PHP proxy first, third-party fallback)
        const response = await fetchWithProxyChain(MESHCORE_API_URL);
        const proxySource = response.proxySource || 'unknown';
        const sourceLabel = proxySource === 'php' ? 'BACKEND' : `THIRD-PARTY (${proxySource})`;
        logSystem(`NET: MeshCore data (meshcore.dev) via ${sourceLabel}`);

        const data = await response.json();

        if (!data) {
            throw new Error('No data received from MeshCore API');
        }

        // Handle different possible response formats
        let nodesArray = [];
        if (Array.isArray(data)) {
            nodesArray = data;
        } else if (data.nodes && Array.isArray(data.nodes)) {
            nodesArray = data.nodes;
        } else if (data.data && Array.isArray(data.data)) {
            nodesArray = data.data;
        } else if (typeof data === 'object' && data !== null) {
            // Try to extract nodes from object
            const keys = Object.keys(data);
            if (keys.length > 0) {
                // Check if first value is an array (like {node1: {...}, node2: {...}})
                const firstValue = data[keys[0]];
                if (Array.isArray(firstValue)) {
                    nodesArray = firstValue;
                } else if (typeof firstValue === 'object' && firstValue !== null) {
                    // It's an object of nodes, convert to array
                    nodesArray = Object.values(data);
                }
            }
        }

        if (nodesArray.length === 0) {
            logSystem("WARN: MESHCORE: No nodes found in response. Response structure may be different.");
            console.log("MESHCORE: Response data:", data);
        }

        // Check if toggle was turned off during fetch
        if (!meshToggle || !meshToggle.checked || !meshcoreToggle || !meshcoreToggle.checked) {
            meshcoreNodes.clear();
            updateCombinedMeshData();
            const loadingBar = document.getElementById('status-box');
            if (loadingBar) loadingBar.style.display = 'none';
            return;
        }

        // Check if toggle was turned off during fetch
        if (!meshToggle || !meshToggle.checked || !meshcoreToggle || !meshcoreToggle.checked) {
            meshcoreNodes.clear();
            updateCombinedMeshData();
            const loadingBar = document.getElementById('status-box');
            if (loadingBar) loadingBar.style.display = 'none';
            return;
        }

        logSystem(`MESHCORE: Received ${nodesArray.length} nodes from meshcore.dev`);

        meshcoreNodes.clear(); // Clear old meshcore nodes
        let validNodes = 0;
        let invalidNodes = 0;

        // Log first node structure for debugging
        if (nodesArray.length > 0) {
            console.log("MESHCORE: Sample node structure:", nodesArray[0]);
        }

        for (const node of nodesArray) {
            try {
                // MeshCore API returns: adv_lat, adv_lon, adv_name, type, public_key, last_advert, etc.
                const lat = parseCoordinate(node.adv_lat || node.latitude || node.lat || node.lat_deg);
                const lon = parseCoordinate(node.adv_lon || node.longitude || node.lon || node.lon_deg || node.lng);

                if (lat === null || lon === null ||
                    lat < -90 || lat > 90 ||
                    lon < -180 || lon > 180) {
                    invalidNodes++;
                    continue;
                }

                const nodeId = `meshcore-${node.public_key || node.id || node.node_id || node.nodeId || `node-${validNodes}`}`;
                const nodeName = node.adv_name || node.name || node.node_name || node.short_name || node.long_name || node.shortName || node.longName || 'UNKNOWN';

                // Map type numbers to names (1=Client, 2=Repeater, 3=Room Server, 4=Sensor)
                const typeMap = {
                    '1': 'Client',
                    '2': 'Repeater',
                    '3': 'Room Server',
                    '4': 'Sensor'
                };
                const nodeType = typeMap[node.type] || node.type || node.node_type || 'Unknown';

                // Extract additional MeshCore fields
                const publicKey = node.public_key || null;
                const link = node.link || node.meshcore_link || null;
                const updateStatus = node.update_status || node.updateStatus || null;
                const insertedDate = node.inserted_date || node.insertedDate || null;
                const updatedDate = node.updated_date || node.updatedDate || null;
                const radioPreset = node.radio_preset || node.radioPreset || node.params?.preset || null;
                const radioParams = node.params || node.radio_params || node.radioParams || null;
                const frequency = radioParams?.frequency || radioParams?.freq || null;
                const bandwidth = radioParams?.bandwidth || radioParams?.bw || null;
                const codingRate = radioParams?.coding_rate || radioParams?.codingRate || radioParams?.cr || null;
                const spreadingFactor = radioParams?.spreading_factor || radioParams?.spreadingFactor || radioParams?.sf || null;

                // last_advert is the timestamp for when the node was last seen
                const lastSeen = node.last_advert || node.last_seen || node.lastSeen || updatedDate || node.timestamp || null;

                // Get color based on node type
                const nodeColor = getMeshcoreNodeColor(nodeType);

                meshcoreNodes.set(nodeId, {
                    nodeId,
                    lat,
                    lon,
                    nodeName,
                    nodeType,
                    lastSeen,
                    nodeColor,
                    publicKey,
                    link,
                    updateStatus,
                    insertedDate,
                    updatedDate,
                    radioPreset,
                    frequency,
                    bandwidth,
                    codingRate,
                    spreadingFactor,
                    meshType: 'meshcore',
                    timestamp: Date.now()
                });

                validNodes++;
            } catch (error) {
                invalidNodes++;
                console.error('Error processing MeshCore node:', error, node);
            }
        }

        // Count nodes by type
        const typeCounts = {};
        for (const node of meshcoreNodes.values()) {
            const type = node.nodeType || 'Unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        }

        const typeSummary = Object.entries(typeCounts)
            .map(([type, count]) => `${type}: ${count}`)
            .join(', ');

        logSystem(`MESHCORE: Processed ${validNodes} valid nodes, ${invalidNodes} invalid nodes`);
        if (typeSummary) {
            logSystem(`MESHCORE: Node types - ${typeSummary}`);
        }

        // Final check before updating map - ensure toggle is still on
        if (!meshToggle || !meshToggle.checked || !meshcoreToggle || !meshcoreToggle.checked) {
            meshcoreNodes.clear();
            updateCombinedMeshData();
            const loadingBar = document.getElementById('status-box');
            if (loadingBar) loadingBar.style.display = 'none';
            return;
        }

        // Merge with meshtastic nodes and update map
        updateCombinedMeshData();

        // Hide loading bar when done
        hideStatus();

    } catch (error) {
        logSystem(`ERR: Failed to fetch MeshCore nodes - ${error.message}`);
        console.error('MeshCore fetch error:', error);

        // Still update the map to clear any old nodes
        updateCombinedMeshData();

        // Update status on error
        const meshtasticText = meshNodes.size > 0 ? `${meshNodes.size.toLocaleString()} MESHTASTIC, ` : '';
        updateLoadingStatus(`MESH: ${meshtasticText}MESHCORE FETCH ERROR`, '');
    }
}

function updateCombinedMeshData() {
    if (typeof map === 'undefined' || !map) return;

    const source = map.getSource('mesh-data');
    if (!source) {
        logSystem("WARN: Mesh data source not found. Map may still be initializing.");
        return;
    }

    const features = [];

    // Add Meshtastic nodes (if enabled) - always red
    const meshtasticToggle = document.getElementById('meshtastic-toggle');
    if (meshtasticToggle && meshtasticToggle.checked) {
        for (const node of meshNodes.values()) {
            // Apply role filter
            const role = node.role || 'CLIENT';
            if (!meshtasticFilters[role]) {
                continue; // Skip this node if its role is filtered out
            }

            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [node.lon, node.lat]
                },
                properties: {
                    nodeId: node.nodeId,
                    nodeName: node.nodeName,
                    shortName: node.shortName,
                    meshType: 'meshtastic',
                    altitude: node.altitude !== null ? node.altitude : 'N/A',
                    battery: node.battery !== null ? `${node.battery}%` : 'N/A',
                    batteryState: node.batteryState,
                    voltage: node.voltage,
                    signalStrength: node.signalStrength !== null ? node.signalStrength : 'N/A',
                    signalPercentage: node.signalPercentage !== null ? `${Math.round(node.signalPercentage)}%` : 'N/A',
                    role: node.role,
                    hardware: node.hardware,
                    firmware: node.firmware,
                    region: node.region,
                    modemPreset: node.modemPreset,
                    hasDefaultChannel: node.hasDefaultChannel,
                    airUtil: node.airUtil,
                    hexId: node.hexId,
                    numericId: node.numericId,
                    lastHeard: node.lastHeard,
                    positionPrecision: node.positionPrecision,
                    localNodes: node.localNodes,
                    mqttConnected: node.mqttConnected,
                    mqttLastSeen: node.mqttLastSeen,
                    signalColor: '#ff0000' // Meshtastic nodes are always red
                }
            });
        }
    }

    // Add MeshCore nodes (if enabled)
    const meshcoreToggle = document.getElementById('meshcore-toggle');
    if (meshcoreToggle && meshcoreToggle.checked) {
        for (const node of meshcoreNodes.values()) {
            // Apply type filter
            const nodeType = node.nodeType || 'Unknown';
            if (!meshcoreFilters[nodeType]) {
                continue; // Skip this node if its type is filtered out
            }
            // Use color based on node type
            const signalColor = node.nodeColor || '#ff6800';

            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [node.lon, node.lat]
                },
                properties: {
                    nodeId: node.nodeId,
                    nodeName: node.nodeName,
                    meshType: 'meshcore',
                    nodeType: node.nodeType || 'Unknown',
                    lastSeen: node.lastSeen ? (typeof node.lastSeen === 'string' ? new Date(node.lastSeen).toLocaleString() : new Date(node.lastSeen * 1000).toLocaleString()) : 'N/A',
                    publicKey: node.publicKey,
                    link: node.link,
                    updateStatus: node.updateStatus,
                    insertedDate: node.insertedDate,
                    updatedDate: node.updatedDate,
                    radioPreset: node.radioPreset,
                    frequency: node.frequency,
                    bandwidth: node.bandwidth,
                    codingRate: node.codingRate,
                    spreadingFactor: node.spreadingFactor,
                    signalColor: signalColor
                }
            });
        }
    }

    const geoJsonData = {
        type: 'FeatureCollection',
        features
    };
    if (typeof window.safeSetData === 'function') {
        window.safeSetData(source, geoJsonData);
    } else {
        source.setData(geoJsonData);
    }

    const totalNodes = features.length;
    const meshtasticCount = meshNodes.size;
    const meshcoreCount = meshcoreNodes.size;

    // Count MeshCore nodes by type for summary
    if (meshcoreCount > 0) {
        const meshcoreTypeCounts = {};
        for (const node of meshcoreNodes.values()) {
            const type = node.nodeType || 'Unknown';
            meshcoreTypeCounts[type] = (meshcoreTypeCounts[type] || 0) + 1;
        }
        const meshcoreTypeSummary = Object.entries(meshcoreTypeCounts)
            .map(([type, count]) => `${type}:${count}`)
            .join(' ');

        logSystem(`MESH: Updated map with ${totalNodes} total nodes (${meshtasticCount} Meshtastic, ${meshcoreCount} MeshCore [${meshcoreTypeSummary}])`);
    } else {
        logSystem(`MESH: Updated map with ${totalNodes} total nodes (${meshtasticCount} Meshtastic, ${meshcoreCount} MeshCore)`);
    }

    // Update filter modal counts
    updateFilterCounts();
}

function updateFilterCounts() {
    // Count Meshtastic nodes by role
    const meshtasticRoleCounts = {
        'CLIENT': 0,
        'CLIENT_MUTE': 0,
        'CLIENT_BASE': 0,
        'ROUTER': 0,
        'REPEATER': 0,
        'ROUTER_LATE': 0,
        'TRACKER': 0,
        'SENSOR': 0
    };

    for (const node of meshNodes.values()) {
        const role = node.role || 'CLIENT';
        if (meshtasticRoleCounts.hasOwnProperty(role)) {
            meshtasticRoleCounts[role]++;
        }
    }

    // Update Meshtastic filter counts
    const roleIdMap = {
        'CLIENT': 'count-role-client',
        'CLIENT_MUTE': 'count-role-client-mute',
        'CLIENT_BASE': 'count-role-client-base',
        'ROUTER': 'count-role-router',
        'REPEATER': 'count-role-repeater',
        'ROUTER_LATE': 'count-role-router-late',
        'TRACKER': 'count-role-tracker',
        'SENSOR': 'count-role-sensor'
    };

    Object.keys(meshtasticRoleCounts).forEach(role => {
        const countElement = document.getElementById(roleIdMap[role]);
        if (countElement) {
            countElement.textContent = `(${meshtasticRoleCounts[role]})`;
        }
    });

    // Count MeshCore nodes by type
    const meshcoreTypeCounts = {
        'Client': 0,
        'Repeater': 0,
        'Room Server': 0,
        'Sensor': 0
    };

    for (const node of meshcoreNodes.values()) {
        const nodeType = node.nodeType || 'Unknown';
        if (meshcoreTypeCounts.hasOwnProperty(nodeType)) {
            meshcoreTypeCounts[nodeType]++;
        }
    }

    // Update MeshCore filter counts
    const typeIdMap = {
        'Client': 'count-type-client',
        'Repeater': 'count-type-repeater',
        'Room Server': 'count-type-room',
        'Sensor': 'count-type-sensor'
    };

    Object.keys(meshcoreTypeCounts).forEach(type => {
        const countElement = document.getElementById(typeIdMap[type]);
        if (countElement) {
            countElement.textContent = `(${meshcoreTypeCounts[type]})`;
        }
    });
}

function initMeshtastic() {
    if (meshInterval) {
        clearInterval(meshInterval);
    }

    fetchMeshNodes();

    meshInterval = setInterval(() => {
        fetchMeshNodes();
    }, POLL_INTERVAL_MS);

    logSystem("MESH: Meshtastic polling initialized (10 minute interval)");
}

function cleanupMeshtastic() {
    if (meshInterval) {
        clearInterval(meshInterval);
        meshInterval = null;
        logSystem("MESH: Meshtastic polling stopped");
    }
    // Clear meshtastic nodes from map
    meshNodes.clear();
    updateCombinedMeshData();
}

function initMeshcore() {
    if (meshcoreInterval) {
        clearInterval(meshcoreInterval);
    }

    fetchMeshcoreNodes();

    meshcoreInterval = setInterval(() => {
        fetchMeshcoreNodes();
    }, POLL_INTERVAL_MS);

    logSystem("MESHCORE: MeshCore polling initialized (10 minute interval)");
}

function cleanupMeshcore() {
    if (meshcoreInterval) {
        clearInterval(meshcoreInterval);
        meshcoreInterval = null;
        logSystem("MESHCORE: MeshCore polling stopped");
    }
    // Clear meshcore nodes from map
    meshcoreNodes.clear();
    updateCombinedMeshData();
}

window.initMeshtastic = initMeshtastic;
window.cleanupMeshtastic = cleanupMeshtastic;
window.initMeshcore = initMeshcore;
window.cleanupMeshcore = cleanupMeshcore;
window.fetchMeshNodes = fetchMeshNodes;
window.fetchMeshcoreNodes = fetchMeshcoreNodes;
window.updateCombinedMeshData = updateCombinedMeshData;
window.updateFilterCounts = updateFilterCounts;
window.meshtasticFilters = meshtasticFilters;
window.meshcoreFilters = meshcoreFilters;

console.log('MESH: mesh.js loaded successfully');