exports.handler = async function (context, event, callback) {
  // Twilio Functions way of requiring a local utility file. See: https://www.twilio.com/docs/serverless/functions-assets/client#include-code-from-a-function
  const loggerUtil = Runtime.getFunctions()['utils/logger'].path;
  const { logOut, logError } = require(loggerUtil);

  logOut('VerifyCode: Event', `${JSON.stringify(event, null, 4)}`);

  try {
    // Check if a verification code has been included. If so, check the code, else generate one
    if (event.code) {
      logOut('VerifyCode: Code', `Verification code included in event object: ${event.code}`);
      // Add checks for the code here based on the calling number (event.From and the code)
      let result = true; // Temp hack
      return (callback(null, result));
    } else {
      const message = "No verification code included in event object.";
      logOut('VerifyCode: Message', message);
      return callback(null, message);
    }
  } catch (error) {
    logError('VerifyCode: Error', `${error}`);
    return callback(`Error: ${error}`);
  }
}
