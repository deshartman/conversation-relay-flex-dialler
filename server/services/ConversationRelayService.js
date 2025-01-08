const EventEmitter = require('events');
const { SilenceHandler } = require('./SilenceHandler');

const {
    TWILIO_FUNCTIONS_URL
} = process.env;

class ConversationRelayService extends EventEmitter {
    constructor(llmService) {
        super();
        if (!llmService) {
            throw new Error('LLM service is required');
        }
        this.llmService = llmService;
        this.silenceHandler = null;
        this.callSid = null;
    }

    // This is only called initially when establishing a new Conversation Relay session.
    async setup(message) {
        this.callSid = message.callSid;
        this.logMessage = `[Conversation Relay with Call SID: ${this.callSid}] `
        console.log(`${this.logMessage} SETUP: Call SID: ${message.callSid} and customer ID: ${message.customParameters.customerReference}`);

        // Call the get-customer service passing in the setup message data and getting back the customer data
        const getCustomerResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/get-customer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        if (!getCustomerResponse.ok) {
            throw new Error(`Get customer service returned ${getCustomerResponse.status}: ${await getCustomerResponse.text()}`);
        }

        const customerData = await getCustomerResponse.json();
        // Log the customer data
        console.log(`${this.logMessage} Customer data: ${JSON.stringify(customerData, null, 4)}`);

        // Pass the Customer data to the LLM service
        this.llmService.setCallParameters(customerData);

        let llmResponse;
        // Only generate LLM response if we have greeting text
        if (customerData.greetingText) {
            llmResponse = await this.llmService.generateResponse('system', customerData.greetingText);
            console.info(`${this.logMessage} SETUP <<<<<<: ${JSON.stringify(llmResponse, null, 4)}`);
        } else {
            console.log(`${this.logMessage} No greeting text provided in customer data`);
            llmResponse = {
                type: "text",
                token: "Hello, how can I help you today?",
                last: true
            };
        }

        // Initialize and start silence monitoring. When triggered it will emit a 'silence' event with a message
        this.silenceHandler = new SilenceHandler();
        this.silenceHandler.startMonitoring((silenceMessage) => {
            // Add callSid to silence message if it's a text message
            if (silenceMessage.type === 'text') {
                console.log(`${this.logMessage} Sending silence breaker message: ${JSON.stringify(silenceMessage)}`);
            } else if (silenceMessage.type === 'end') {
                console.log(`${this.logMessage} Ending call due to silence: ${JSON.stringify(silenceMessage)}`);
            }
            this.emit('silence', silenceMessage);
        });

        return llmResponse;
    }

    // This is sent for every message received from Conversation Relay after setup.
    async handleMessage(message) {
        let llmResponse = "";
        try {
            // Only reset silence timer for non-info messages
            if (this.silenceHandler && message.type !== 'info') {
                this.silenceHandler.resetTimer();
            } else if (message.type === 'info') {
                console.log(`${this.logMessage} Info message received - Ignoring for timer reset`);
            }

            // Log the message type
            console.log(`${this.logMessage} Received message of type: ${message.type}`);

            switch (message.type) {

                case 'info':
                    break;
                case 'prompt':
                    console.info(`${this.logMessage} PROMPT >>>>>>: ${message.voicePrompt}`);
                    llmResponse = await this.llmService.generateResponse('user', message.voicePrompt);
                    console.info(`${this.logMessage} JSON <<<<<<: ${JSON.stringify(llmResponse, null, 4)}`);
                    return llmResponse;
                case 'interrupt':
                    console.info(`${this.logMessage} INTERRUPT ...... : ${message.utteranceUntilInterrupt}`);
                    break;
                case 'dtmf':
                    console.debug(`${this.logMessage} DTMF: ${message.digit}`);
                    break;
                case 'setup':
                    console.error(`${this.logMessage} Setup message received in handleMessage - should be handled by setup() method`);
                    break;
                default:
                    console.log(`${this.logMessage} Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error(`${this.logMessage} Error in message handling:`, error);
            throw error;
        }
    }

    cleanup() {
        if (this.silenceHandler) {
            this.silenceHandler.cleanup();
            this.silenceHandler = null;
        }
    }
}

module.exports = { ConversationRelayService };
