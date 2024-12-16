exports.handler = async function (context, event, callback) {

  const twilioClient = context.getTwilioClient();
  // console.log("[VerifySend] Event object from:", event.from);

  try {
    console.log(`[VerifySend] Sending verification code to: ${event.from}`);
    // Generate a random 4 digit code for the calling number (event.From)
    let code = Math.floor(1000 + Math.random() * 9000);
    // Send the code using the send-sms function
    console.log(`[VerifySend] Sending code: ${code} to: ${event.from} from: ${context.SMS_FROM_NUMBER}`);

    await twilioClient.messages.create({
      to: event.from,
      from: context.SMS_FROM_NUMBER,
      body: `Your verification code is: ${code}`
    });

    console.log(`[VerifySend] Verification code sent successfully: ${code}`);
    console.log(`[VerifySend] Verification code sent successfully to: ${event.from}`);

    return callback(null, `${code}`);
  } catch (error) {
    return callback(`[VerifySend] Error: ${error}`);
  }
}