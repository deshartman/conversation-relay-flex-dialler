const EventEmitter = require('events');
const { SilenceHandler } = require('./SilenceHandler');

const {
    TWILIO_FUNCTIONS_URL,
    SILENCE_SECONDS_THRESHOLD = 5,
    SILENCE_RETRY_THRESHOLD = 3
} = process.env;

class ConversationRelayService extends EventEmitter {
    constructor(gptService) {
        super();
        if (!gptService) {
            throw new Error('GPT service is required');
        }
        this.gptService = gptService;
        this.silenceHandler = null;
    }

    async handleMessage(message, silenceCallback) {
        let gptResponse = "";
        try {
            // Reset silence timer based on message type if handler exists
            if (this.silenceHandler) {
                this.silenceHandler.resetTimer(message.type);
            }

            switch (message.type) {
                case 'info':
                    break;
                case 'prompt':
                    console.info(`[Conversation Relay:] PROMPT >>>>>>: ${message.voicePrompt}`);
                    gptResponse = await this.gptService.generateResponse('user', message.voicePrompt);
                    console.info(`[Conversation Relay] JSON <<<<<<: ${JSON.stringify(gptResponse, null, 4)}`);
                    return gptResponse;
                case 'interrupt':
                    console.info(`[Conversation Relay] INTERRUPT ...... : ${message.utteranceUntilInterrupt}`);
                    break;
                case 'dtmf':
                    console.debug(`[Conversation Relay] DTMF: ${message.digit}`);
                    break;
                case 'setup':
                    console.log(`[Conversation Relay] SETUP. Call from: ${message.from} to: ${message.to} with call SID: ${message.callSid}`);
                    
                    // Set call parameters for the existing gptService
                    this.gptService.setCallParameters(message.to, message.from, message.callSid);

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
                    gptResponse = await this.gptService.generateResponse('system', greetingText);
                    console.info(`[Conversation Relay] SETUP <<<<<<: ${JSON.stringify(gptResponse, null, 4)}`);

                    // Initialize and start silence monitoring
                    this.silenceHandler = new SilenceHandler(SILENCE_SECONDS_THRESHOLD, SILENCE_RETRY_THRESHOLD);
                    this.silenceHandler.startMonitoring(silenceCallback);

                    return gptResponse;
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
