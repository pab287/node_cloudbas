const fs = require("fs");
const path = require("path");
const logFile = path.join(__dirname, "server.log");

function log(message) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg.trim()); // still show in console
    fs.appendFileSync(logFile, logMsg + "\n", "utf8"); // write to log file
}

module.exports = { log };