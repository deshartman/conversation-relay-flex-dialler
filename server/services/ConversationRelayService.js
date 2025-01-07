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
                    /**
                       {
                            "type": "setup",
                            "sessionId": "VX8f1ae211b0404ab3905b4aa470bb9a36",
                            "callSid": "CA3327b12c071c64297e9ea5108e0a9b29",
                            "parentCallSid": null,
                            "from": "+14085551212",
                            "to": "+18881234567",
                            "forwardedFrom": null,
                            "callerName": null,
                            "direction": "inbound",
                            "callType": "PSTN",
                            "callStatus": "IN-PROGRESS",
                            "accountSid": "ACe6ee4b20287adb6e5c9ec4169b56d2bb",
                            "applicationSid": "AP3c07638b2397e5e3f1e459fb1cc10000",
                            "customParameters" : {
                                "customerReference": "1234414123"
                            }  
                        }
                    */
                    console.log(`[Conversation Relay] SETUP: Call SID: ${message.callSid} and customer ID: ${message.customParameters.customerReference}`);


                    // Call the get-customer service passing in the setup message data and getting back the customer data
                    const getCustomerResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/get-customer`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: message,
                    });
                    const customerData = await getCustomerResponse.json();

                    llmResponse = await this.llmService.generateResponse('system', customerData.greetingText);

                    // Set call parameters for the existing llmService
                    this.llmService.setCallParameters(customerData);


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
