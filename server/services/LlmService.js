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
        // Ensure toolManifest is in the correct format
        this.toolManifest = toolManifest.tools || [];
    }

    // Static method to fetch context and manifest
    static async fetchContextAndManifest() {
        try {
            const context = await fetch(`${TWILIO_FUNCTIONS_URL}/context.md`);
            const promptContext = await context.text();
            const manifest = await fetch(`${TWILIO_FUNCTIONS_URL}/toolManifest.json`);
            const toolManifest = await manifest.json();
            console.log(`[LlmService] Fetched context and manifest from ${TWILIO_FUNCTIONS_URL}`);
            return { promptContext, toolManifest };
        } catch (error) {
            console.error('Error fetching context or manifest:', error);
            throw error;
        }
    }

    // Static method to initialize LLM service
    static async initialize() {
        try {
            const { promptContext, toolManifest } = await LlmService.fetchContextAndManifest();
            return new LlmService(promptContext, toolManifest);
        } catch (error) {
            console.error('Error initializing LLM service:', error);
            throw error;
        }
    }

    // Helper function to set the calling related parameters
    setCallParameters(setupParameters) {
        this.twilioNumber = setupParameters.to;
        this.customerNumber = setupParameters.from;
        this.callSid = setupParameters.callSid;

        // Update this.messages with the phone "to" and the "from" numbers
        console.log(`[LlmService] Call to: ${this.twilioNumber} from: ${this.customerNumber} with call SID: ${this.callSid}`);
        this.messages.push({ role: 'system', content: `The customer phone number or "from" number is ${this.customerNumber}, the callSid is ${this.callSid} and the number to send SMSs from is: ${this.twilioNumber}. Use this information throughout as the reference when calling any of the tools. Specifically use the callSid when you use the "transfer-to-agent" tool to transfer the call to the agent` });
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

            // Add the assistant's message to this.messages
            this.messages.push(assistantMessage);

            // The response will be the use of a Tool or just a Response. If the toolCalls array is empty, then it is just a response
            if (toolCalls && toolCalls.length > 0) {

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
                        // Add the tool call to the this.messages array
                        this.messages.push({
                            role: "tool",
                            content: JSON.stringify(toolResult),
                            tool_call_id: toolCall.id,
                        });

                        // After processing all tool calls, we need to get the final response from the model
                        const finalResponse = await this.openai.chat.completions.create({
                            model: this.model,
                            messages: this.messages,
                            stream: false,
                        });

                        const content = finalResponse.choices[0]?.message?.content || "";
                        this.messages.push({ role: 'assistant', content: content });

                        const responseContent =
                        {
                            type: "text",
                            token: content,
                            last: true
                        };
                        // console.log(`[LlmService] Text Response: ${JSON.stringify(responseContent, null, 4)}`);
                        return responseContent;
                    }
                }
            } else {
                // If the toolCalls array is empty, then it is just a response
                const content = assistantMessage?.content || "";

                // Get the role of the response
                // Add the response to the this.messages array
                this.messages.push({
                    role: "assistant",
                    content: content
                });

                const responseContent =
                {
                    type: "text",
                    token: content,
                    last: true
                };

                return responseContent
            }
        } catch (error) {
            console.error('Error in LlmService:', error);
            throw error;
        }
    };
}

module.exports = { LlmService };
