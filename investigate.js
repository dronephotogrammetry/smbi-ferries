const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

async function runXRay() {
    console.log("📡 Pinging TransLink for live ferry data...");
    
    try {
        const response = await fetch('http://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions');
        const buffer = await response.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

        const ferries = feed.entity.filter(entity => {
            const routeId = entity.vehicle?.trip?.routeId;
            return routeId && (routeId.includes('SMBI') || routeId.includes('299'));
        });

        console.log(`\n⛴️ Found ${ferries.length} ferries currently on the water. Here is their raw data:\n`);

        ferries.forEach((ferry, index) => {
            console.log(`--- Ferry ${index + 1} ---`);
            console.log(`Vehicle ID:    ${ferry.vehicle.vehicle.id}`);
            console.log(`Trip ID:       ${ferry.vehicle.trip.tripId}`);
            console.log(`Route ID:      ${ferry.vehicle.trip.routeId}`);
            console.log(`Direction ID:  ${ferry.vehicle.trip.directionId}`);
            console.log(`Current Stop:  Sequence ${ferry.vehicle.currentStopSequence}`);
            console.log('------------------\n');
        });

    } catch (error) {
        console.error("Failed to fetch feed:", error);
    }
}

runXRay();