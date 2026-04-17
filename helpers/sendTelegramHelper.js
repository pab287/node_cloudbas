const axios = require('axios');
const dns = require('dns').promises;

async function hasInternet() {
    try {
        await dns.lookup('google.com');
        return true;
    } catch {
        return false;
    }
}

async function sendTelegramMessage(botToken, chatId, message) {
    const telegramBotUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // 🌐 Check internet first
    const internet = await hasInternet();

    if (!internet) {
        return {
            ok: false,
            reachable: false,
            internet: false,
            message: 'No internet connection'
        };
    }

    try {
        const params = new URLSearchParams();
        params.append('chat_id', chatId);
        params.append('text', message);
        params.append('parse_mode', 'HTML');

        const response = await axios.post(telegramBotUrl, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 5000
        });

        return {
            ok: true,
            internet: true,
            reachable: true,
            data: response.data
        };

    } catch (error) {

        // Telegram unreachable but internet exists
        if (
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT'
        ) {
            return {
                ok: false,
                internet: true,
                reachable: false,
                message: 'Telegram API not reachable',
                error: error.message
            };
        }

        // API responded with error
        if (error.response) {
            return {
                ok: false,
                internet: true,
                reachable: true,
                message: 'Telegram API responded with error',
                error: error.response.data
            };
        }

        return {
            ok: false,
            internet: true,
            reachable: false,
            message: 'Unknown error',
            error: error.message
        };
    }
}

module.exports = { sendTelegramMessage };