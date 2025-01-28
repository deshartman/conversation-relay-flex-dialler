exports.handler = async function (context, event, callback) {
  // Twilio Functions way of requiring a local utility file. See: https://www.twilio.com/docs/serverless/functions-assets/client#include-code-from-a-function
  const loggerUtil = Runtime.getFunctions()['utils/logger'].path;
  const { logOut, logError } = require(loggerUtil);

  try {
    logOut('StatusUpdate: Event', `${JSON.stringify(event, null, 4)}`);
    const response = {
      "Customer Reference": event.customerReference,
      "Status": event.status
    };
    logOut('StatusUpdate: Response', `${JSON.stringify(response, null, 4)}`);
    return callback(null, response);
  } catch (error) {
    logError('StatusUpdate: Error', `${error}`);
    return callback(`Error: ${error}`);
  }
}
