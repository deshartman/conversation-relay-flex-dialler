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
                    console.log(`[Conversation Relay] SETUP. Call from: ${message.from} to: ${message.to} with call SID: ${message.callSid}`);
                    
                    // Set call parameters for the existing llmService
                    this.llmService.setCallParameters(message.to, message.from, message.callSid);

                    // Call the get-customer service
                    const getCustomerResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/get-customer`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ from: message.from }),
                    });

                    const customerData = await getCustomerResponse.json();
                    const customerName = customerData.firstName;

                    const greetingText = `Greet the customer with name ${customerName} in a friendly manner. Do not constantly use their name, but drop it in occasionally. Tell them that you have to fist verify their details before you can proceed to ensure confidentiality of the conversation.`;
                    llmResponse = await this.llmService.generateResponse('system', greetingText);
                    console.info(`[Conversation Relay] SETUP <<<<<<: ${JSON.stringify(llmResponse, null, 4)}`);

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
