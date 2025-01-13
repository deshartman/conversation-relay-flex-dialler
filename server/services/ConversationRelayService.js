const EventEmitter = require('events');
const { SilenceHandler } = require('./SilenceHandler');

const {
    TWILIO_FUNCTIONS_URL
} = process.env;

class ConversationRelayService extends EventEmitter {
    constructor(responseService) {
        super();
        if (!responseService) {
            throw new Error('LLM service is required');
        }
        this.responseService = responseService;
        this.silenceHandler = null;
        this.logMessage = null;     // Utility log message
    }

    // This is only called initially when establishing a new Conversation Relay session.
    async setup(sessionCustomerData) {
        let responseMessage = {};
        // Pull out sessionCustomerData parts into own variables
        const { customerData, setupData } = sessionCustomerData;
        // console.log(`[Conversation Relay with Call SID: ${setupData.callSid}] with sessionCustomerData: ${JSON.stringify(sessionCustomerData, null, 4)}`);
        this.logMessage = `[Conversation Relay with Call SID: ${setupData.callSid}] `

        /** 
         * This first system message pushes all the data into the Response Service in preparation for the conversation under generateResponse.
         * 
         * This is business logic.
         */
        const initialMessage = `These are all the details of the call: ${JSON.stringify(setupData, null, 4)} and the data needed to complete your objective: ${JSON.stringify(customerData, null, 4)}. Use this to complete your objective`;
        console.log(`${this.logMessage} Setup message: ${initialMessage}`);

        responseMessage = await this.responseService.generateResponse('system', initialMessage);

        console.log(`[Conversation Relay with Call SID: ${setupData.callSid}] <<<< Setup message response: ${JSON.stringify(responseMessage, null, 4)}`);

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

        return responseMessage;
    }

    // This is sent for every message received from Conversation Relay after setup.
    async handleMessage(message) {
        let responseMessage = "";
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
                    console.log(`${this.logMessage} INFO: `);
                    break;
                case 'prompt':
                    console.info(`${this.logMessage} PROMPT >>>>>>: ${message.voicePrompt}`);
                    responseMessage = await this.responseService.generateResponse('user', message.voicePrompt);
                    console.info(`${this.logMessage} JSON <<<<<<: ${JSON.stringify(responseMessage, null, 4)}`);
                    return responseMessage;
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
