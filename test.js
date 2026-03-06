const syncRemoteEmployeeRecords = require('./helpers/syncEmployeeRecords');
(async () => {
    try {
        await syncRemoteEmployeeRecords();
        console.log("All sync tasks finished");
        process.exit(0); // Important for CLI scripts
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();