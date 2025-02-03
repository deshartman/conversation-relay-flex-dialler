const twilio = require('twilio');
const { logOut, logError } = require('../utils/logger');

class TwilioService {
    constructor(accountSid, authToken, fromNumber) {
        this.accountSid = accountSid;
        this.authToken = authToken;
        this.fromNumber = fromNumber;
        this.twilioClient = twilio(accountSid, authToken);
    }

    /**
     * Makes an outbound call and connects it to the Conversation Relay service.
     * 
     * @param {string} to - The phone number to call
     * @param {string} customerReference - Reference ID for the customer
     * @param {string} serverBaseUrl - Base URL for the Conversation Relay WebSocket server
     * @returns {Promise<string>} The call SID
     */
    async makeOutboundCall(to, customerReference, serverBaseUrl) {
        try {
            // logOut('TwilioService', `Calling: ${to} with CustomerReference: ${customerReference} and callback URL: ${serverBaseUrl}`);
            // logOut('TwilioService', `URL: https://${serverBaseUrl}/connectConversationRelay`);

            const twiml = this.connectConversationRelay(customerReference, serverBaseUrl);

            const call = await this.twilioClient.calls.create({
                to: to,
                from: this.fromNumber,
                twiml: twiml,
                record: true,
            });

            logOut('TwilioService', `Made a call from: ${this.fromNumber} to: ${to}`);
            return call.sid;

        } catch (error) {
            logError('TwilioService', `Make Outbound call error: ${error}`);
            throw error;
        }
    }

    /**
     * Generate Conversation Relay TwiML for a call to connect it to the Conversation Relay service. This can be used for inbound or outbound calls
     * 
     * @param {string} customerReference - Reference ID for the customer
     * @param {string} serverBaseUrl - Base URL for the Conversation Relay WebSocket server
     * @returns {string} The TwiML response
     */
    connectConversationRelay(customerReference, serverBaseUrl) {
        try {
            logOut('TwilioService', `Generating TwiML for call with CustomerReference: ${customerReference}`);

            // Generate the Twiml we will need once the call is connected. Note, this could be done in two steps via the server, were we set a url: instead of twiml:, but this just seemed overly complicated.
            const response = new twilio.twiml.VoiceResponse();
            const connect = response.connect();
            const conversationRelay = connect.conversationRelay({
                url: `wss://${serverBaseUrl}/conversation-relay`,
                transcriptionProvider: "deepgram",
                voice: "en-AU-Journey-D",
                // ttsProvider: "Elevenlabs",
                // voice: "Jessica-flash_v2_5",
                dtmfDetection: "true",
                interruptByDtmf: "true",
                debug: "true"
            });

            conversationRelay.parameter({
                name: 'customerReference',
                value: customerReference
            });

            logOut('TwilioService', `Generated TwiML using Helper for call: ${response.toString()}`);
            return response;

        } catch (error) {
            logError('TwilioService', `Error generating call TwiML: ${error}`);
            return null;
        }
    }
}

module.exports = { TwilioService };
