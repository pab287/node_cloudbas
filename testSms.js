const { sendSms } = require('./helpers/smsSender');

const phoneNumber = '09451479010';
const message = 'test 123';

sendSms(phoneNumber, message)
    .then(result => console.log(result))
    .catch(err => console.error(err));
