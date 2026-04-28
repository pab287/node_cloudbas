require('dotenv').config();

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const axios = require('axios');

const {
  storeSyncedEmployeeRecords,
  updateAttendanceLogSent,
} = require('../dbrecord');

const REMPREC_URL = process.env.REMOTE_EMPLOYEE_RECORDS ?? null;

// Change this to your actual employee image folder
const EMPLOYEE_IMAGE_DIR = process.env.EMPLOYEE_IMAGE_DIR
  ? path.resolve(process.env.EMPLOYEE_IMAGE_DIR)
  : null;

const getRemoteEmployeeRecords = async () => {
  if (!REMPREC_URL) {
    console.error('REMPREC_URL is not defined');
    return [];
  }

  try {
    const dateTime = moment().format('YYYYMMDD');
    const remoteUrl = `${REMPREC_URL}/${dateTime}`;

    console.log('Fetching:', remoteUrl);

    const response = await axios.get(remoteUrl, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });

    const { data } = response.data;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error fetching remote employee records:', error.message);
    return [];
  }
};

const syncRemoteEmployeeRecords = async () => {
  const employeeRecords = await getRemoteEmployeeRecords();

  console.log('Total employees:', employeeRecords.length);

  const chunkSize = 500;

  for (let i = 0; i < employeeRecords.length; i += chunkSize) {
    const chunk = employeeRecords.slice(i, i + chunkSize);

    console.log(`Syncing chunk ${i / chunkSize + 1}`);

    try {
      const result = await storeSyncedEmployeeRecords(chunk);
      console.log(result.message);
    } catch (err) {
      console.error('Sync failed:', err);
    }
  }

  console.log('✅ Sync Employee Records Completed!');
  return true;
};

function fixBadEncoding(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function normalizeFilename(name) {
  if (!name) return '';

  const fixed = fixBadEncoding(name);

  return fixed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function repairEmployeeImageFilename(folderPath, dbFilename) {
  if (!dbFilename) return null;

  if (!fs.existsSync(folderPath)) {
    console.log(`Image folder does not exist: ${folderPath}`);
    return null;
  }

  const files = fs.readdirSync(folderPath);
  const dbCleanName = normalizeFilename(dbFilename);

  const matchedFile = files.find((file) => {
    return normalizeFilename(file) === dbCleanName;
  });

  if (!matchedFile) {
    console.log(`No matching file found for: ${dbFilename}`);
    return null;
  }

  if (matchedFile === dbFilename) {
    console.log(`Already correct: ${dbFilename}`);
    return dbFilename;
  }

  const oldPath = path.join(folderPath, matchedFile);
  const newPath = path.join(folderPath, dbFilename);

  if (fs.existsSync(newPath)) {
    console.log(`Target already exists, skipping: ${dbFilename}`);
    return null;
  }

  fs.renameSync(oldPath, newPath);

  console.log(`Renamed: ${matchedFile} -> ${dbFilename}`);

  return dbFilename;
}

const syncAndRepairFileExist = async () => {
  if (!EMPLOYEE_IMAGE_DIR) {
    console.log('EMPLOYEE_IMAGE_DIR is not defined');
    return false;
  }

  const employeeRecords = await getRemoteEmployeeRecords();

  console.log('Total employees:', employeeRecords.length);

  const chunkSize = 500;

  for (let i = 0; i < employeeRecords.length; i += chunkSize) {
    const chunk = employeeRecords.slice(i, i + chunkSize);

    console.log(`Syncing chunk ${i / chunkSize + 1}`);

    try {
      const result = await storeSyncedEmployeeRecords(chunk);
      console.log(result.message);
    } catch (err) {
      console.error('Sync failed:', err);
    }
  }

  console.log('Repairing employee image filenames...');

  let repairedCount = 0;

  for (const employee of employeeRecords) {
    const dbFilename =
      employee.pic_filename ||
      employee.picFilename ||
      employee.image_filename ||
      employee.imageFilename;

    const employeeFolder = path.join(
      EMPLOYEE_IMAGE_DIR,
      `empcode_${employee.employee_id}`
    );

    const repaired = repairEmployeeImageFilename(employeeFolder, dbFilename);
    if (repaired) repairedCount++;
  }

  console.log(`✅ File repair completed. Repaired/verified: ${repairedCount}`);
  console.log('✅ Sync and repair completed!');

  return true;
};

module.exports = {
  syncRemoteEmployeeRecords,
  syncAndRepairFileExist,
};