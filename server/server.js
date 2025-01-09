require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for context and manifest
let baseContext = null;
let baseManifest = null;

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

// Initialize express-ws
ExpressWs(app);

// For Twilio url encoded body
app.use(express.urlencoded({ extended: true }));

// Import the services
const { LlmService } = require('./services/LlmService');
const { FlexService } = require('./services/FlexService');
const { ConversationRelayService } = require('./services/ConversationRelayService');

// Connection manager to track active connections and their associated services
class ConnectionManager {
    constructor() {
        this.connections = new Map();
        this.flexService = new FlexService(); // Shared Flex service is okay as it's stateless
        this.connectionCounter = 0;
    }

    async createConnection(ws) {
        const connectionId = `conn_${Date.now()}_${++this.connectionCounter}`;
        const llmService = new LlmService(baseContext, baseManifest);
        const conversationRelay = new ConversationRelayService(llmService);

        const connection = {
            id: connectionId,
            ws,
            llmService,
            conversationRelay
        };

        this.connections.set(ws, connection);
        console.log(`Connection established - ID: ${connectionId}`);
        return connection;
    }

    getConnection(ws) {
        return this.connections.get(ws);
    }

    removeConnection(ws) {
        const connection = this.connections.get(ws);
        if (connection) {
            console.log(`Removing connection - ID: ${connection.id}`);
            connection.conversationRelay.cleanup();
            this.connections.delete(ws);
        }
    }

    /**
     * Reloads the LLM service context and manifest for this server instance.
     */
    async reloadAllLlmServices() {
        try {
            const result = await fetchContextAndManifest();
            baseContext = result.promptContext;
            baseManifest = result.toolManifest;
            console.log('[Server] Context and manifest reloaded');

        } catch (error) {
            console.error('Error reloading context and manifest:', error);
        }
    }
}

const connectionManager = new ConnectionManager();

//
// WebSocket endpoint
//
app.ws('/conversation-relay', (ws) => {
    let connection = null;

    // Handle incoming messages
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`[Server] Received message of type: ${message.type}`);

            // Initialize connection on setup message
            if (message.type === 'setup' && !connection) {
                connection = await connectionManager.createConnection(ws);
                console.log(`New Conversation Relay websocket established - ID: ${connection.id}`);

                // Set up silence event handler
                connection.conversationRelay.on('silence', (silenceMessage) => {
                    console.log(`[Server] Sending silence breaker message for connection ${connection.id}: ${JSON.stringify(silenceMessage)}`);
                    ws.send(JSON.stringify(silenceMessage));
                });

                // Now handle the setup message
                const response = await connection.conversationRelay.setup(message);
                if (response) {
                    ws.send(JSON.stringify(response));
                }
                return;
            }

            if (!connection) {
                console.error('Connection not initialized. Waiting for setup message.');
                return;
            }

            const response = await connection.conversationRelay.handleMessage(message);
            if (response) {
                ws.send(JSON.stringify(response));
            }
        } catch (error) {
            const errorMsg = connection ?
                `[Server] Error in websocket message handling for connection ${connection.id}:` :
                '[Server] Error in websocket message handling:';
            console.error(errorMsg, error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        if (connection) {
            console.log(`Client disconnected - ID: ${connection.id}`);
            connectionManager.removeConnection(ws);
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        if (connection) {
            console.error(`WebSocket error for connection ${connection.id}:`, error);
            connectionManager.removeConnection(ws);
        } else {
            console.error('WebSocket error before connection initialization:', error);
        }
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

// Endpoint to reload LLM service context and manifest
app.get('/reloadLlmService', async (req, res) => {
    try {
        console.log('Reloading LLM service context and manifest for all connections');
        await connectionManager.reloadAllLlmServices();
        res.json({ success: true, message: 'LLM services reloaded successfully for all connections' });
    } catch (error) {
        console.error('Error reloading LLM services:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a new interaction in Flex and await the result in "/assignmentCallback" webhook configured in Flex
app.get('/createInteraction', async (req, res) => {
    try {
        console.log('Creating interaction');
        const result = await connectionManager.flexService.createInteraction();
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
        connectionManager.flexService.acceptTask(req.body);

        // Now the next steps are to connect the Conversation Relay and LLM Service to the Conversation SID of the reservation

        res.json({ success: true });
    } catch (error) {
        console.error('Error in assignment callback:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/////////// EVENT HANDLERS //////////

// Set up Flex service event handlers
connectionManager.flexService.on('reservationAccepted', async (reservation) => {
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
