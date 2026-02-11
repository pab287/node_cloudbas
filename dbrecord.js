const pool = require('./config/db');

const getActiveDevices = async () => {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                // Always wrap in an Error object
                const errorMessage = (() => {
                    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                        return 'Database connection was closed.';
                    }
                    if (err.code === 'ER_CON_COUNT_ERROR') {
                        return 'Database has too many connections.';
                    }
                    if (err.code === 'ECONNREFUSED') {
                        return 'Database connection was refused.';
                    }
                    return 'Unknown database connection error.';
                })();

                console.error(errorMessage);
                return reject(new Error(errorMessage));
            }

            const sql = `SELECT *, ip_address AS ip FROM devices WHERE is_active = 1`;

            connection.query(sql, (err, results) => {
                connection.release();

                if (err) {
                    console.error('Query Error:', err);
                    return reject(new Error('Query execution failed.'));
                }

                resolve(results);
            });
        });
    });
};

const getCurrentUsers = async () => {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                // Always wrap in an Error object
                const errorMessage = (() => {
                    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                        return 'Database connection was closed.';
                    }
                    if (err.code === 'ER_CON_COUNT_ERROR') {
                        return 'Database has too many connections.';
                    }
                    if (err.code === 'ECONNREFUSED') {
                        return 'Database connection was refused.';
                    }
                    return 'Unknown database connection error.';
                })();

                console.error(errorMessage);
                return reject(new Error(errorMessage));
            }

            const sql = `SELECT biometricno, TRIM(UPPER(CONCAT(firstname, 
            CASE WHEN middlename != 'N/A' AND middlename != 'NONE'
            AND middlename !='' AND middlename IS NOT NULL 
            THEN CONCAT(' ', SUBSTR(middlename, 1, 1), '.') ELSE '' END, ' ', lastname, 
            CASE WHEN suffix != 'N/A' AND suffix !='NONE' AND suffix !='' AND suffix IS NOT NULL THEN CONCAT(' ', suffix) ELSE '' END))) as employee_name, thumb_path, mobileno
            FROM employees order by id ASC`;

            connection.query(sql, (err, results) => {
                connection.release();

                if (err) {
                    console.error('Query Error:', err);
                    return reject(new Error('Query execution failed.'));
                }

                resolve(results);
            });
        });
    });
};

const insertAttendanceLogs = async (logs) => {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          const errorMessage = (() => {
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
              return 'Database connection was closed.';
            }
            if (err.code === 'ER_CON_COUNT_ERROR') {
              return 'Database has too many connections.';
            }
            if (err.code === 'ECONNREFUSED') {
              return 'Database connection was refused.';
            }
            return 'Unknown database connection error.';
          })();
  
          console.error(errorMessage);
          return resolve({ success: false, message: errorMessage });
        }
  
        // ✅ Check if logs array is valid
        if (!Array.isArray(logs) || logs.length === 0) {
          connection.release();
          return resolve({ success: false, message: 'No logs to insert.' });
        }
  
        const now = new Date();
        const values = logs.map(l => [
          l.log,
          l.device_id,
          l.datetime,
          l.biometricno,
          l.device_state,
          l.verify_method,
          l.telegram_sent || 3,
          l.sms_sent || 2,
          now,
          now
        ]);
  
        const sql = `
          INSERT IGNORE INTO attendance_logs 
          (log, device_id, datetime, biometricno, device_state, verify_method, telegram_sent, sms_sent, created_at, updated_at)
          VALUES ?
        `;
  
        connection.query(sql, [values], (error, results) => {
          connection.release();
  
          if (error) {
            console.error('Error inserting attendance logs:', error);
            return resolve({ success: false, message: 'Error inserting attendance logs.' });
          }
  
          return resolve({
            success: true,
            message: `${results.affectedRows} attendance logs inserted successfully.`,
          });
        });
      });
    });
  };
  
  const getCurrentAttendanceLogs = async (date) => {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          const errorMessage = (() => {
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
              return 'Database connection was closed.';
            }
            if (err.code === 'ER_CON_COUNT_ERROR') {
              return 'Database has too many connections.';
            }
            if (err.code === 'ECONNREFUSED') {
              return 'Database connection was refused.';
            }
            return 'Unknown database connection error.';
          })();
  
          console.error(errorMessage);
          return reject(new Error(errorMessage));
        }
  
        // ✅ Check if date is valid
        if (!date || Number.isNaN(Date.parse(date))) {
          connection.release();
          return reject(new Error('Invalid date format.'));
        }
  
        const sql = `SELECT att.datetime as recordTime, att.biometricno as deviceUserId, att.device_state as isState, att.verify_method as verifyMethod,
        dev.ip_address as ip, dev.device_name as deviceName
        FROM attendance_logs as att
        LEFT JOIN devices as dev ON dev.id = att.device_id
        WHERE DATE(att.datetime) = '${date}' ORDER BY att.datetime DESC`;
  
        connection.query(sql, (err, results) => {
          connection.release();
  
          if (err) {
            console.error('Query Error:', err);
            return reject(new Error('Query execution failed.'));
          }
  
          resolve(results);
        });
      });
    });
  };

module.exports = { getActiveDevices, getCurrentUsers, insertAttendanceLogs, getCurrentAttendanceLogs };