# FlexService Documentation

FlexService is a Node.js service that manages Twilio Flex interactions, specifically handling chat-based interactions through Twilio's Flex API. It extends EventEmitter to provide event-based communication for interaction states.

## Core Functionality

The service provides the following key features:
- Creation of chat-based interactions in Twilio Flex
- Event emission for interaction states (creation and errors)
- Integration with Twilio TaskRouter for routing logic

## Environment Variables

The service requires the following environment variables:
```
ACCOUNT_SID=         # Your Twilio Account SID
AUTH_TOKEN=          # Your Twilio Auth Token
FLEX_INSTANCE_SID=   # Your Flex Instance SID
FLEX_WORKSPACE_SID=  # Your Flex Workspace SID
FLEX_WORKFLOW_SID=   # Your Flex Workflow SID
TASK_ROUTER_SID=     # Your TaskRouter SID
TASK_QUEUE_VA=       # Virtual Assistant Task Queue SID
TASK_QUEUE_HUMAN=    # Human Agent Task Queue SID
TASK_WORKFLOW_HUMAN= # Human Workflow SID
TASK_CHANNEL_CHAT=   # Chat Channel SID
WORKER_SID_VA=       # Virtual Assistant Worker SID
```

## Usage

```javascript
const { FlexService } = require('./services/FlexService');

// Initialize the service
const flexService = new FlexService();

// Create a new interaction
try {
    const interaction = await flexService.createInteraction();
    console.log('Interaction created:', interaction);
} catch (error) {
    console.error('Error creating interaction:', error);
}

// Listen for events
flexService.on('interactionCreated', (interaction) => {
    console.log('New interaction created:', interaction);
});

flexService.on('error', (error) => {
    console.error('FlexService error:', error);
});
```

## Flex Setup

[This section will contain instructions for setting up Twilio Flex, including:
- Creating a Flex instance
- Configuring TaskRouter workspaces
- Setting up workflows and queues
- Creating and configuring workers
- Establishing channels
- Setting up routing rules]

## Twilio Taskrouter NPM

[This section will contain information about the Twilio TaskRouter JavaScript SDK, including:
- Installation instructions
- Basic configuration
- Worker and task management
- Event handling
- Queue operations
- Workflow management
- Best practices and common patterns]

NPM found here: https://twilio.github.io/twilio-taskrouter.js/index.html
Installation: `npm install twilio-taskrouter`




## Events

The service emits the following events:
- `interactionCreated`: Emitted when a new interaction is successfully created
- `error`: Emitted when an error occurs during any operation

## Error Handling

The service implements comprehensive error handling:
- All API calls are wrapped in try-catch blocks
- Errors are both logged and emitted through the EventEmitter
- Detailed error information is preserved and passed to error handlers
