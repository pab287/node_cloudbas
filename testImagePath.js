const { updateEmployeeImagePath, createEmployeeThumbnails, generateImageThumbnail, resizeEmployeeThumbnails } = require('./helpers/imageThumbs');
(async () => {
    try {
        //await generateImageThumbnail(47, 'Lady_Mae_Abalajon.jpg');
        //await createEmployeeThumbnails(120, 120);
        //await updateEmployeeImagePath();
        await resizeEmployeeThumbnails(120, 120, true);

        console.log("All sync tasks finished");
        process.exit(0); // Important for CLI scripts
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();