// Simply timelog calls to this function
exports.handler = async function (context, event, callback) {
    // Twilio Functions way of requiring a local utility file. See: https://www.twilio.com/docs/serverless/functions-assets/client#include-code-from-a-function
    const loggerUtil = Runtime.getFunctions()['utils/logger'].path;
    const { logOut, logError } = require(loggerUtil);


    logOut(`Timestamp Log`, `Event received ${JSON.stringify(event.CallStatus, null, 4)} `);
}
