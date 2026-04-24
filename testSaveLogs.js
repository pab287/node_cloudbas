require('dotenv').config();
const { backupAttendance } = require('./helpers/backupDeviceLogs');
const { getActiveDevices } = require('./dbrecord');

const getAllDevices = async () => {
    const d = await getActiveDevices();
    d.forEach(device => {
        const deviceSN = device.sn.toUpperCase();
        const nDevice = { ip: device.ip_address, port:device.port, sn: deviceSN };
        backupAttendance(nDevice);
    });
}

getAllDevices();