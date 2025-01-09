/**
 * Makes an outbound call based on the "to" number passed in the event and connects it to the Conversation Relay service. 
 * It is also assumed that additional Conversation Relay specific data will be passed in the event under "data". This is passed on to the url, which connects Conversation Relay
 */
exports.handler = async function (context, event, callback) {

    const twilioClient = context.getTwilioClient();

    try {
        console.log(`[CallOut] Calling: ${event.to} with CustomerReference: ${event.customerReference}`);
        const call = await twilioClient.calls.create({
            to: event.to,
            from: context.TWILIO_PHONE_NUMBER,
            url: `/connect-crelay?customerReference=${event.customerReference}`, // TODO: Pass the CustomerReference as a parameter
        });

        console.log(`[CallOut] Made a call from: ${context.TWILIO_PHONE_NUMBER} to: ${event.to}`);

        return callback(null, `${call.sid}`);
    } catch (error) {
        return callback(`[CallOut] Error: ${error}`);
    }
}

