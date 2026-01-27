# GEOINT.WORLD

Open-source geospatial intelligence platform for real-time monitoring of aviation, maritime, space, communications infrastructure, and global events.

## Overview

GEOINT.WORLD is a web-based situational awareness tool that aggregates and visualizes real-time data from multiple open-source intelligence feeds. The platform provides a unified interface for tracking aircraft, ships, satellites, mesh networks, submarine cables, news events, and prediction markets.

## Features

### Aviation
- Real-time ADS-B flight tracking via OpenSky Network and ADSB.LOL
- Emergency squawk code detection (7700, 7600, 7500, SPI)
- Military, PIA, and LADD aircraft monitoring
- Altitude filtering and custom squawk code search

### Maritime
- Global vessel tracking via AIS telemetry
- Dark fleet monitoring (AIS gap visualization)
- Fishing activity, loitering, and encounter detection
- Global Fishing Watch integration

### Space
- Satellite orbital tracking using SGP4 propagation
- TLE data from CelesTrak (NORAD)
- Starlink, GPS, ISS, and debris monitoring
- Real-time position calculation in browser

### Communications
- Radio station mapping (AM/FM/Shortwave)
- Radio repeater locations
- LoRa mesh network nodes (Meshtastic/Meshcore)
- Submarine cable infrastructure mapping

### Intelligence Feeds
- GDELT news feed with keyword filtering
- Polymarket prediction markets for geopolitical events
- USGS earthquake data visualization

### Blockchain Integration
- Solana-based inscription system for data permanence
- $GEOINT token planned for Phase III

## Technology Stack

### Frontend
- HTML5, CSS3, Vanilla JavaScript
- Mapbox GL JS for map rendering
- Client-side SGP4 satellite propagation
- WebSocket connections for live data

### Data Sources
- OpenSky Network (Aviation)
- ADSB.LOL (Uncensored Aircraft)
- Global Fishing Watch (Maritime)
- CelesTrak (Satellite TLE)
- MeshMap/Meshcore (LoRa)
- Telegeography (Submarine Cables)
- GDELT Project (News)
- Polymarket (Predictions)
- USGS (Earthquakes)

### Infrastructure
- Static file hosting (Apache/XAMPP)
- Client-side data processing
- LocalStorage caching
- CORS proxy fallback for API requests

## Project Structure

```
html/
├── index.html           # Landing page
├── datamap.html         # Main application
├── legal.html           # Legal/privacy information
├── css/
│   └── style.css        # Main stylesheet
├── js/
│   ├── flights.js       # Aviation module
│   ├── ships.js         # Maritime module
│   ├── space.js         # Satellite tracking
│   ├── mesh.js          # LoRa mesh networks
│   ├── cables.js        # Submarine cables
│   ├── radio.js         # Radio stations/repeaters
│   ├── news.js          # GDELT news feed
│   ├── polymarket.js    # Prediction markets
│   ├── earthquakes.js   # Seismic data
│   ├── map.js           # Map initialization
│   ├── ui.js            # UI controls
│   ├── utils.js         # Utility functions
│   └── globals.js       # Global configuration
├── docs/                # Documentation pages
└── favicon/             # Icons and manifests
```

## Installation

### Requirements
- Web server (Apache, Nginx, or similar)
- Modern browser with WebGL support

### Local Development

1. Clone the repository
2. Point web server to the `html` directory
3. Access via `http://localhost/`

For XAMPP:
```bash
# Place files in C:\xampp\htdocs\geoint\html
# Start Apache
# Navigate to http://localhost/geoint/html/
```

## Configuration

- Mapbox access token required in `js/globals.js`
- API endpoints configurable per module
- Cache TTL settings in individual JS modules

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

WebGL and modern JavaScript features required.

## Data Refresh Intervals

- Flights: 1 minute
- Ships: 1 minute
- Satellites: 1 minute (position recalculated every frame)
- News: 12/24 hour options
- Prediction Markets: 30 minutes
- Earthquakes: Real-time USGS feed

## Performance

- Client-side data filtering to minimize bandwidth
- LocalStorage caching with configurable TTL
- Lazy loading of map layers
- Optimized rendering for thousands of data points

## Documentation

Comprehensive documentation available at `/docs/`:
- Getting Started Guide
- Feature-specific documentation
- API integration details
- Inscription system documentation
- Project roadmap

## Roadmap

### Phase I: Core Infrastructure
- Multi-source data aggregation
- Real-time visualization engine

### Phase II: Advanced Intelligence
- Signal analytics and pattern detection
- Mesh network expansion

### Phase III: Tokenization
- $GEOINT token launch on Solana
- Inscription burn mechanism for data permanence

### Phase IV: Expansion
- Additional data sources
- Enhanced analytical capabilities

## License

Open source. See LICENSE file for details.

## Contact

Website: https://geoint.world
Email: contact@geoint.world

## Contributing

Contributions welcome. Please follow existing code style and documentation standards.
