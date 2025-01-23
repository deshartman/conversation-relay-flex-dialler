/**
 * Service for managing interactions with OpenAI's LLM, handling conversation context, and processing tool calls. Extends EventEmitter to support event-based communication.
 */
const OpenAI = require('openai');
const EventEmitter = require('events');
const { logOut, logError } = require('../utils/logger');

const { TWILIO_FUNCTIONS_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;

class LlmService extends EventEmitter {

    /**
     * Creates a new LLM service instance.
     * @param {string} promptContext - Initial system prompt context for the LLM
     * @param {ToolManifest} toolManifest - Manifest of available tools for the LLM
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

    // This handles the different tools. There is a switch statement for the special cases and a default case for the rest.
    async executeToolCall(toolCall) {

        // Validate tool call structure
        if (!toolCall?.function?.name || !toolCall?.function?.arguments) {
            logError('LLM', `Invalid tool call structure: ${JSON.stringify(toolCall, null, 2)}`);
            return {
                type: "error",
                token: JSON.stringify({ error: "Invalid tool call structure - missing required fields" }),
                last: true
            };
        }

        const { name, arguments: args } = toolCall.function;
        logOut(`[LLMService]`, `Executing tool call: name: ${name} with args: ${args}`);

        // Validate arguments is proper JSON
        try {
            JSON.parse(args);
        } catch (error) {
            logError('LLM', `Invalid tool call arguments - not valid JSON: ${args}`);
            return {
                type: "error",
                token: JSON.stringify({ error: "Invalid tool call arguments - not valid JSON" }),
                last: true
            };
        }

        switch (name) {
            case "live-agent-handoff":
                const handoffResponseContent = {
                    type: "end",
                    handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                        reasonCode: "live-agent-handoff",
                        reason: "Reason for the handoff",
                        conversationSummary: handoffSummary,
                    })
                };
                logOut('LLM', `Transfer to agent response: ${JSON.stringify(handoffResponseContent, null, 4)}`);
                return handoffResponseContent;
            case "send-dtmf":
                // Parse the arguments string into an object
                const dtmfArgs = JSON.parse(toolCall.function.arguments);
                // logOut('LLM', `DTMF Digit: ${dtmfArgs.dtmfDigit}`);

                // Now return the specific response from the LLM
                const dtmfResponseContent = {
                    "type": "sendDigits",
                    "digits": dtmfArgs.dtmfDigit
                };
                logOut('LLM', `Send DTMF response: ${JSON.stringify(dtmfResponseContent, null, 4)}`);
                return dtmfResponseContent;
            case "end-call":
                logOut('LLM', `End the call tool call: ${toolCall.function.name} with args: ${JSON.stringify(toolCall.function.arguments, null, 4)}`);

                // Get a summary of the conversation
                const endCallSummary = toolCall.function.arguments.summary;
                logOut('LLM', `Ending call with Call SID: ${toolCall.function.arguments.callSid} and Call Summary: ${endCallSummary}`);

                const endResponseContent = {
                    type: "end",
                    handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                        reasonCode: "end-call",
                        reason: "Ending the call",
                        conversationSummary: endCallSummary,
                    })
                };
                logOut('LLM', `Ending the call`);
                return endResponseContent;
            default:
                try {
                    // Validate and parse the arguments first
                    const parsedArgs = JSON.parse(toolCall.function.arguments);

                    const functionResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(parsedArgs), // Send properly stringified JSON
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

                const content = chunk.choices[0]?.delta?.content || '';
                const toolCalls = chunk.choices[0]?.delta?.tool_calls;

                if (content) {
                    fullResponse += content;
                    this.emit('llm.response', {
                        type: "text",
                        token: content,
                        last: false
                    });
                }

                if (toolCalls) {
                    for (const toolCall of toolCalls) {
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
                        logError('LLM', `Missing function name in tool call: ${JSON.stringify(toolCallCollector, null, 2)}`);
                        this.emit('llm.response', {
                            type: "error",
                            token: JSON.stringify({ error: "Missing function name in tool call" }),
                            last: true
                        });
                        return {
                            type: "error",
                            token: JSON.stringify({ error: "Missing function name in tool call" }),
                            last: true
                        };
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
                        logError('LLM', `Invalid or incomplete JSON arguments: ${accumulatedArguments}`);
                        this.emit('llm.response', {
                            type: "error",
                            token: JSON.stringify({ error: `Invalid tool call arguments: ${error.message}` }),
                            last: true
                        });
                        return {
                            type: "error",
                            token: JSON.stringify({ error: `Invalid tool call arguments: ${error.message}` }),
                            last: true
                        };
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
                    const toolResult = await this.executeToolCall(toolCallObj);

                    // Handle tool execution results
                    if (toolResult.type === "end" || toolResult.type === "error") {
                        logOut('LLM', `Tool call result: ${JSON.stringify(toolResult, null, 4)}`);
                        return toolResult;
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

                    // Continue the conversation with tool results
                    const followUpStream = await this.openai.chat.completions.create({
                        model: this.model,
                        messages: this.promptContext,
                        stream: true
                    });

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
            this.emit('llm.response', {
                type: "text",
                token: fullResponse,
                last: true
            });

        } catch (error) {
            this.emit('llm.error', error);
            throw error;
        }
    };

    /**
     * Insert message into Context only. No immediate response required. USed for live agent handling.
     * This would be used when an agent interjects on the conversation and the LLM needs to be updated with the new context.
     */
    async insertMessageIntoContext(role = 'system', message) {

        this.promptContext.push({ role, content: message });
        // logOut('LLM', `Inserted message: ${message} with role: ${role} into the context`);
    }
}

module.exports = { LlmService };
