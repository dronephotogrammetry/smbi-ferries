const express = require('express');
const cors = require('cors');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fs = require('fs');

const app = express();
const port = 3000;
app.use(cors());
app.use(express.static('public'));

// --- LOAD TRIP DICTIONARY ---
let tripDict = {};
try {
    tripDict = JSON.parse(fs.readFileSync('./trip-dict.json', 'utf8'));
    console.log(`Loaded ${Object.keys(tripDict).length} trip destinations into memory.`);
} catch (error) {
    console.error("Warning: trip-dict.json not found. Run cruncher first!");
}

// --- CACHING & MEMORY SYSTEM ---
let cachedFerryData = [];
let lastFetchTime = 0;
const CACHE_LIFESPAN = 15000;
const serverFerryHistory = {}; // NEW: The server's memory bank!

app.get('/api/ferries', async (req, res) => {
    try {
        const now = Date.now();
        if (now - lastFetchTime < CACHE_LIFESPAN && cachedFerryData.length > 0) {
            return res.json(cachedFerryData);
        }

        const response = await fetch('http://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions');
        if (!response.ok) throw new Error(`Network error: ${response.status}`);

        const buffer = await response.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

        const smbiFerries = feed.entity.filter(entity => {
            const routeId = entity.vehicle?.trip?.routeId;
            if (!routeId) return false; 
            return routeId.includes('SMBI') || routeId.includes('299');
        });

        const cleanFerryList = smbiFerries.map(ferry => {
            const tripId = ferry.vehicle.trip.tripId;
            const tripInfo = tripDict[tripId] || { destination: "Islands", route_id: "Unknown" };

            const rawId = ferry.vehicle.vehicle.id;
            const vesselName = rawId.includes('_') ? rawId.split('_')[1] : "SMBI Ferry";
            
            const currentLat = ferry.vehicle.position.latitude;
            const currentLon = ferry.vehicle.position.longitude;

            // --- UPDATE SERVER MEMORY ---
            if (!serverFerryHistory[rawId]) {
                serverFerryHistory[rawId] = [];
            }
            
            // Only add a new dot to the tail if the ferry actually moved (prevents bunched up tails when docked)
            const history = serverFerryHistory[rawId];
            const lastPos = history[history.length - 1];
            if (!lastPos || lastPos[0] !== currentLat || lastPos[1] !== currentLon) {
                history.push([currentLat, currentLon]);
                if (history.length > 4) {
                    history.shift(); // Keep only the last 4 positions
                }
            }

            return {
                id: rawId,
                vesselName: vesselName,
                staticRouteId: tripInfo.route_id,
                destination: tripInfo.destination,
                latitude: currentLat,
                longitude: currentLon,
                history: history // NEW: Send the pre-built tail to the phone!
            };
        });

        cachedFerryData = cleanFerryList;
        lastFetchTime = Date.now();
        res.json(cachedFerryData);

    } catch (error) {
        console.error("Something went wrong:", error);
        res.status(500).json({ error: "Failed to fetch ferry data" });
    }
});

app.listen(port, () => {
    console.log(`SMBI Live Server running on port ${port}`);
});