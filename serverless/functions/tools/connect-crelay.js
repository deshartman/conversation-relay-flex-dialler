const { logOut, logError } = require('../utils/logger');

/**
 * Connects call to Conversation Relay and passes call specific body parameters along.
 * Requires the server URL (domain and path) to be sent
 */
exports.handler = async function (context, event, callback) {
    logOut('Connect-CRelay', `Event Called${JSON.stringify(event.Called, null, 4)}`);

    const serverUrl = context.SERVER_BASE_URL

    // <Connect action="https://${context.SERVERLESS_BASE_URL}/complete-crelay}">

    try {
        const callbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Connect>
                    <ConversationRelay 
                        url="wss://${serverUrl}/conversation-relay" 
                        voice="en-AU-Journey-D" 
                        dtmfDetection="true" 
                        interruptByDtmf="true" 
                        debug="true">
                        <Parameter name="customerReference" value="${event.customerReference}"/>
                    </ConversationRelay>
                </Connect>
            </Response>`;

        logOut('Connect-CRelay:', `TwiML: ${callbackTwiml}`);

        // Return the twiml to Twilio
        return callback(null, `${callbackTwiml}`);
    } catch (error) {
        logError('Connect-CRelay: Error', `${error}`);
        return callback(error);
    }
}
