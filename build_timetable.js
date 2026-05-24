const fs = require('fs');
const csv = require('csv-parser');

async function buildSchedule() {
    console.log("1. Finding Ferry Routes...");
    const ferryRouteIds = new Set();
    
    // Read the routes file to find only the ferries
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/routes.txt').pipe(csv())
            .on('data', row => {
                // route_type 4 is Ferry. We also check for 'SMBI' just in case.
                if (row.route_type === '4' || row.route_id.includes('SMBI')) {
                    ferryRouteIds.add(row.route_id);
                }
            })
            .on('end', resolve);
    });
    console.log(`Found ${ferryRouteIds.size} ferry routes.`);

    console.log("2. Finding Ferry Trips...");
    const ferryTrips = new Set();
    const tripDirections = {};
    
    // Read the trips file to match route IDs to specific trips (like the 7:00am run)
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/trips.txt').pipe(csv())
            .on('data', row => {
                if (ferryRouteIds.has(row.route_id)) {
                    ferryTrips.add(row.trip_id);
                    // Save where this trip is heading
                    tripDirections[row.trip_id] = row.trip_headsign || "Ferry"; 
                }
            })
            .on('end', resolve);
    });
    console.log(`Found ${ferryTrips.size} ferry trips.`);

    console.log("3. Building Server Dictionary (Now with Route IDs!)...");
    const tripData = {};
    const tripDict = {}; 
    const smbiShapeIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/trips.txt').pipe(csv())
            .on('data', row => {
                if (ferryRouteIds.has(row.route_id)) {
                    
                    // --- NEW LOGIC: Detect Terminating Runs ---
                    const headsign = row.trip_headsign ? row.trip_headsign.toLowerCase() : "ferry";
                    let isTerminating = false;
                    
                    // If the headsign says Russell but NOT Redland Bay, it's trapped on the islands!
                    if (headsign.includes("russell") && !headsign.includes("redland")) {
                        isTerminating = true;
                    }

                    tripData[row.trip_id] = {
                        destination: row.trip_headsign || "Ferry",
                        service_id: row.service_id
                    };
                    
                    tripDict[row.trip_id] = {
                        destination: row.trip_headsign || "Ferry",
                        route_id: row.route_id,
                        shape_id: row.shape_id,
                        is_terminating: isTerminating // <-- We save the flag here!
                    };
                    if (row.shape_id) smbiShapeIds.add(row.shape_id);
                }
            })
            .on('end', resolve);
    });
    fs.writeFileSync('./trip-dict.json', JSON.stringify(tripDict, null, 2));

    console.log("4. Crunching 100MB of Stop Times (This will take 10-20 seconds)...");
    const schedule = [];
    
    // Stream the massive stop_times file, keeping ONLY the rows that match our ferry trips and island stops
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/stop_times.txt').pipe(csv())
            .on('data', row => {
                if (ferryTrips.has(row.trip_id) && targetStops[row.stop_id]) {
                    schedule.push({
                        time: row.arrival_time,
                        destination: tripDirections[row.trip_id],
                        stop: targetStops[row.stop_id]
                    });
                }
            })
            .on('end', resolve);
    });

    console.log(`Extracted ${schedule.length} schedule entries!`);
    
    // Save the clean, tiny data file directly into our public folder so the website can read it!
    fs.writeFileSync('./public/smbi-timetable.json', JSON.stringify(schedule, null, 2));
    console.log("SUCCESS! Saved to public/smbi-timetable.json");
}
