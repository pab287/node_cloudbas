// helpers/fileHelper.js
const fs = require("fs");

async function fileExists(filePath) {
    return new Promise((resolve) => {
        fs.access(filePath, fs.constants.F_OK, (err) => {
            resolve(!err); // true if exists, false if not
        });
    });
}

module.exports = { fileExists };
