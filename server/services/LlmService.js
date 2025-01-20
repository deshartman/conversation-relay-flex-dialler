/**
 * Service for managing interactions with OpenAI's LLM, handling conversation context, and processing tool calls. Extends EventEmitter to support event-based communication.
 */
const OpenAI = require('openai');
const EventEmitter = require('events');

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

    /**
     * Generates a response using the OpenAI API, handling both direct responses and tool calls.
     * @param {string} [role='user'] - The role of the message sender ('user' or 'system')
     * @param {string} prompt - The input prompt to generate a response for
     * @emits llm.response - Emits an event with the response object containing either text content or handoff data
     * @throws {Error} If there's an error in the OpenAI API call or tool execution
     */
    async generateResponse(role = 'user', prompt) {
        // console.log(`[LlmService] Generating response for role: ${role} with prompt: ${prompt}`);
        // Add the prompt as role user to the existing this.messages array
        this.promptContext.push({ role: role, content: prompt });
        // console.log(`[LlmService] Prompt Messages: ${JSON.stringify(this.promptContext, null, 4)}`);

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
                    console.log(`[LlmService] Fetching Function tool: ${toolCall.function.name} at URL: ${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`);

                    // Handle different tool calls using switch statement
                    switch (toolCall.function.name) {
                        case "live-agent-handoff":
                            console.log(`[LlmService] Live Agent Handoff tool call: ${toolCall.function.name}`);
                            const responseContent = {
                                type: "end",
                                handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                                    reasonCode: "live-agent-handoff",
                                    reason: "Reason for the handoff",
                                    conversationSummary: "handing over to agent TODO: Summary of the conversation",
                                })
                            };
                            console.log(`[LlmService] Transfer to agent response: ${JSON.stringify(responseContent, null, 4)}`);
                            this.emit('llm.response', responseContent);
                            break;

                        case "send-dtmf": {
                            console.log(`[LlmService] Send DTMF call: ${toolCall.function.name} and arguments: ${toolCall.function.arguments}`);
                            // log out the DTMF digit from toolCall.function.arguments

                            // Parse the arguments string into an object
                            const dtmfArgs = JSON.parse(toolCall.function.arguments);
                            console.log(`[LlmService] DTMF Digit: ${dtmfArgs.dtmfDigit}`);

                            // Add the tool response to messages array
                            const toolResponse = {
                                role: "tool",
                                content: `DTMF digit sent: ${dtmfArgs.dtmfDigit}`,
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(toolResponse);

                            // Now return the specific response from the LLM
                            const responseContent = {
                                "type": "sendDigits",
                                "digits": dtmfArgs.dtmfDigit
                            };
                            console.log(`[LlmService] Send DTMF response: ${JSON.stringify(responseContent, null, 4)}`);
                            this.emit('llm.response', responseContent);
                            break;
                        }
                        case "send-text":
                        // Fall through to default case to handle these tool calls with the existing function execution logic

                        default:
                            const functionResponse = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: toolCall.function.arguments,
                            });

                            const toolResult = await functionResponse.json();
                            // Log the content type of the response
                            console.log(`[LlmService] Tool response: ${JSON.stringify(toolResult, null, 4)}`);
                            // Now take the result and pass it back to the LLM as a tool response
                            // console.log(`[LlmService] Tool response: ${toolCall.response}`);

                            // // Add the tool response to messages array
                            const toolResponse = {
                                role: "tool",
                                content: JSON.stringify(toolResult),
                                tool_call_id: toolCall.id
                            };
                            this.promptContext.push(toolResponse);

                            // After adding tool response, get the final response from the model
                            const finalResponse = await this.openai.chat.completions.create({
                                model: this.model,
                                messages: this.promptContext,
                                stream: false,
                            });

                            const assistantMessage = finalResponse.choices[0]?.message;
                            if (assistantMessage) {
                                this.promptContext.push(assistantMessage);

                                const responseContent = {
                                    type: "text",
                                    token: assistantMessage.content || "",
                                    last: true
                                };
                                this.emit('llm.response', responseContent);
                            } else {
                                throw new Error('No response received from OpenAI');
                            }
                    }
                }
            } else {
                // If the toolCalls array is empty, then it is just a response
                this.promptContext.push(assistantMessage);

                const responseContent = {
                    type: "text",
                    token: assistantMessage?.content || "",
                    last: true
                };

                this.emit('llm.response', responseContent);
            }
        } catch (error) {
            console.error('Error in LlmService:', error);
            throw error;
        }
    };

    /**
     * Insert message into Context only. No immediate response required. USed for live agent handling.
     * This would be used when an agent interjects on the conversation and the LLM needs to be updated with the new context.
     */
    async insertMessageIntoHistory(message) {
        this.promptContext.push({ role: 'system', content: message });
        console.log(`[LlmService] Inserted context message: ${message}`);
        const responseContent = {
            type: "text",
            token: message,
            last: true
        };

        this.emit('llm.response', responseContent);
    }
}

module.exports = { LlmService };
