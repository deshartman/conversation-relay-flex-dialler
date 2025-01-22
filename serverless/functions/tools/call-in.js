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

    const voiceRessponse = new Twilio.twiml.VoiceResponse();

    try {
        logOut(`Call In`, `Call received. Customer Reference: ${event.to} with CustomerReference: ${event.customerReference}`);

        try {
            const callbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Connect>
                    <ConversationRelay 
                        url="wss://server-des.ngrok.dev/conversation-relay"
                        voice="en-AU-Journey-D" 
                        dtmfDetection="true" 
                        interruptByDtmf="true" 
                        debug="true">
                        <Parameter name="customerReference" value="def345"/>
                    </ConversationRelay>
                </Connect>
            </Response>`;

            logOut('Call In', `TwiML: ${callbackTwiml}`);

            // Return the twiml to Twilio
            return callback(null, `${callbackTwiml}`);
        } catch (error) {
            logError('Call In', ` Error: ${error}`);
            return callback(error);
        }


    }
