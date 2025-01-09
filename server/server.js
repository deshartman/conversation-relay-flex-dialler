require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
ExpressWs(app);     // Initialize express-ws
app.use(express.urlencoded({ extended: true }));    // For Twilio url encoded body

// Global variables for context and manifest
let baseContext = null;
let baseManifest = null;

// Import the services
const { LlmService } = require('./services/LlmService');
const { FlexService } = require('./services/FlexService');
const { ConversationRelayService } = require('./services/ConversationRelayService');

const flexService = new FlexService(); // Shared Flex service is okay as it's stateless



/** 
 * WebSocket endpoint for the Conversation Relay.
 * 
 * NOTE: Each time a new websocket is established, a new Conversation Relay is created and maintained as part of the websocket object. Websocket keeps track of which session it is and reloads the relevant Conversation Relay and LLM Service.
 * 
*/
app.ws('/conversation-relay', (ws) => {
    // let connection = null;
    let llmService = null;
    let conversationRelay = null;

    // Handle incoming messages
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`[Server] Received message of type: ${message.type}`);

            // Initialize connection on setup message and strap in the Conversation Relay and associated LLM Service
            if (message.type === 'setup') {
                // Create new ws scoped llmService and conversationRelay
                llmService = new LlmService(baseContext, baseManifest);
                conversationRelay = new ConversationRelayService(llmService);

                // Set up silence event handler from Conversation Relay
                conversationRelay.on('silence', (silenceMessage) => {
                    console.log(`[Server] Sending silence breaker message : ${JSON.stringify(silenceMessage)}`);
                    ws.send(JSON.stringify(silenceMessage));
                });

                // Now handle the setup message
                const response = await conversationRelay.setup(message);
                if (response) {
                    ws.send(JSON.stringify(response));
                }
                return;
            }

            const response = await conversationRelay.handleMessage(message);
            if (response) {
                ws.send(JSON.stringify(response));
            }
        } catch (error) {
            console.error(`[Server] Error in websocket message handling:`, error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client ws disconnected: `);
        conversationRelay.cleanup();
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error`, error);
        conversationRelay.cleanup();
    });
});

//
// API endpoints
//

// Endpoint to initiate an outbound call and hook up the Conversation Relay
app.post('/outboundCall', async (req, res) => {
    try {
        console.log('Initiating outbound call');
        const { to, from, url, data } = req.body;

        // Call the serverless code:
        const call = await fetch(`${TWILIO_FUNCTIONS_URL}/call-out`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                to, from, url, data
            }),
        });

        const callData = await call.json();
        const callSid = callData.sid;

        res.json({ success: true, callSid });
    } catch (error) {
        console.error('Error initiating outbound call:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a new interaction in Flex and await the result in "/assignmentCallback" webhook configured in Flex
app.get('/createInteraction', async (req, res) => {
    try {
        console.log('Creating interaction');
        const result = await flexService.createInteraction();
        console.log(`Interaction created with SID: ${JSON.stringify(result.interaction, null, 4)}`);
        console.log(`Worker activities: ${JSON.stringify(result.activities, null, 4)}`);
        res.json({
            success: true,
            interaction: result.interaction,
            activities: result.activities
        });
    } catch (error) {
        console.error('Error creating interaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// An interaction assignment has been made and this is the callback to indicate the reservation has been made
app.post('/assignmentCallback', async (req, res) => {
    try {
        const jsonBody = JSON.parse(JSON.stringify(req.body));
        jsonBody.TaskAttributes = JSON.parse(jsonBody.TaskAttributes);
        jsonBody.WorkerAttributes = JSON.parse(jsonBody.WorkerAttributes);
        console.log('Assignment callback received:', jsonBody);

        // Next steps are:
        // 1. Deliver task to Worker
        // 2. acknowledge the task has been accepted.
        flexService.acceptTask(req.body);

        // Now the next steps are to connect the Conversation Relay and LLM Service to the Conversation SID of the reservation

        res.json({ success: true });
    } catch (error) {
        console.error('Error in assignment callback:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/////////// EVENT HANDLERS //////////

// Set up Flex service event handlers
flexService.on('reservationAccepted', async (reservation) => {
    try {
        console.log(`[Server] Handling accepted reservation: ${reservation.sid}`);

        // Extract task attributes
        const taskAttributes = reservation.task.attributes;
        console.log(`[Server] Task attributes: ${JSON.stringify(taskAttributes, null, 2)}`);

        // Add the logic to connect Conversation Relay and llmService to the Conversation SID of the reservation here

    } catch (error) {
        console.error('[Server] Error handling reservation accepted event:', error);
    }
});

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
