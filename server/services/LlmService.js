const OpenAI = require('openai');
const EventEmitter = require('events');

const { TWILIO_FUNCTIONS_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;

class LlmService extends EventEmitter {
    constructor(promptContext, toolManifest) {
        super();
        this.openai = new OpenAI(); // Implicitly uses OPENAI_API_KEY
        this.model = OPENAI_MODEL;
        this.messages = [
            { role: "system", content: promptContext },
        ];
        this.toolManifest = toolManifest.tools || [];
    }

    /**
     * Sets up call-related parameters and updates the conversation context with customer information.
     * @param {Object} setupParameters - The parameters for setting up the call
     * @param {string} setupParameters.to - The Twilio phone number to call from
     * @param {string} setupParameters.from - The customer's phone number
     * @param {string} setupParameters.callSid - The unique identifier for the call
     * @param {string} setupParameters.customerReference - The customer's reference ID
     * @param {string} setupParameters.firstname - The customer's first name
     * @param {string} setupParameters.lastname - The customer's last name
     * @param {string} setupParameters.greetingText - The greeting text to use for the call
     */
    setCallParameters(setupParameters) {
        this.twilioNumber = setupParameters.to;
        this.customerNumber = setupParameters.from;
        this.callSid = setupParameters.callSid;
        this.customerReference = setupParameters.customerReference;
        this.firstname = setupParameters.firstname;
        this.lastname = setupParameters.lastname;
        this.greetingText = setupParameters.greetingText;

        // Update this.messages with the phone "to" and the "from" numbers
        console.log(`[LlmService] Call to: ${this.twilioNumber} from: ${this.customerNumber} with call SID: ${this.callSid}`);

        this.messages.push({ role: 'system', content: `The customer phone number or "from" number is ${this.customerNumber}, the callSid is ${this.callSid} and the number to send SMSs from is: ${this.twilioNumber}. Use this information throughout as the reference when calling any of the tools. Specifically use the callSid when you use the "transfer-to-agent" tool to transfer the call to the agent` });
        this.messages.push({ role: 'system', content: `The customer's first name is ${this.firstname} and last name is ${this.lastname}.` });
    }

    async generateResponse(role = 'user', prompt) {
        // console.log(`[LlmService] Generating response for role: ${role} with prompt: ${prompt}`);
        // Add the prompt as role user to the existing this.messages array
        this.messages.push({ role: role, content: prompt });
        // console.log(`[LlmService] Messages: ${JSON.stringify(this.messages, null, 4)}`);

        // Call the OpenAI API to generate a response
        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                tools: this.toolManifest,
                messages: this.messages,
                stream: false,
            });

            // Get the Content or toolCalls array from the response
            const assistantMessage = response.choices[0]?.message;
            const toolCalls = assistantMessage?.tool_calls;

            // The response will be the use of a Tool or just a Response. If the toolCalls array is empty, then it is just a response
            if (toolCalls && toolCalls.length > 0) {
                // Add the assistant's message with tool_calls to messages
                this.messages.push(assistantMessage);

                // The toolCalls array will contain the tool name and the response content
                for (const toolCall of toolCalls) {
                    // Make the fetch request to the Twilio Functions URL with the tool name as the path and the tool arguments as the body
                    console.log(`[LlmService] Fetching Function tool: ${toolCall.function.name} at URL: ${TWILIO_FUNCTIONS_URL}/tools/${toolCall.function.name}`);

                    // Check if the tool call is for the 'liveAgentHandoff' function. NOTE: This tool never gets executed, only referenced in the Manifest.
                    if (toolCall.function.name === "live-agent-handoff") {
                        console.log(`[LlmService] Live Agent Handoff tool call: ${toolCall.function.name}`);
                        const responseContent =
                        {
                            type: "end",
                            handoffData: JSON.stringify({   // TODO: Why does this have to be stringified?
                                reasonCode: "live-agent-handoff",
                                reason: "Reason for the handoff",
                                conversationSummary: "handing over to agent TODO: Summary of the conversation",
                            })
                        };

                        // this.messages.push({ role: 'assistant', content: responseContent });
                        console.log(`[LlmService] Transfer to agent response: ${JSON.stringify(responseContent, null, 4)}`);
                        return responseContent;
                    } else {
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
                        this.messages.push(toolResponse);

                        // After adding tool response, get the final response from the model
                        const finalResponse = await this.openai.chat.completions.create({
                            model: this.model,
                            messages: this.messages,
                            stream: false,
                        });

                        const assistantMessage = finalResponse.choices[0]?.message;
                        if (assistantMessage) {
                            this.messages.push(assistantMessage);

                            const responseContent = {
                                type: "text",
                                token: assistantMessage.content || "",
                                last: true
                            };
                            return responseContent;
                        } else {
                            throw new Error('No response received from OpenAI');
                        }
                    }
                }
            } else {
                // If the toolCalls array is empty, then it is just a response
                this.messages.push(assistantMessage);

                const responseContent = {
                    type: "text",
                    token: assistantMessage?.content || "",
                    last: true
                };

                return responseContent;
            }
        } catch (error) {
            console.error('Error in LlmService:', error);
            throw error;
        }
    };
}

module.exports = { LlmService };
