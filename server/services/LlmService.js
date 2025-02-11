/**
 * @class LlmService
 * @extends EventEmitter
 * @description Manages interactions with OpenAI's Language Learning Model (LLM).
 * This service orchestrates:
 * 
 * 1. LLM Communication:
 *    - Manages OpenAI API interactions
 *    - Handles streaming responses
 *    - Maintains conversation context
 * 
 * 2. Tool Integration:
 *    - Processes tool calls from LLM
 *    - Executes tool-specific actions
 *    - Handles tool response integration
 * 
 * 3. Event Management:
 *    - Emits response events
 *    - Handles DTMF signals
 *    - Manages conversation termination
 *    - Processes agent handoffs
 * 
 * The service uses OpenAI's streaming API to process responses chunk by chunk,
 * supporting real-time conversation flow and tool execution.
 * 
 * @property {OpenAI} openai - OpenAI API client instance
 * @property {string} model - OpenAI model identifier
 * @property {Array<Object>} promptContext - Conversation history and context
 * @property {Array<Object>} toolManifest - Available tools configuration
 * 
 * Environment Configuration Required:
 * - OPENAI_API_KEY: OpenAI authentication key
 * - OPENAI_MODEL: Model identifier to use
 * - TWILIO_FUNCTIONS_URL: Base URL for Twilio Functions
 * 
 * Events Emitted:
 * - llm.response: Text response from LLM
 * - llm.end: Conversation end signal
 * - llm.dtmf: DTMF signal command
 * - llm.handoff: Live agent handoff request
 * 
 * @example
 * // Initialize the service
 * const llmService = new LlmService(
 *   "Initial system prompt",
 *   { tools: [] }
 * );
 * 
 * // Set up event handlers
 * llmService.on('llm.response', (response) => {
 * console.log('LLM Response:', response);
 * });
 * 
 * // Generate response
 * await llmService.generateResponse('user', 'Hello, how can I help?');
 * 
 * // Cleanup when done
 * llmService.cleanup();
 */
const OpenAI = require('openai');
const EventEmitter = require('events');
const { logOut, logError } = require('../utils/logger');
const { log } = require('console');

const { TWILIO_FUNCTIONS_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;

class LlmService extends EventEmitter {

    /**
     * Creates a new LLM service instance.
     * Initializes OpenAI client, sets up conversation context, and configures available tools.
     * 
     * @param {string} promptContext - Initial system prompt context for the LLM
     * @param {Object} toolManifest - Configuration of available tools
     * @param {Array<Object>} [toolManifest.tools=[]] - Array of tool definitions
     * @throws {Error} If OpenAI initialization fails or if required parameters are missing
     */
    constructor(promptContext, toolManifest) {
        super();
        this.openai = new OpenAI(); // Implicitly uses OPENAI_API_KEY
        this.model = OPENAI_MODEL;
        this.promptContext = [
            { role: "system", content: promptContext },
        ];
        this.toolManifest = toolManifest.tools || [];
    }

    /**
     * Executes tool calls received from the LLM.
     * Handles special cases and default tool execution through Twilio Functions.
     * 
     * Special cases:
     * - live-agent-handoff: Initiates transfer to human agent
     * - send-dtmf: Sends touch-tone signals
     * - end-call: Terminates the conversation
     * 
     * @async
     * @param {Object} toolCall - Tool call information from LLM
     * @param {Object} toolCall.function - Function details
     * @param {string} toolCall.function.name - Name of the tool to execute
     * @param {string} toolCall.function.arguments - JSON string of tool arguments
     * @returns {Promise<Object>} Tool execution result containing:
     *   - type: Response type ('text'|'end'|'sendDigits'|'error')
     *   - token/digits/handoffData: Response data based on type
     *   - last: Boolean indicating if this is the final response
     * @throws {Error} If tool execution fails or arguments are invalid
     */
    async executeToolCall(toolCall) {

        let toolName = null;
        let toolArguments = null;

        // Validate tool name and arguments are proper JSON
        try {
            toolName = toolCall.function.name;
            toolArguments = JSON.parse(toolCall.function.arguments);
            // logOut(`LLMService`, `Executing tool call with name: ${toolName} with args: ${JSON.stringify(toolArguments, null, 4)}`);
        } catch (error) {
            throw new Error(`LLM.executeToolCall: Invalid tool with error ${error}`);
        }

        switch (toolName) {     // TODO: This logic should live in conversation Relay Service and not here, since it is not specific to the LLM
            case "live-agent-handoff":
                logOut('LLM', `Live Agent handoff End the call with tool call: [${toolName}] with args: ${toolArguments}`);
                const handoffResponseContent = {
                    type: "end",
                    handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                        reasonCode: "live-agent-handoff",
                        reason: toolArguments.summary
                    })
                };
                logOut('LLM', `Transfer to agent response: ${JSON.stringify(handoffResponseContent, null, 4)}`);
                return handoffResponseContent;
            case "send-dtmf":
                // Parse the arguments string into an object
                // logOut('LLM', `DTMF Digit: ${toolArguments.dtmfDigit}`);

                // Now return the specific response from the LLM
                const dtmfResponseContent = {
                    "type": "sendDigits",
                    "digits": toolArguments.dtmfDigit
                };
                // logOut('LLM', `Send DTMF response: ${JSON.stringify(dtmfResponseContent, null, 4)}`);
                return dtmfResponseContent;
            case "end-call":
                logOut('LLM', `End the call with tool call: [${toolName}] with args: ${toolArguments}`);
                const endResponseContent = {
                    type: "end",
                    handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                        reasonCode: "end-call",
                        reason: "Ending the call",
                        conversationSummary: toolArguments.summary,
                    })
                };
                logOut('LLM', `Ending the call with endResponseContent: ${JSON.stringify(endResponseContent, null, 4)}`);
                return endResponseContent;
            default:
                try {
                    // Validate and parse the arguments first
                    const functionResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/${toolName}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(toolArguments), // Send properly stringified JSON
                    });

                    // Check if response is ok before trying to parse JSON
                    if (!functionResponse.ok) {
                        const errorText = await functionResponse.text();
                        throw new Error(`API call failed with status ${functionResponse.status}: ${errorText}`);
                    }

                    const toolResult = await functionResponse.json();
                    logOut('LLM', `Tool response: ${JSON.stringify(toolResult, null, 4)}`);

                    // Emit the tool response immediately
                    const toolResponseContent = {
                        type: "text",
                        token: JSON.stringify(toolResult),
                        last: false
                    };
                    return toolResponseContent;
                } catch (error) {
                    logError('LLM', `Error executing tool call 3: ${error.message}`);
                    // Return an error response that can be handled by the system
                    return {
                        type: "error",
                        token: JSON.stringify({ error: error.message }),
                        last: true
                    };
                }
        }
    }


    /**
     * Generates a response using the OpenAI API, handling both direct responses and tool calls.
     * @param {string} [role='user'] - The role of the message sender ('user' or 'system')
     * @param {string} prompt - The input prompt to generate a response for
     * @emits llm.response - Emits an event with the response object containing either text content or handoff data
     * @throws {Error} If there's an error in the OpenAI API call or tool execution
     */
    async generateResponse(role = 'user', prompt) {
        let fullResponse = '';
        let toolCallCollector = null;
        let accumulatedArguments = '';
        let endCallResponse = null;  // Add the response here if the call can be ended

        try {
            this.promptContext.push({ role: role, content: prompt });

            const stream = await this.openai.chat.completions.create({
                model: this.model,
                tools: this.toolManifest,
                messages: this.promptContext,
                stream: true,
            });

            for await (const chunk of stream) {
                if (this.isInterrupted) {
                    break;
                }

                const deltaContent = chunk.choices[0]?.delta?.content || '';
                const deltaToolCalls = chunk.choices[0]?.delta?.tool_calls;

                if (deltaContent) {
                    fullResponse += deltaContent;
                    this.emit('llm.response', {
                        type: "text",
                        token: deltaContent,
                        last: false
                    });
                }

                if (deltaToolCalls) {
                    for (const toolCall of deltaToolCalls) {
                        // Initialize collector for first chunk
                        if (toolCall.index === 0 && !toolCallCollector) {
                            toolCallCollector = {
                                id: toolCall.id || 'generated-' + Date.now(),
                                function: {
                                    name: '',
                                    arguments: ''
                                }
                            };
                        }

                        // Update function name if provided
                        if (toolCall.function?.name) {
                            toolCallCollector.function.name = toolCall.function.name;
                        }

                        // Just accumulate argument tokens without trying to parse them
                        if (toolCall.function?.arguments) {
                            accumulatedArguments += toolCall.function.arguments;
                        }
                    }
                }

                if (chunk.choices[0]?.finish_reason === 'tool_calls' && toolCallCollector) {

                    // Final validation of collected tool call data
                    if (!toolCallCollector.function.name) {
                        throw new Error(`LLM GenerateResponse: Missing function name in tool call: ${JSON.stringify(toolCallCollector, null, 2)}`);
                    }

                    // Now that we have all chunks, try to parse the complete JSON
                    try {
                        if (!accumulatedArguments) {
                            throw new Error("No arguments provided");
                        }

                        // If we have multiple JSON objects concatenated, take the first one
                        const match = accumulatedArguments.match(/^(\{[^}]+\})/);
                        if (match) {
                            accumulatedArguments = match[1];
                        }

                        JSON.parse(accumulatedArguments);
                    } catch (error) {
                        throw new Error(`LLM GenerateResponse: Invalid or incomplete JSON arguments: ${accumulatedArguments} and error: ${error}`);
                    }

                    const toolCallObj = {
                        id: toolCallCollector.id,
                        function: {
                            name: toolCallCollector.function.name,
                            arguments: accumulatedArguments
                        }
                    };
                    // logOut('LLM', `Executing tool call 4 with: ${JSON.stringify(toolCallObj, null, 2)}`);

                    // Execute the tool
                    let toolResult = null;
                    try {
                        toolResult = await this.executeToolCall(toolCallObj);

                        // Handle tool execution results specifically fo end calls type
                        // if (toolResult.type === "end") {
                        //     logOut('LLM', `Tool call result is an "end call, so set the endCallResponse = ${JSON.stringify(toolResult, null, 4)}`);
                        //     endCallResponse = toolResult;
                        // }
                    } catch (error) {
                        throw new Error(`LLM generateResponse.executeToolCall error: ${error}`);
                    }

                    // Add assistant response and tool result to history
                    this.promptContext.push({
                        role: "assistant",
                        content: fullResponse,
                        tool_calls: [{
                            id: toolCallObj.id,
                            type: "function",
                            function: {
                                name: toolCallObj.function.name,
                                arguments: toolCallObj.function.arguments
                            }
                        }]
                    });

                    this.promptContext.push({
                        role: "tool",
                        content: JSON.stringify(toolResult),
                        tool_call_id: toolCallObj.id
                    });

                    /**
                     * Do we need to create a follow up stream for DTMF?
                     * The LLM determined that it needs to send a DTMF as the response, but there is no text "response" required for the fact that we sent a DTMF.
                     * 
                     * In a similar manner if the LLM determined that it needs to send an end-call or live-agent-handoff, we should not send a text "response" to the user after the tool call
                     */
                    // Handle tool execution results for specific tool types, otherwise continue the conversation
                    logOut('LLM', `Tool name: ${toolCallObj.function.name}`);
                    switch (toolCallObj.function.name) {
                        case 'send-dtmf':
                            logOut('LLM', `llm.dtmf event response: ${JSON.stringify(toolResult, null, 4)}`);
                            this.emit('llm.dtmf', toolResult);
                            break;
                        case 'end-call':
                            this.emit('llm.end', toolResult);
                            break;
                        case 'live-agent-handoff':
                            this.emit('llm.handoff', toolResult);
                            break;
                        default:
                            // Continue the conversation with tool results
                            const followUpStream = await this.openai.chat.completions.create({
                                model: this.model,
                                messages: this.promptContext,
                                stream: true
                            });

                            logOut('LLM', `DEFAULT CASE: Running Followup stream now with tool: ${toolCallObj.function.name}`);
                            for await (const chunk of followUpStream) {
                                if (this.isInterrupted) {
                                    break;
                                }
                                const content = chunk.choices[0]?.delta?.content || '';
                                if (content) {
                                    fullResponse += content;
                                    this.emit('llm.response', {
                                        type: "text",
                                        token: content,
                                        last: false
                                    });
                                }
                            }
                            break;
                    }
                }
            }

            // Add final assistant response to history if no tool was called
            if (!toolCallCollector) {
                this.promptContext.push({
                    role: "assistant",
                    content: fullResponse
                });
            }

            // Emit the final content with last=true
            logOut('LLM', `#### llm.response event for final content: ${fullResponse}`);
            this.emit('llm.response', {
                type: "text",
                token: fullResponse,
                last: true
            });

            // // After all messages have been handled, check if the call can be ended and emit llm.end event
            // if (endCallResponse) {
            //     this.emit('llm.end', endCallResponse);
            // }

            // if (sendDTMFResponse) {
            //     this.emit('llm.dtmf', sendDTMFResponse);
            // }

        } catch (error) {
            throw new Error(`LLM generateResponse error: ${error}`);
        }
    };

    /**
     * Inserts a message into the conversation context.
     * Used for live agent handling and context updates without generating immediate responses.
     * 
     * @async
     * @param {string} [role='system'] - Message role ('system'|'user'|'assistant'|'tool')
     * @param {string} message - Content to add to context
     * @returns {Promise<void>} Resolves when message is inserted
     */
    async insertMessageIntoContext(role = 'system', message) {
        this.promptContext.push({ role, content: message });
        // logOut('LLM', `Inserted message: ${message} with role: ${role} into the context`);
    }

    /**
     * Performs cleanup of service resources.
     * - Removes all event listeners
     * - Clears conversation context
     * - Cleans up tool configurations
     * 
     * Call this method when the conversation is complete to prevent memory leaks
     * and ensure proper resource cleanup.
     */
    cleanup() {
        // Remove all event listeners
        this.removeAllListeners();
        // Clear the prompt context
        this.promptContext = [];
        // Clear the tool manifest
        this.toolManifest = [];
    }
}

module.exports = { LlmService };
