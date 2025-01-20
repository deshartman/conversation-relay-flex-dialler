require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');
const fs = require('fs').promises;
const path = require('path');
const { LlmService } = require('./services/LlmService');
const { FlexService } = require('./services/FlexService');
const { ConversationRelayService } = require('./services/ConversationRelayService');

const app = express();
const PORT = process.env.PORT || 3000;
ExpressWs(app);     // Initialize express-ws
app.use(express.urlencoded({ extended: true }));    // For Twilio url encoded body
app.use(express.json());    // For JSON payloads

// Global variables for context and manifest
let baseContext = null;
let baseManifest = null;
let customerDataMap = new Map();

// Extract environment variables
const {
    ACCOUNT_SID,
    AUTH_TOKEN,
    TWILIO_FUNCTIONS_URL
} = process.env;

const flexService = new FlexService();    // The FlexService is stateless

/** 
 * WebSocket endpoint for the Conversation Relay.
 * 
 * NOTE: Each time a new websocket is established, a new Conversation Relay is created and maintained as part of the websocket object. Websocket keeps track of which session it is and reloads the relevant Conversation Relay and LLM Service.
 * 
*/
app.ws('/conversation-relay', (ws) => {

    let sessionConversationRelay = null;
    let sessionCustomerData = null;
    let sessionConversation = null;

    // Handle incoming messages
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`[Server] Received message of type: ${message.type}`);

            // Initialize connection on setup message and strap in the Conversation Relay and associated LLM Service
            if (message.type === 'setup') {
                console.log(`[Server] ###################################################################################`);
                // grab the customerData from the map for this session based on the customerReference
                sessionCustomerData = customerDataMap.get(message.customParameters.customerReference);
                // console.log(`[Server] Session Customer Data: ${JSON.stringify(sessionCustomerData)}`);

                if (!sessionCustomerData) {
                    console.error('[Server] No customer data found for reference:', message.customParameters.customerReference);
                    ws.send(JSON.stringify({
                        type: 'text',
                        token: 'Customer data not found',
                        last: true
                    }));
                    return;
                }

                // Add the Conversation Relay "setup" message data to the sessionCustomerData
                sessionCustomerData.setupData = message;

                // Now check the customerData for the "reservation". TODO: this is an ugly hack to ensure Flex has responded with the reservation data. Will likely have timing issues.
                // If it is not present, wait for 100ms and try again.
                if (!sessionCustomerData.reservation) {
                    console.log(`[Server] <<<<<<<< No reservation found for reference: ${message.customParameters.customerReference}. Waiting for 100ms and trying again. >>>>>>>>`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                console.log(`[Server] New WS with setup message data added: ${JSON.stringify(sessionCustomerData, null, 4)}`);

                /**
                 * Now create a Conversation Relay to generate responses, using this Response Service.
                 * Note, this could be any service that implements the same interface, e.g., an echo service.
                 */
                // Create new response Service.
                console.log(`[Server] Creating Response Service`);
                const sessionResponseService = new LlmService(baseContext, baseManifest);
                console.log(`[Server] Creating ConversationRelayService`);
                sessionConversationRelay = new ConversationRelayService(sessionResponseService);

                // Set up handler for LLM responses
                sessionConversationRelay.on('conversationRelay.response', (response) => {
                    console.log(`[Server] Streaming or Sending message to ws with "last": ${JSON.stringify(response.last)}`);
                    ws.send(JSON.stringify(response));

                    // If this is the last message, write it to the Flex Interaction
                    if (response.last) {
                        const conversationSid = sessionCustomerData.taskAttributes.conversationSid;
                        console.log(`[Server] Last message in the response. Writing response.token to Flex Interaction.`);
                        flexService.createConversationMessage(conversationSid, "Chemtrails", response.token);
                    }
                });

                // Now handle the setup message
                sessionConversationRelay.setup(sessionCustomerData);

                // Set up silence event handler from Conversation Relay
                sessionConversationRelay.on('silence', (silenceMessage) => {
                    console.log(`[Server] Sending silence breaker message : ${JSON.stringify(silenceMessage)}`);
                    // Bypass the Conversation API and send directly to the ws
                    ws.send(JSON.stringify(silenceMessage));
                });

                // Handle "agentMessage" event from the Conversation Relay
                sessionConversationRelay.on('agentMessage', async (agentMessage) => {
                    console.log(`[Server] Sending agent message: ${JSON.stringify(agentMessage)}`);
                    // Bypass the Conversation API and send directly to the ws
                    ws.send(JSON.stringify(agentMessage));
                });

                console.log(`[Server] ###################################################################################`);
                console.log(`[Server] ###########################  SETUP COMPLETE #######################################`);
                return;
            }

            // ########################################################
            // ALL Other messages are handled by the Conversation Relay
            // ########################################################

            // For prompt messages, write to Flex Interaction, since there is no streaming from Conversation Relay to LLM
            if (message.type === 'prompt') {
                const conversationSid = sessionCustomerData.taskAttributes.conversationSid;
                console.log(`[Server] Writing message.voicePrompt to Flex Interaction: ${JSON.stringify(message, null, 4)}`);
                await flexService.createConversationMessage(conversationSid, "Pharmacy", message.voicePrompt);
            }

            // Handle the message
            sessionConversationRelay.incomingMessage(message);
        } catch (error) {
            console.error(`[Server] Error in websocket message handling:`, error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client ws disconnected');
        if (sessionConversationRelay) {
            sessionConversationRelay.cleanup();
        }
        // Close the Flex interaction if we have the necessary data
        if (sessionCustomerData?.flexInteraction?.sid && sessionCustomerData?.taskAttributes?.flexInteractionChannelSid) {
            flexService.closeInteraction(
                sessionCustomerData.flexInteraction.sid,
                sessionCustomerData.taskAttributes.flexInteractionChannelSid
            ).catch(error => {
                console.error('Error closing Flex interaction on ws close:', error);
            });
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (sessionConversationRelay) {
            sessionConversationRelay.cleanup();
        }
        // Close the Flex interaction if we have the necessary data
        if (sessionCustomerData?.flexInteraction?.sid && sessionCustomerData?.taskAttributes?.flexInteractionChannelSid) {
            flexService.closeInteraction(
                sessionCustomerData.flexInteraction.sid,
                sessionCustomerData.taskAttributes.flexInteractionChannelSid
            ).catch(error => {
                console.error('Error closing Flex interaction on ws error:', error);
            });
        }
    });
});

//
// API endpoints
//

// Endpoint to initiate an outbound call and hook up the Conversation Relay
/**
 * Initiates an outbound call to the customer and connects it to the Conversation Relay service.
 * @param {Object} req - The request object containing the customer data.
 *  - customerData: The customer data object containing the phone number and customer reference to be passed to the Conversation Relay service.
 * @returns {Object} - The response object containing the success status and call SID or error message.
 */
app.post('/outboundCall', async (req, res) => {

    try {
        const customerData = req.body.properties;
        // console.log(`Customer data: ${JSON.stringify(customerData)}`);
        // This customer data now needs to be stored locally in a map, referenced by the customerData.customerReference and then read when the ws connection is established
        customerDataMap.set(customerData.customerReference, { customerData });

        /**
          * Create the Flex Interaction and get the Conversation API SID. This is then used to add t    he participants to the conversation.
          * 
          * Participants are: 
          * 1) Flex Agent (v1 Listen only. v2 can participate)
          * 2) conversationRelay
          */
        console.log(`[Server] /outboundCall Setting up Flex Service and Creating new interaction in Flex`);
        // Create a new Flex Service
        const flexInteraction = await flexService.createInteraction(customerData);
        console.log(`[Server] createInteraction result: ${JSON.stringify(flexInteraction.interaction, null, 4)}`);

        // Now add this flexInteraction.interaction data to the customerDataMap for this customerData.customerReference
        customerDataMap.get(customerData.customerReference).flexInteraction = flexInteraction.interaction;

        // Set up Flex service event handlers for this ws, using the interaction SID as the hook for this ws.
        // TODO: It is not currently linked to the WS. It is linked to the interaction SID. This is a problem.
        flexService.on(`reservationAccepted.${flexInteraction.interaction.sid}`, async (reservation, taskAttributes) => {
            try {
                console.log(`[Server] /outboundCall event: for ${customerData.customerReference} Reservation accepted.`);

                // Add reservation and taskAttributes data to the customerDataMap for this customerData.customerReference
                customerDataMap.get(customerData.customerReference).reservation = reservation;
                customerDataMap.get(customerData.customerReference).taskAttributes = taskAttributes;

                // Add the logic to connect Conversation Relay and llmService to the Conversation SID of the reservation here
                console.log(`[Server] /outboundCall event: Reservation accepted complete.`);
            } catch (error) {
                console.error('[Server] Error handling reservation accepted event:', error);
            }
        });

        console.log(`[Server] /outboundCall ###################################################################################`);
        console.log('[Server] /outboundCall: Initiating outbound call');

        // Call the serverless code:
        const call = await fetch(`${TWILIO_FUNCTIONS_URL}/tools/call-out`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // 'Authorization': `Basic ${Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString('base64')}`,
            },
            body: JSON.stringify({
                to: customerData.phoneNumber,
                customerReference: customerData.customerReference,
                functionsServerUrl: `${TWILIO_FUNCTIONS_URL}`,
            }),
        });

        const callSid = await call.text();

        console.log(`[Server] /outboundCall: Call initiated for customer: ${customerData.customerReference} with call SID: ${callSid}`);

        res.json({ success: true, callSid });
    } catch (error) {
        console.error('Error initiating outbound call:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DIRECT TEST endpoint Create a new interaction in Flex and await the result in "/assignmentCallback" webhook configured in Flex
app.get('/createInteraction', async (req, res) => {

    const result = await flexService.createInteraction();

    if (result.interaction) {
        res.json({
            interaction: result.interaction,
            activities: result.activities
        });
    } else {
        res.status(500).json({ error: result.error });
    }
});

// An interaction assignment has been made and this is the callback to indicate the reservation has been made
app.post('/assignmentCallback', async (req, res) => {

    try {
        const jsonBody = JSON.parse(JSON.stringify(req.body));
        jsonBody.TaskAttributes = JSON.parse(jsonBody.TaskAttributes);
        jsonBody.WorkerAttributes = JSON.parse(jsonBody.WorkerAttributes);
        console.log('[Server] /assignmentCallback: Assignment callback received:', jsonBody);

        // Next steps are:
        // 1. Deliver task to Worker
        // 2. acknowledge the task has been accepted.
        // 3. Emit an event to the FlexService to handle the task acceptance
        flexService.acceptTask(req.body);

        res.json({ success: true });
    } catch (error) {
        console.error('Error in assignment callback:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/////////// EVENT HANDLERS //////////



////////// SERVER BASICS //////////

// Basic HTTP endpoint
app.get('/', (req, res) => {
    res.send('WebSocket Server Running');
});

// Start the server
try {
    // Fetch initial context and manifest before starting the server
    const server = app.listen(PORT, async () => {
        try {
            const result = await fetchContextAndManifest();
            baseContext = result.promptContext;
            baseManifest = result.toolManifest;
            console.log('[Server] Initial context and manifest loaded');
            console.log(`Server is running on port ${PORT}`);
        } catch (error) {
            console.error('Failed to load initial context and manifest:', error);
            process.exit(1);
        }
    });
} catch (error) {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    } else {
        console.error('Failed to start server:', error);
    }
    process.exit(1);
}

//
// Utility Functions
//

// Function to load context and manifest from local files
async function fetchContextAndManifest() {
    try {
        const promptContext = await fs.readFile(path.join(__dirname, 'assets', 'context.md'), 'utf8');
        const toolManifest = JSON.parse(await fs.readFile(path.join(__dirname, 'assets', 'toolManifest.json'), 'utf8'));
        console.log('[Server] Loaded context and manifest from local files');
        return { promptContext, toolManifest };
    } catch (error) {
        console.error('Error loading context or manifest:', error);
        throw error;
    }
}
