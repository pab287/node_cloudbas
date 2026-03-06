const path = require("path");
const sharp = require('sharp');
const fs = require('fs-extra');

const { fileExists } = require("./fileHelper");
const pool = require('../config/db');
const util = require("util");
const BATCH_SIZE = 10;

const imageCheckerExist = async function(id = 0, imageFile = null, thumbnails = false) {
    let imagePath = null;
    if (id && imageFile && imageFile !== 'no_image.jpg') {
      let arrPath = [ 'uploads', 'files', 'images', 'employee_files', `empcode_${id}` ];
      if(thumbnails) { arrPath.push('thumbnails'); }
      const tempDirectory = path.join(...arrPath);
      const filePath = path.join(__dirname, '..', 'public', tempDirectory, imageFile);
      console.log("🔍 Checking:", filePath);
      if (await fileExists(filePath)) {
          console.log("✅ File found:", filePath);
          imagePath = path.join(tempDirectory, imageFile).replace(/\\/g, '/');
      } else {
          console.log("❌ File not found:", filePath);
      }
    }
    return imagePath;
};

const generateImageThumbnail = async (id=0, imageFilePath=null) => {
	if(id && imageFilePath){
		let imagePath = await imageCheckerExist(id, imageFilePath, false);
		imagePath = imagePath || 'assets/media/avatars/blank.png';
		
		const fileExists = async (filePath) => {
		  try {
			await fs.access(filePath);
			return true;
		  } catch {
			return false;
		  }
		};

		// Process a single employee record
		const processRecord = async (record) => {
		  try {
			const empDir = path.join('uploads', 'images', 'employee_files', `empcode_${record.employee_id}`);
			const imageFile = path.join(__dirname, 'public', empDir, record.pic_filename);
			const thumbDir = path.join(__dirname, 'public', empDir, 'thumbnails');
			const thumbnailFile = path.join(thumbDir, record.pic_filename);

			// Skip if source image doesn’t exist
			if (!(await fileExists(imageFile))) {
			  console.log(`❌ File not found for employee_id ${record.employee_id}:`, imageFile);
			  return;
			}

			// Skip if thumbnail already exists
			if (await fileExists(thumbnailFile)) {
			  console.log(`⏩ Thumbnail already exists for employee_id ${record.employee_id}, skipping...`);
			  return;
			}

			// Ensure thumbnails folder exists
			await fs.ensureDir(thumbDir);

			// Create 75x75 thumbnail
			await sharp(imageFile)
			  .resize(120, 120, { fit: 'cover', position: 'center' })
			  .toFile(thumbnailFile);

			console.log(`✅ Thumbnail created for employee_id ${record.employee_id}:`, thumbnailFile);
		  } catch (innerErr) {
			console.error(`❌ Error processing employee_id ${record.employee_id}:`, innerErr.message);
		  }
		};
		
		
		if(imagePath != 'assets/media/avatars/blank.png'){
			processRecord({ employee_id: id, pic_filename: imageFilePath });			
		}
	
		console.log('Image Path', imagePath);
	}else{
		console.log('No response!');
	}
}

const createEmployeeThumbnails = async function (w=75, h=75) {
  let conn;
  try {
    const getConnection = util.promisify(pool.getConnection).bind(pool);
    conn = await getConnection();
    const query = util.promisify(conn.query).bind(conn);

    const sqlSelect = `SELECT id, employee_id, pic_filename, image_path FROM employees ORDER BY id ASC`;
    const records = await query(sqlSelect);

    if (!records.length) {
      console.log("No employee records found.");
      return;
    }

    console.log(`🧩 Found ${records.length} employees. Processing in batches of ${BATCH_SIZE}...`);

    // Helper: check if file exists
    const fileExists = async (filePath) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    };

    // Process a single employee record
    const processRecord = async (record) => {
      try {
        const empDir = path.join('uploads', 'files', 'images', 'employee_files', `empcode_${record.employee_id}`);
        const imageFile = path.join(__dirname, 'public', empDir, record.pic_filename);
        const thumbDir = path.join(__dirname, 'public', empDir, 'thumbnails');
        const thumbnailFile = path.join(thumbDir, record.pic_filename);

        // Skip if source image doesn’t exist
        if (!(await fileExists(imageFile))) {
          console.log(`❌ File not found for employee_id ${record.employee_id}:`, imageFile);
          return;
        }

        // Skip if thumbnail already exists
        if (await fileExists(thumbnailFile)) {
          console.log(`⏩ Thumbnail already exists for employee_id ${record.employee_id}, skipping...`);
          return;
        }

        // Ensure thumbnails folder exists
        await fs.ensureDir(thumbDir);

        // Create 75x75 thumbnail
        await sharp(imageFile)
          .resize(w, h, { fit: 'cover', position: 'center' })
          .toFile(thumbnailFile);

        console.log(`✅ Thumbnail created for employee_id ${record.employee_id}:`, thumbnailFile);
      } catch (innerErr) {
        console.error(`❌ Error processing employee_id ${record.employee_id}:`, innerErr.message);
      }
    };

    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processRecord));
      console.log(`📦 Batch ${i / BATCH_SIZE + 1} completed.`);
    }

    console.log("🎉 All employee thumbnails created successfully.");
  } catch (err) {
    console.error("❌ Database error:", err.message);
  } finally {
    if (conn) conn.release();
  }
};

const resizeEmployeeThumbnails = async function (w = 75, h = 75, resize = false) {
  let conn;
  try {
    const getConnection = util.promisify(pool.getConnection).bind(pool);
    conn = await getConnection();
    const query = util.promisify(conn.query).bind(conn);

    const sqlSelect = `SELECT id, employee_id, pic_filename, image_path FROM employees ORDER BY id ASC`;
    const records = await query(sqlSelect);

    if (!records.length) {
      console.log("No employee records found.");
      return;
    }

    console.log(`🧩 Found ${records.length} employees. Processing in batches of ${BATCH_SIZE}...`);

    const fileExists = async (filePath) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    };

    const processRecord = async (record) => {
      try {
        const empDir = path.join(
          'uploads',
          'images',
          'employee_files',
          `empcode_${record.employee_id}`
        );
        const imageFile = path.join(__dirname, 'public', empDir, record.pic_filename);
        const thumbDir = path.join(__dirname, 'public', empDir, 'thumbnails');
        const thumbnailFile = path.join(thumbDir, record.pic_filename);

        if (!(await fileExists(imageFile))) {
          console.log(`❌ File not found for employee_id ${record.employee_id}:`, imageFile);
          return;
        }

        // Handle existing thumbnail logic
        const thumbExists = await fileExists(thumbnailFile);

        if (thumbExists && !resize) {
          console.log(`⏩ Thumbnail already exists for employee_id ${record.employee_id}, skipping...`);
          return;
        }

        if (thumbExists && resize) {
          console.log(`♻️ Resizing existing thumbnail for employee_id ${record.employee_id}...`);
        } else if (!thumbExists) {
          console.log(`🆕 Creating thumbnail for employee_id ${record.employee_id}...`);
        }

        await fs.ensureDir(thumbDir);

        await sharp(imageFile)
          .resize(w, h, { fit: 'cover', position: 'center' })
          .toFile(thumbnailFile);

        console.log(`✅ Thumbnail processed for employee_id ${record.employee_id}:`, thumbnailFile);
      } catch (innerErr) {
        console.error(`❌ Error processing employee_id ${record.employee_id}:`, innerErr.message);
      }
    };

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processRecord));
      console.log(`📦 Batch ${i / BATCH_SIZE + 1} completed.`);
    }

    console.log("🎉 All employee thumbnails processed successfully.");
  } catch (err) {
    console.error("❌ Database error:", err.message);
  } finally {
    if (conn) conn.release();
  }
};

const updateEmployeeImagePath = async function () {
  try {
    const getConnection = util.promisify(pool.getConnection).bind(pool);
    const conn = await getConnection();
    const query = util.promisify(conn.query).bind(conn);

    const sqlSelect = `SELECT id, employee_id, pic_filename, thumb_path FROM employees ORDER BY id ASC`;
    const records = await query(sqlSelect);

    if (!records.length) {
      console.log("No employee records found.");
      conn.release();
      return;
    }

    console.log(`🧩 Found ${records.length} employees. Updating in batches of ${BATCH_SIZE}...`);

    // Function to process one record
    const processRecord = async (record) => {
      try {
        let imagePath = await imageCheckerExist(record.employee_id, record.pic_filename, true);
        imagePath = imagePath || 'assets/media/avatars/blank.png';
        console.log(`⏩ Checking employee_id ${record.employee_id}:`, imagePath);
        if (record.thumb_path !== imagePath) {
          const updateSql = `UPDATE employees SET thumb_path = ? WHERE id = ?`;
          const result = await query(updateSql, [imagePath, record.id]);
          if (result.affectedRows === 1) {
            console.log(`✅ Updated employee_id ${record.employee_id}: ${imagePath}`);
          }
        } else {
          console.log(`ℹ️ Skipped (no change): employee_id ${record.employee_id}`);
        }
      } catch (innerErr) {
        console.error(`❌ Error updating employee_id ${record.employee_id}:`, innerErr.message);
      }
    };

    // Batch processor
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      console.log(`⚙️ Processing batch ${i / BATCH_SIZE + 1} (${batch.length} employees)...`);

      // Run batch in parallel
      await Promise.all(batch.map((record) => processRecord(record)));
    }

    console.log("✅ All employee image paths checked/updated successfully.");
    conn.release();
  } catch (err) {
    console.error("❌ Database error:", err.message);
  }
};

module.exports = { updateEmployeeImagePath, createEmployeeThumbnails, resizeEmployeeThumbnails, imageCheckerExist, generateImageThumbnail };