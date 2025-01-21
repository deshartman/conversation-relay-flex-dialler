const { logOut, logError } = require('../utils/logger');

/**
 * Makes an outbound call based on the "to" number passed in the event and connects it to the Conversation Relay service. 
 * It is also assumed that additional Conversation Relay specific data will be passed in the event under "data". This is passed on to the url, which connects Conversation Relay
 * 
 * @param {String} to - To phone number via event
 * @param {String} customerReference - The customer reference  via event to be passed to the Conversation Relay service
 * 
 */
exports.handler = async function (context, event, callback) {
    const twilioClient = context.getTwilioClient();

    try {
        logOut(`CallOut: Calling:`, `Customer Reference: ${event.to} with CustomerReference: ${event.customerReference}`);

        // TODO: See if we can get the actual URL from the context. Returns localhost https, which cannot establish a connection and relative URL does not work
        // const CRelayURL = `https://${context.DOMAIN_NAME}/tools/connect-crelay?customerReference=${event.customerReference}`
        // const callUrl = `https://functions-des.ngrok.dev`

        // Passing the Functions URL from the server, since it already has it.
        const CRelayURL = `${event.functionsServerUrl}/tools/connect-crelay?customerReference=${event.customerReference}`
        // logOut('CallOut', `CRelayURL: ${CRelayURL}`);

        const call = await twilioClient.calls.create({
            to: event.to,
            from: context.SMS_FROM_NUMBER,
            url: CRelayURL,
        });

        logOut('CallOut', `Made a call from: ${context.SMS_FROM_NUMBER} to: ${event.to}`);

        return callback(null, `${call.sid}`);
    } catch (error) {
        logError('CallOut', `Error: ${error}`);
        return callback(`Error: ${error}`);
    }
}
