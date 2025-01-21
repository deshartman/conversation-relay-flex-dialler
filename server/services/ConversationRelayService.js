const EventEmitter = require('events');
const { SilenceHandler } = require('./SilenceHandler');
const { logOut, logError } = require('../utils/logger');

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
        this.silenceHandler = new SilenceHandler();
        this.logMessage = null;     // Utility log message

        // Set up response handler
        this.responseService.on('llm.response', (response) => {
            logOut(`Conversation Relay`, `${this.logMessage} Response received: ${JSON.stringify(response.token, null, 4)}`);
            this.emit('conversationRelay.response', response);
        });
    }

    // This is only called initially when establishing a new Conversation Relay session.
    // Emits 'conversationRelay.response' events when responses are received from the LLM service.
    async setup(sessionCustomerData) {
        // Pull out sessionCustomerData parts into own variables
        const { customerData, setupData } = sessionCustomerData;
        logOut(`Conversation Relay`, `[Conversation Relay with Call SID: ${setupData.callSid}] with customerData: ${JSON.stringify(customerData, null, 4)}`);

        this.logMessage = `[Conversation Relay with Call SID: ${setupData.callSid}] `

        /** 
         * This first system message pushes all the data into the Response Service in preparation for the conversation under generateResponse.
         * 
         * This is business logic.
         */
        const initialMessage = `These are all the details of the call: ${JSON.stringify(setupData, null, 4)} and the data needed to complete your objective: ${JSON.stringify(customerData, null, 4)}. Use this to complete your objective`;

        this.responseService.generateResponse('system', initialMessage);

        // Initialize and start silence monitoring. When triggered it will emit a 'silence' event with a message
        this.silenceHandler.startMonitoring((silenceMessage) => {
            // Add callSid to silence message if it's a text message
            if (silenceMessage.type === 'text') {
                logOut(`Conversation Relay`, `${this.logMessage} Sending silence breaker message: ${JSON.stringify(silenceMessage)}`);
            } else if (silenceMessage.type === 'end') {
                logOut(`Conversation Relay`, `${this.logMessage} Ending call due to silence: ${JSON.stringify(silenceMessage)}`);
            }
            this.emit('silence', silenceMessage);
        });
    }

    // This is sent for every message received from Conversation Relay after setup.
    async incomingMessage(message) {
        try {
            // Only reset silence timer for non-info messages
            if (this.silenceHandler && message.type !== 'info') {
                this.silenceHandler.resetTimer();
            } else if (message.type === 'info') {
                // console.log(`${this.logMessage} Info message received - Ignoring for timer reset`);
            }

            switch (message.type) {
                case 'info':
                    break;
                case 'prompt':
                    logOut(`Conversation Relay`, `${this.logMessage} PROMPT >>>>>>: ${message.voicePrompt}`);
                    this.responseService.generateResponse('user', message.voicePrompt);
                    break;
                case 'interrupt':
                    logOut(`Conversation Relay`, `${this.logMessage} INTERRUPT ...... : ${message.utteranceUntilInterrupt}`);
                    break;
                case 'dtmf':
                    logOut(`Conversation Relay`, `${this.logMessage} DTMF: ${message.digit}`);
                    break;
                case 'setup':
                    logError(`Conversation Relay`, `${this.logMessage} Setup message received in incomingMessage - should be handled by setup() method`);
                    break;
                default:
                    logOut(`Conversation Relay`, `${this.logMessage} Unknown message type: ${message.type}`);
            }
        } catch (error) {
            logError(`Conversation Relay`, `${this.logMessage} Error in message handling: ${error}`);
            throw error;
        }
    }

    // This is called for every message that has to be sent to Conversation Relay, bypassing the Response Service logic and only inserting the message into the Response Service history for context.
    async outgoingMessage(message) {
        try {
            logOut(`Conversation Relay`, `${this.logMessage} Outgoing message from Agent: ${message}`);
            this.responseService.insertMessageIntoHistory(message);
        } catch (error) {
            logError(`Conversation Relay`, `${this.logMessage} Error in outgoing message handling: ${error}`);
            throw error;
        }
    }

    cleanup() {
        if (this.silenceHandler) {
            this.silenceHandler.cleanup();
            this.silenceHandler = null;
        }
        // Remove the event listener
        this.responseService.removeAllListeners('llm.response');
    }
}

module.exports = { ConversationRelayService };
