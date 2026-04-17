require('dotenv').config();
const moment = require('moment');
const axios = require("axios");
const { storeSyncedEmployeeRecords, updateAttendanceLogSent } = require('../dbrecord');

const REMPREC_URL = process.env.REMOTE_EMPLOYEE_RECORDS ?? null;

const getRemoteEmployeeRecords = async () => {
    if (!REMPREC_URL) {
        console.error("REMPREC_URL is not defined");
        return [];
    }
    try {
        const dateTime = moment().format("YYYYMMDD");
        const remoteUrl = `${REMPREC_URL}/${dateTime}`;
        console.log("Fetching:", remoteUrl);
        const response = await axios.get(remoteUrl, {
            timeout: 30000, // 30 seconds timeout
            headers: { "Accept": "application/json" }
        });

        const { data } = response.data;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Error fetching remote employee records:", error.message);
        return [];
    }
};

const syncRemoteEmployeeRecords = async () => {
  const employeeRecords = await getRemoteEmployeeRecords();
  console.log("Total employees:", employeeRecords.length);
  const chunkSize = 500;
  for (let i = 0; i < employeeRecords.length; i += chunkSize) {
    const chunk = employeeRecords.slice(i, i + chunkSize);
    console.log(`Syncing chunk ${i / chunkSize + 1}`);
    try {
      const result = await storeSyncedEmployeeRecords(chunk);
      console.log(result.message);
    } catch (err) {
      console.error("Sync failed:", err);
    }
  }
  console.log("✅ Sync Employee Records Completed!");
  return true;
};

module.exports = { syncRemoteEmployeeRecords };