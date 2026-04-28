require('dotenv').config();
const { execSync } = require('child_process');

const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const {
  updateEmployeeImagePath,
  createEmployeeThumbnails,
  generateImageThumbnail,
  resizeEmployeeThumbnails,
} = require('./helpers/imageThumbs');

const {
  syncRemoteEmployeeRecords,
  syncAndRepairFileExist
} = require('./helpers/syncEmployeeRecords');

const rl = readline.createInterface({ input, output });

function commandExists(command) {
  try {
    execSync(`${command} -v`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runPm2Reload() {
  if (!commandExists('pm2')) {
    console.log('PM2 not found. Skipping pm2 flush/reload.');
    return;
  }

  console.log('PM2 found. Flushing logs...');
  execSync('pm2 flush', { stdio: 'inherit' });

  console.log('Reloading PM2 process 0...');
  execSync('pm2 reload 0', { stdio: 'inherit' });

  console.log('✔ PM2 process 0 reloaded.');
}

async function askNumber(question, defaultValue = null) {
  const answer = await rl.question(question);

  if (!answer && defaultValue !== null) return defaultValue;

  const number = Number(answer);

  if (Number.isNaN(number)) {
    console.log('Invalid number. Try again.');
    return askNumber(question, defaultValue);
  }

  return number;
}

async function showMenu() {
  console.log('\n=== Employee Tools CLI ===');
  console.log('1. Sync remote employee records'); // moved to top
  console.log('2. Create employee thumbnails');
  console.log('3. Update employee image path');
  console.log('4. Generate single employee thumbnail');
  console.log('5. Resize employee thumbnails');
  console.log('0. Exit');

  return (await rl.question('\nSelect an option: ')).trim();
}

async function main() {
  try {
    while (true) {
      const choice = await showMenu();

      try {
        switch (choice) {
          case '1': {
            console.log('Syncing and repairing employee records...');
            await syncAndRepairFileExist();
            console.log('✔ Sync + file repair completed.');
            runPm2Reload();
            break;
          }

          case '2': {
            const width = await askNumber('Width? Default 120: ', 120);
            const height = await askNumber('Height? Default 120: ', 120);

            await createEmployeeThumbnails(width, height);
            console.log('✔ Employee thumbnails created.');
            break;
          }

          case '3': {
            await updateEmployeeImagePath();
            console.log('✔ Employee image paths updated.');
            break;
          }

          case '4': {
            const employeeId = await askNumber('Employee ID? ');
            const filename = await rl.question('Image filename? ');

            if (!filename.trim()) {
              console.log('Filename is required.');
              break;
            }

            await generateImageThumbnail(employeeId, filename.trim());
            console.log('✔ Thumbnail generated.');
            break;
          }

          case '5': {
            const width = await askNumber('Width? Default 120: ', 120);
            const height = await askNumber('Height? Default 120: ', 120);
            const overwriteAnswer = await rl.question('Overwrite existing? (yes/no, default yes): ');

            const overwrite = !overwriteAnswer || overwriteAnswer.toLowerCase().startsWith('y');

            await resizeEmployeeThumbnails(width, height, overwrite);
            console.log('✔ Thumbnails resized.');
            break;
          }

          case '0':
          case 'exit':
            console.log('Goodbye.');
            process.exit(0);

          default:
            console.log('Invalid option. Try again.');
        }
      } catch (err) {
        console.error('Task failed:', err.message || err);
      }
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();