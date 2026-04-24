require('dotenv').config();
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

//const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? null;
//const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? null;
/*** const { sendTelegramMessage } = require('./helpers/sendTelegramHelper');
(async () => {
    const tempMessage = `PAUL ANDRE BALAYO
        DateTime: WED, APR 15, 2026 06:00 PM
        Biometric#: 722
        VerifyMethod: TIME OUT
        DeviceName: BIOMETRIC DEVICE - IN05A`;
    const response = await sendTelegramMessage(telegramBotToken, telegramChatId, tempMessage);
    console.log(response);
})(); ***/