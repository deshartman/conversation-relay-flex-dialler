const twilio = require('twilio');
const { logOut, logError } = require('../utils/logger');

class TwilioService {
    constructor(accountSid, authToken, smsFromNumber) {
        this.accountSid = accountSid;
        this.authToken = authToken;
        this.smsFromNumber = smsFromNumber;
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
            logOut('TwilioService', `Calling: Customer Reference: ${to} with CustomerReference: ${customerReference} and callback URL: ${serverBaseUrl}`);

            const call = await this.twilioClient.calls.create({
                to: to,
                from: this.smsFromNumber,
                twiml: `<Response>
                            <Connect>
                                <ConversationRelay 
                                    url="wss://${serverBaseUrl}/conversation-relay" 
                                    voice="en-AU-Journey-D" 
                                    dtmfDetection="true" 
                                    interruptByDtmf="true" 
                                    debug="true">
                                    <Parameter name="customerReference" value="${customerReference}"/>
                                </ConversationRelay>
                            </Connect>
                        </Response>`,
                record: true,
            });

            logOut('TwilioService', `Made a call from: ${this.smsFromNumber} to: ${to}`);
            return call.sid;

        } catch (error) {
            logError('TwilioService', `Error: ${error}`);
            throw error;
        }
    }

    /**
     * Reference implementation for generating TwiML for an inbound call to connect it to the Conversation Relay service.
     * This can be used as a template for implementing inbound call handling.
     * 
     * @param {string} customerReference - Reference ID for the customer
     * @param {string} serverBaseUrl - Base URL for the Conversation Relay WebSocket server
     * @returns {string} The TwiML response
     */
    generateInboundCallTwiml(customerReference, serverBaseUrl) {
        try {
            logOut('TwilioService', `Generating TwiML for inbound call with CustomerReference: ${customerReference}`);

            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Connect>
                    <ConversationRelay 
                        url="wss://${serverBaseUrl}/conversation-relay"
                        voice="en-AU-Journey-D" 
                        dtmfDetection="true" 
                        interruptByDtmf="true" 
                        debug="true">
                        <Parameter name="customerReference" value="${customerReference}"/>
                    </ConversationRelay>
                </Connect>
            </Response>`;

            logOut('TwilioService', `Generated TwiML for inbound call: ${twiml}`);
            return twiml;

        } catch (error) {
            logError('TwilioService', `Error generating inbound call TwiML: ${error}`);
            throw error;
        }
    }

    /**
     * Processes a call status update and returns a formatted response.
     * 
     * @param {string} customerReference - Reference ID for the customer
     * @param {string} status - The current status of the call
     * @returns {Object} Formatted status update response
     */
    processStatusUpdate(customerReference, status) {
        try {
            logOut('TwilioService', `Processing status update - Customer Reference: ${customerReference}, Status: ${status}`);

            const response = {
                "Customer Reference": customerReference,
                "Status": status
            };

            logOut('TwilioService', `Status update response: ${JSON.stringify(response, null, 4)}`);
            return response;

        } catch (error) {
            logError('TwilioService', `Error processing status update: ${error}`);
            throw error;
        }
    }
}

module.exports = { TwilioService };
