const { syncRemoteEmployeeRecords } = require('./helpers/syncEmployeeRecords');
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

/*** const { sendTelegramMessage } = require('./helpers/sendTelegramHelper');
(async () => {
    const chatId = '1421640013';
    const botToken = '5980215549:AAFzR0QvoupYMO45Q8HAMXwgRElhmnFc9lQ';
    const tempMessage = `PAUL ANDRE BALAYO
        DateTime: WED, APR 15, 2026 06:00 PM
        Biometric#: 722
        VerifyMethod: TIME OUT
        DeviceName: BIOMETRIC DEVICE - IN05A`;
    const response = await sendTelegramMessage(botToken, chatId, tempMessage);
    console.log(response);
})(); ***/