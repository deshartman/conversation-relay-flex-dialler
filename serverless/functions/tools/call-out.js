/**
 * Makes an outbound call based on the "to" number passed in the event and connects it to the Conversation Relay service. 
 * It is also assumed that additional Conversation Relay specific data will be passed in the event under "data". This is passed on to the url, which connects Conversation Relay
 */
exports.handler = async function (context, event, callback) {

    const twilioClient = context.getTwilioClient();

    try {
        console.log(`[CallOut] Calling: ${event.to}`);
        const call = await twilioClient.calls.create({
            to: event.to,
            from: context.TWILIO_PHONE_NUMBER,
            url: "/connect-crelay", // TODO: Issue is I need to pass a LOT of data here as a get
            statusCallback: "https://www.myapp.com/events",
            statusCallbackEvent: ["answered"],
            statusCallbackMethod: "POST",

        });

        console.log(`[CallOut] Made a call from: ${context.TWILIO_PHONE_NUMBER} to: ${event.to}`);

        // Now pass the data to 

        return callback(null, `${call.sid}`);
    } catch (error) {
        return callback(`[CallOut] Error: ${error}`);
    }
}

