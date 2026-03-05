require('dotenv').config();
const net = require("net");
const moment = require('moment');
const https = require('https');
const axios = require("axios");
const agent = new https.Agent({ rejectUnauthorized: false });

const checkPortReachable = async function(host, port, timeout = 3000){
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let isDone = false;

        const cleanup = () => {
            if (!isDone) {
                isDone = true;
                socket.destroy();
            }
        };

        socket.setTimeout(timeout);

        socket.on("connect", () => {
            cleanup();
            resolve(true);
        });

        socket.on("timeout", () => {
            cleanup();
            resolve(false);
        });

        socket.on("error", () => {
            cleanup();
            resolve(false);
        });

        socket.connect(port, host);
    });
}

const phoneRegex = /^(?:\+639\d{9}|09\d{9}|9\d{9})$/;
function validatePhoneNumber(phoneNumber) {
    return phoneRegex.test(phoneNumber);
}

function updatePhoneNumber(phoneNumber){
    const nextRegex = /^9\d{9}$/;
    let nextPhoneNumber = phoneNumber;
    if (nextRegex.test(nextPhoneNumber)) {
        nextPhoneNumber = "+63" + nextPhoneNumber;
    }
    return nextPhoneNumber;
}

const sendSms = async function (phoneNumber, message) {
    const smsIp = process.env.SMS_IP ?? "192.168.7.62";
    const smsPort = process.env.SMS_PORT ?? 443;
    const smsUser = process.env.SMS_USER ?? "VoP";
    const smsPass = process.env.SMS_PASS ?? "3642ab11b34772f2de2af566f0830c56";
    const smsModem = process.env.SMS_MODEM ?? "modem7";

    if (!phoneNumber || !message) {
        return { success: false, message: "Phone number and message are required." };
    }

    const isValidPhoneNumber = validatePhoneNumber(phoneNumber);
    if (!isValidPhoneNumber) {
        return { success: false, message: "Invalid phone number format." };
    }

    const nPhoneNumber = updatePhoneNumber(phoneNumber);
    const smsUrl = `https://${smsIp}:${smsPort}/index.php`;

    const reachable = await checkPortReachable(smsIp, smsPort);
    if (!reachable) {
        return { success: false, message: `SMS Gateway ${smsIp}:${smsPort} not reachable.` };
    }

    try {
        const params = {
            app: "ws",
            op: "pv",
            u: smsUser,
            h: smsPass,
            smsc: smsModem,
            to: nPhoneNumber,
            msg: message,
        };

        const res = await axios.get(smsUrl, { params, httpsAgent: agent });
        const statusObj = res.data?.data?.find(d => d.status);
        
        let ok = false;

        if (typeof res.data === "string") {
            ok = res.data.includes("OK");
        } else if (typeof res.data === "object") {
            // ✅ Using your preferred line
            const status = res.data?.data?.find(d => d.status)?.status;
            ok = status && status.toUpperCase() === "OK";
        }
        
        if (ok) {
            return {
                success: true,
                message: `SMS sent successfully to ${nPhoneNumber}.`,
                response: statusObj,
            };
        } else {
            return {
                success: false,
                message: `SMS failed to send. Response: ${JSON.stringify(res.data)}`,
                response: statusObj,
            };
        }
    } catch (error) {
        console.error("SMS Error:", error.message);
        return { success: false, message: `Error sending SMS: ${error.message}` };
    }
};

module.exports = { sendSms };