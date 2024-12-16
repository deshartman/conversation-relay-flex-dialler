require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');

const app = express();
const PORT = process.env.PORT || 3000;
const SILENCE_SECONDS_THRESHOLD = 5;
const SILENCE_RETRY_THRESHOLD = 3;
const { TWILIO_FUNCTIONS_URL } = process.env;

// Initialize express-ws
ExpressWs(app);

// For Twilio url encoded body
app.use(express.urlencoded({ extended: true }));

// Import the services
const { LlmService } = require('./services/LlmService');
const { FlexService } = require('./services/FlexService');
const { ConversationRelayService } = require('./services/ConversationRelayService');

// Initialize services at the top level
let llmService = null;
const flexService = new FlexService();
let conversationRelayService = null;

// Initialize services
async function initializeServices() {
    try {
        llmService = await LlmService.initialize();
        console.log('LlmService initialized successfully');
        conversationRelayService = new ConversationRelayService(llmService);
        return true;
    } catch (error) {
        console.error('Error initializing services:', error);
        throw error;
    }
}

//
// API endpoints
//

// WebSocket endpoint
app.ws('/conversation-relay', (ws) => {
    if (!conversationRelayService) {
        ws.close(1011, 'Service not initialized');
        return;
    }

    console.log('New Conversation Relay websocket established');

    // Handle incoming messages
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            const response = await conversationRelayService.handleMessage(message, (silenceMessage) => {
                console.log(`[Conversation Relay] Sending silence breaker message: ${JSON.stringify(silenceMessage)}`);
                ws.send(JSON.stringify(silenceMessage));
            });

            if (response) {
                ws.send(JSON.stringify(response));
            }
        } catch (error) {
            console.error('[Conversation Relay] Error in websocket message handling:', error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client disconnected');
        conversationRelayService.cleanup();
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Endpoint to reload LLM service context and manifest
app.post('/reloadLlmService', async (req, res) => {
    try {
        console.log('Reloading LLM service context and manifest');
        llmService = await LlmService.initialize();
        // Reinitialize ConversationRelayService with new llmService
        conversationRelayService = new ConversationRelayService(llmService);
        res.json({ success: true, message: 'LLM service reloaded successfully' });
    } catch (error) {
        console.error('Error reloading LLM service:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a new interaction in Flex and await the result in "/assignmentCallback" webhook configured in Flex
app.get('/createInteraction', async (req, res) => {
    try {
        console.log('Creating interaction');
        const interaction = await flexService.createInteraction();
        console.log(`Interaction created with SID: ${JSON.stringify(interaction,null,4)}`);
        res.json({ success: true, interactionSid: interaction.sid });
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
const server = app.listen(PORT, async () => {
    try {
        await initializeServices();
        console.log(`Server is running on port ${PORT}`);
    } catch (error) {
        console.error('Failed to initialize services:', error);
        process.exit(1);
    }
}).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    } else {
        console.error('Failed to start server:', error);
    }
    process.exit(1);
});
