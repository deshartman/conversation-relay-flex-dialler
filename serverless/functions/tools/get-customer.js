const { logOut, logError } = require('../utils/logger');

exports.handler = async function (context, event, callback) {
  logOut('GetCustomer: Event', `${JSON.stringify(event, null, 4)}`);

  try {
    // Pull customer data from environment variables
    const customerData = {
      to: event.to,
      from: event.from,
      callSid: event.callSid,
      customerReference: event.customParameters?.customerReference || null,
      firstname: context.CUSTOMER_NAME,
      lastname: context.CUSTOMER_LASTNAME,
    }
    logOut('GetCustomer: Response', `${JSON.stringify(customerData, null, 4)}`);
    return callback(null, customerData);
  } catch (error) {
    logError('GetCustomer: Error', `${error}`);
    return callback(`Error: ${error}`);
  }
}
