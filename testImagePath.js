const { updateEmployeeImagePath } = require('./helpers/imageThumbs');
(async () => {
    try {
        await updateEmployeeImagePath();
        console.log("All sync tasks finished");
        process.exit(0); // Important for CLI scripts
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();