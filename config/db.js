const mysql = require('mysql');
let pool = mysql.createPool({
  connectionLimit    : 100,
  host               : 'localhost',
  user               : 'root',
  password           : 'rootpass',
  database           : 'biometric_server',
  multipleStatements : true,
  port               : 3306,
  debug              : false,
  timezone           : '+0800', 
  /*** connectTimeout     : 1800000, ***/
});

pool.getConnection((err, connection) => {
  if (err) {
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
          console.error('Database connection was closed.')
      }
      if (err.code === 'ER_CON_COUNT_ERROR') {
          console.error('Database has too many connections.')
      }
      if (err.code === 'ECONNREFUSED') {
          console.error('Database connection was refused.')
      }
  }
  if (connection) connection.release()
  return
})

module.exports = pool;