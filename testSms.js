const { sendSms } = require('./helpers/smsSender');

//const phoneNumber = '09451479010';
const phoneNumber = '09652162726';
const message = 'Good Day! Hello PAUL ANDRE BALAYO, you have an attendance record on Thursday, April 23, 2026 8:18 AM. This is an automated message. Please disregard. GC&C Cares';

sendSms(phoneNumber, message)
    .then(result => console.log(result))
    .catch(err => console.error(err));
