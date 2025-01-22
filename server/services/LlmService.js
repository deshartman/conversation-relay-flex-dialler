/**
 * Service for managing interactions with OpenAI's LLM, handling conversation context, and processing tool calls. Extends EventEmitter to support event-based communication.
 */
const OpenAI = require('openai');
const EventEmitter = require('events');
const { logOut, logError } = require('../utils/logger');

const { TWILIO_FUNCTIONS_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;

class LlmService extends EventEmitter {
    /**
     * Generates a concise summary of the conversation context using the LLM
     * @returns {Promise<string>} A summary of the conversation under 50 words
     */
    async generateConversationSummary() {
        const summaryResponse = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: "Create a concise summary (under 50 words) of this conversation. Focus on key points and outcomes."
                },
                ...this.promptContext
            ],
            stream: false,
        });

        return summaryResponse.choices[0]?.message?.content || "No conversation summary available";
    }

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

    /**
     * Generates a response using the OpenAI API, handling both direct responses and tool calls.
     * @param {string} [role='user'] - The role of the message sender ('user' or 'system')
     * @param {string} prompt - The input prompt to generate a response for
     * @emits llm.response - Emits an event with the response object containing either text content or handoff data
     * @throws {Error} If there's an error in the OpenAI API call or tool execution
     */
    async generateResponse(role = 'user', prompt) {
        this.promptContext.push({ role: role, content: prompt });

        // Call the OpenAI API to generate a response
        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                tools: this.toolManifest,
                messages: this.promptContext,
                stream: false,
            });

            // Get the Content or toolCalls array from the response
            const assistantMessage = response.choices[0]?.message;
            const toolCalls = assistantMessage?.tool_calls;

            // The response will be the use of a Tool or just a Response. If the toolCalls array is empty, then it is just a response
            if (toolCalls && toolCalls.length > 0) {
                // Add the assistant's message with tool_calls to messages
                this.promptContext.push(assistantMessage);

                // The toolCalls array will contain the tool name and the response content
                for (const toolCall of toolCalls) {
                    // Make the fetch request to the Twilio Functions URL with the tool name as the path and the tool arguments as the body
                    logOut('LLM', `Fetching Function tool: ${toolCall.function.name} at URL: ${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`);

                    // Handle different tool calls using switch statement
                    switch (toolCall.function.name) {
                        case "live-agent-handoff":
                            logOut('LLM', `Live Agent Handoff tool call: ${toolCall.function.name}`);
                            // Get a summary of the conversation
                            const handoffSummary = await this.generateConversationSummary();
                            logOut('LLM', `Handoff Summary: ${handoffSummary}`);

                            // Add the tool response to messages array
                            const handoffToolResponse = {
                                role: "tool",
                                content: JSON.stringify({ status: "handoff-initiated", summary: handoffSummary }),
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(handoffToolResponse);

                            const handoffResponseContent = {
                                type: "end",
                                handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                                    reasonCode: "live-agent-handoff",
                                    reason: "Reason for the handoff",
                                    conversationSummary: handoffSummary,
                                })
                            };
                            logOut('LLM', `Transfer to agent response: ${JSON.stringify(handoffResponseContent, null, 4)}`);
                            this.emit('llm.response', handoffResponseContent);
                            break;

                        case "send-dtmf": {
                            // logOut('LLM', `Send DTMF call: ${toolCall.function.name} and arguments: ${toolCall.function.arguments}`);

                            // Parse the arguments string into an object
                            const dtmfArgs = JSON.parse(toolCall.function.arguments);
                            // logOut('LLM', `DTMF Digit: ${dtmfArgs.dtmfDigit}`);

                            // Add the tool response to messages array
                            const toolResponse = {
                                role: "tool",
                                content: `DTMF digit sent: ${dtmfArgs.dtmfDigit}`,
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(toolResponse);

                            // Now return the specific response from the LLM
                            const dtmfResponseContent = {
                                "type": "sendDigits",
                                "digits": dtmfArgs.dtmfDigit
                            };
                            logOut('LLM', `Send DTMF response: ${JSON.stringify(dtmfResponseContent, null, 4)}`);
                            this.emit('llm.response', dtmfResponseContent);
                            break;
                        }

                        case "send-text":
                        // Fall through to default case to handle these tool calls with the existing function execution logic

                        case "end-call":
                            logOut('LLM', `End the call tool call: ${toolCall.function.name} with args: ${JSON.stringify(toolCall.function.arguments, null, 4)}`);

                            // Get a summary of the conversation
                            const endCallSummary = await this.generateConversationSummary();
                            logOut('LLM', `End Call Summary: ${endCallSummary}`);

                            // Parse the arguments string into an object
                            const callArgs = JSON.parse(toolCall.function.arguments);
                            logOut('LLM', `Ending call with Call SID: ${callArgs.callSid}`);

                            // Add the tool response to messages array
                            const endCallToolResponse = {
                                role: "tool",
                                content: JSON.stringify({ status: "call-ended", summary: endCallSummary }),
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(endCallToolResponse);

                            const endResponseContent = {
                                type: "end",
                                handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                                    reasonCode: "end-call",
                                    reason: "Ending the call",
                                    conversationSummary: endCallSummary,
                                })
                            };
                            logOut('LLM', `Ending the call`);
                            this.emit('llm.response', endResponseContent);
                            break;

                        default:
                            const functionResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: toolCall.function.arguments,
                            });

                            const toolResult = await functionResponse.json();
                            logOut('LLM', `Tool response: ${JSON.stringify(toolResult, null, 4)}`);

                            // Add the tool response to messages array
                            const toolResponse = {
                                role: "tool",
                                content: JSON.stringify(toolResult),
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(toolResponse);

                            // Emit the tool response immediately
                            const toolResponseContent = {
                                type: "text",
                                token: JSON.stringify(toolResult),
                                last: false
                            };
                            this.emit('llm.response', toolResponseContent);
                    }
                }

                // After all tool responses are collected, get the final response from the model
                const finalResponse = await this.openai.chat.completions.create({
                    model: this.model,
                    messages: this.promptContext,
                    stream: false,
                });

                const finalAssistantMessage = finalResponse.choices[0]?.message;
                if (finalAssistantMessage) {
                    this.promptContext.push(finalAssistantMessage);

                    const finalResponseContent = {
                        type: "text",
                        token: finalAssistantMessage.content || "",
                        last: true
                    };
                    this.emit('llm.response', finalResponseContent);
                } else {
                    throw new Error('No response received from OpenAI');
                }
            } else {
                // If the toolCalls array is empty, then it is just a response
                this.promptContext.push(assistantMessage);

                const directResponseContent = {
                    type: "text",
                    token: assistantMessage?.content || "",
                    last: true
                };

                this.emit('llm.response', directResponseContent);
            }
        } catch (error) {
            logError('LLM', `Error in LlmService: ${error}`);
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
