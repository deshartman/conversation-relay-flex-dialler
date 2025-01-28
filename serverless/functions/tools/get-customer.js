exports.handler = async function (context, event, callback) {
  // Twilio Functions way of requiring a local utility file. See: https://www.twilio.com/docs/serverless/functions-assets/client#include-code-from-a-function
  const loggerUtil = Runtime.getFunctions()['utils/logger'].path;
  const { logOut, logError } = require(loggerUtil);

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
