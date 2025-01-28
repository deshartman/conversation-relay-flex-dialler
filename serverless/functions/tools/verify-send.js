exports.handler = async function (context, event, callback) {
  // Twilio Functions way of requiring a local utility file. See: https://www.twilio.com/docs/serverless/functions-assets/client#include-code-from-a-function
  const loggerUtil = Runtime.getFunctions()['utils/logger'].path;
  const { logOut, logError } = require(loggerUtil);


  const twilioClient = context.getTwilioClient();

  try {
    logOut('VerifySend: Event', `Sending verification code to: ${event.from}`);
    // Generate a random 4 digit code for the calling number (event.From)
    let code = Math.floor(1000 + Math.random() * 9000);
    logOut('VerifySend: Code', `Sending code: ${code} to: ${event.from} from: ${context.SMS_FROM_NUMBER}`);

    await twilioClient.messages.create({
      to: event.from,
      from: context.SMS_FROM_NUMBER,
      body: `Your verification code is: ${code}`
    });

    logOut('VerifySend: Success', `Verification code sent successfully: ${code}`);
    logOut('VerifySend: Success', `Verification code sent successfully to: ${event.from}`);

    return callback(null, `${code}`);
  } catch (error) {
    logError('VerifySend: Error', `${error}`);
    return callback(`Error: ${error}`);
  }
}
