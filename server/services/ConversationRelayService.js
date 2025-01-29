/**
 * @class ConversationRelayService
 * @extends EventEmitter
 * @description Manages conversation relay between users and an LLM (Language Learning Model) service.
 * This service orchestrates:
 * 
 * 1. Message Flow Management:
 *    - Handles incoming messages from users
 *    - Processes outgoing messages from agents
 *    - Manages LLM service responses
 *    - Controls conversation context
 * 
 * 2. Event Management:
 *    - Emits events for responses, silence, prompts
 *    - Handles DTMF (touch-tone) signals
 *    - Manages live agent handoff events
 *    - Controls conversation termination
 * 
 * 3. Silence Detection:
 *    - Monitors for conversation inactivity
 *    - Sends reminder messages
 *    - Handles call termination on extended silence
 * 
 * The service integrates with a Response Service (LLM) to process messages and
 * maintain conversation context, while managing timeouts and cleanup.
 * 
 * @property {Object} responseService - LLM service for processing responses
 * @property {SilenceHandler} silenceHandler - Handles silence detection
 * @property {string|null} logMessage - Utility log message with call SID
 * 
 * Events Emitted:
 * - conversationRelay.response: LLM response received
 * - conversationRelay.end: Conversation ended
 * - conversationRelay.dtmf: DTMF signal received
 * - conversationRelay.handoff: Live agent handoff requested
 * - conversationRelay.silence: Silence detected
 * - conversationRelay.prompt: Voice prompt received
 * - conversationRelay.agentMessage: Direct agent message
 * 
 * @example
 * // Initialize the service
 * const responseService = new LlmService();
 * const relayService = new ConversationRelayService(responseService);
 * 
 * // Set up event handlers
 * relayService.on('conversationRelay.response', (response) => {
 *   console.log('LLM Response:', response);
 * });
 * 
 * // Start conversation
 * await relayService.setup(sessionCustomerData);
 * 
 * // Handle incoming message
 * await relayService.incomingMessage({
 *   type: 'prompt',
 *   voicePrompt: 'Hello, how can I help?'
 * });
 * 
 * // Cleanup when done
 * relayService.cleanup();
 */

const EventEmitter = require('events');
const { SilenceHandler } = require('./SilenceHandler');
const { logOut, logError } = require('../utils/logger');

const {
    TWILIO_FUNCTIONS_URL
} = process.env;

class ConversationRelayService extends EventEmitter {
    /**
     * Creates a new ConversationRelayService instance.
     * Initializes event handlers for LLM responses and sets up silence detection.
     * 
     * @param {Object} responseService - LLM service for processing responses
     * @throws {Error} If responseService is not provided
     */
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

    /**
     * Initializes a new conversation relay session.
     * Sets up initial context, silence monitoring, and prepares the conversation flow.
     * This method is called once at the start of a new conversation.
     * 
     * @async
     * @param {Object} sessionCustomerData - Session and customer information
     * @param {Object} sessionCustomerData.customerData - Customer-specific data
     * @param {Object} sessionCustomerData.setupData - Call setup information
     * @param {string} sessionCustomerData.setupData.callSid - Unique call identifier
     * @emits conversationRelay.silence
     * @returns {Promise<void>} Resolves when setup is complete
     */
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

    /**
     * Processes incoming messages from the conversation relay.
     * Handles different message types:
     * - info: System information messages
     * - prompt: Voice prompts requiring LLM response
     * - interrupt: User interruption events
     * - dtmf: Touch-tone signals
     * - setup: Initial setup messages
     * 
     * @async
     * @param {Object} message - Incoming message object
     * @param {string} message.type - Message type ('info'|'prompt'|'interrupt'|'dtmf'|'setup')
     * @param {string} [message.voicePrompt] - Voice prompt content for 'prompt' type
     * @param {string} [message.utteranceUntilInterrupt] - Partial utterance for 'interrupt' type
     * @param {string} [message.digit] - DTMF digit for 'dtmf' type
     * @emits conversationRelay.prompt
     * @throws {Error} If message handling fails
     * @returns {Promise<void>} Resolves when message is processed
     */
    async incomingMessage(message) {
        try {
            // Only reset silence timer for non-info messages
            if (this.silenceHandler && message.type !== 'info') {
                this.silenceHandler.resetTimer();
            }

            switch (message.type) {
                case 'info':
                    logOut(`Conversation Relay`, `${this.logMessage} INFO: ${message.info}`);
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
                    logError(`Conversation Relay`, `${this.logMessage} Unknown message type: ${message.type}`);
            }
        } catch (error) {
            logError(`Conversation Relay`, `${this.logMessage} Error in message handling: ${error}`);
            throw error;
        }
    }

    /**
     * Handles outgoing messages from agents or other direct sources.
     * Bypasses the Response Service logic and only inserts the message into context.
     * Used when a live agent or similar process overrides the Response Service.
     * 
     * @async
     * @param {string} message - Message content to send
     * @emits conversationRelay.agentMessage
     * @throws {Error} If message handling fails
     * @returns {Promise<void>} Resolves when message is processed
     */
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

    /**
     * Performs cleanup of service resources.
     * - Cleans up silence handler
     * - Cleans up LLM service
     * - Removes all event listeners
     * 
     * Call this method when the conversation is complete to prevent memory leaks
     * and ensure proper resource cleanup.
     */
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
