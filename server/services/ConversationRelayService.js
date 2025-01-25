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

        // Set up response handler for LLM responses
        this.responseService.on('llm.response', (response) => {
            // logOut(`Conversation Relay`, `${this.logMessage} conversationRelay.response Event: Response received: ${JSON.stringify(response, null, 4)}`);   // TODO: this.logMessage is not defined!
            this.emit('conversationRelay.response', response);
        });

        // Set up "end" handler for LLM responses
        this.responseService.on('llm.end', (response) => {
            logOut(`Conversation Relay`, `${this.logMessage} LLM session ended. Response received: ${JSON.stringify(response, null, 4)}`);
            this.emit('conversationRelay.end', response);
        });

        // Set up "send-dtmf" handler for LLM responses
        this.responseService.on('llm.dtmf', (response) => {
            logOut(`Conversation Relay`, `${this.logMessage} LLM DTMF event. Response received: ${JSON.stringify(response, null, 4)}`);
            this.emit('conversationRelay.dtmf', response);
        });

        // Set up "live-agent-handoff" handler for LLM responses
        this.responseService.on('llm.handoff', (response) => {
            logOut(`Conversation Relay`, `${this.logMessage} LLM handoff event. Response received: ${JSON.stringify(response, null, 4)}`);
            this.emit('conversationRelay.handoff', response);
        });

    }

    // This is only called initially when establishing a new Conversation Relay session.
    // Emits 'conversationRelay.response' events when responses are received from the LLM service.
    async setup(sessionCustomerData) {
        // Pull out sessionCustomerData parts into own variables
        const { customerData, setupData } = sessionCustomerData;
        this.logMessage = `[Conversation Relay with Call SID: ${setupData.callSid}] `

        // logOut(`Conversation Relay`, `${this.logMessage} with customerData: ${JSON.stringify(customerData, null, 4)}`);

        // This first system message pushes all the data into the Response Service in preparation for the conversation under generateResponse.
        const initialMessage = `These are all the details of the call: ${JSON.stringify(setupData, null, 4)} and the data needed to complete your objective: ${JSON.stringify(customerData, null, 4)}. Use this to complete your objective`;

        this.responseService.insertMessageIntoContext('system', initialMessage);

        // Initialize and start silence monitoring. When triggered it will emit a 'silence' event with a message
        this.silenceHandler.startMonitoring((silenceMessage) => {
            // Add callSid to silence message if it's a text message
            if (silenceMessage.type === 'text') {
                logOut(`Conversation Relay`, `${this.logMessage} Sending silence breaker message: ${JSON.stringify(silenceMessage)}`);
            } else if (silenceMessage.type === 'end') {
                logOut(`Conversation Relay`, `${this.logMessage} Ending call due to silence: ${JSON.stringify(silenceMessage)}`);
            }
            this.emit('conversationRelay.silence', silenceMessage);
        });

        logOut(`Conversation Relay`, `${this.logMessage} Setup complete`);
    }

    // This is sent for every message received from Conversation Relay after setup.
    async incomingMessage(message) {
        try {
            // Only reset silence timer for non-info messages
            if (this.silenceHandler && message.type !== 'info') {
                this.silenceHandler.resetTimer();
            }

            switch (message.type) {
                case 'info':
                    break;
                case 'prompt':
                    logOut(`Conversation Relay`, `${this.logMessage} PROMPT >>>>>>: ${message.voicePrompt}`);
                    // Fire an event that a prompt was received if anybody want to do something with it.
                    this.emit('conversationRelay.prompt', message.voicePrompt);

                    try {
                        // Kick off the process to generate a response. This will emit a 'llm.response' event when the response is ready.
                        this.responseService.generateResponse('user', message.voicePrompt);
                        // const generatedResponse = this.responseService.generateResponse('user', message.voicePrompt);
                        // logOut(`Conversation Relay`, `${this.logMessage} Generated response: ${JSON.stringify(generatedResponse, null, 4)}`);
                        // The response can be a message or end call type

                    } catch (error) {
                        throw new Error(`Conversation Relay Switch Message type ${message.type}: ${this.logMessage} Error in generating response: ${error}`);
                    }
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

    // This is called for messages that has to be sent directly to Conversation Relay, bypassing the Response Service logic and only inserting the message into the Response Service history for context. Use this in cases where a live agent or similar process overrides the Response Service
    async outgoingMessage(message) {
        try {
            logOut(`Conversation Relay`, `${this.logMessage} Outgoing message from Agent: ${message}`);
            this.responseService.insertMessageIntoContext(message);
            this.emit('conversationRelay.agentMessage', response);
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
        // Clean up the LLM service
        if (this.responseService) {
            this.responseService.cleanup();
        }
        // Remove all event listeners from this instance
        this.removeAllListeners();
    }
}

module.exports = { ConversationRelayService };
