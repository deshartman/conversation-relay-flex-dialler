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
    }

    async handleMessage(message) {
        let llmResponse = "";
        try {
            // Only reset silence timer for non-info messages
            if (this.silenceHandler && message.type !== 'info') {
                this.silenceHandler.resetTimer();
            } else if (message.type === 'info') {
                console.log("[Conversation Relay] Info message received - Ignoring for timer reset");
            }

            // Log the message type
            console.log(`[Conversation Relay] Received message of type: ${message.type}`);

            switch (message.type) {
                case 'info':
                    break;
                case 'prompt':
                    console.info(`[Conversation Relay:] PROMPT >>>>>>: ${message.voicePrompt}`);
                    llmResponse = await this.llmService.generateResponse('user', message.voicePrompt);
                    console.info(`[Conversation Relay] JSON <<<<<<: ${JSON.stringify(llmResponse, null, 4)}`);
                    return llmResponse;
                case 'interrupt':
                    console.info(`[Conversation Relay] INTERRUPT ...... : ${message.utteranceUntilInterrupt}`);
                    break;
                case 'dtmf':
                    console.debug(`[Conversation Relay] DTMF: ${message.digit}`);
                    break;
                case 'setup':
                    console.log(`[Conversation Relay] SETUP: Call SID: ${message.callSid} and customer ID: ${message.customParameters.customerReference}`);


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

                    // Set call parameters for the existing llmService first
                    this.llmService.setCallParameters(message);

                    // Only generate LLM response if we have greeting text
                    if (customerData.greetingText) {
                        llmResponse = await this.llmService.generateResponse('system', customerData.greetingText);
                        console.info(`[Conversation Relay] SETUP <<<<<<: ${JSON.stringify(llmResponse, null, 4)}`);
                    } else {
                        console.log('[Conversation Relay] No greeting text provided in customer data');
                        llmResponse = {
                            type: "text",
                            token: "Hello, how can I help you today?",
                            last: true
                        };
                    }

                    // Initialize and start silence monitoring. When triggered it will emit a 'silence' event with a message
                    this.silenceHandler = new SilenceHandler();
                    this.silenceHandler.startMonitoring((silenceMessage) => {
                        this.emit('silence', silenceMessage);
                    });

                    return llmResponse;
                default:
                    console.log(`[Conversation Relay] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[Conversation Relay] Error in message handling:', error);
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
