# Conversation Relay Flex Dialler

This project consists of a few components:
- A nodeJS server for handling API endpoints and conversation relay WebSocket server.
- LLM Service for AI conversation handling.
- Flex Conversations for handling the conversation in Flex
- Twilio Serverless Functions for customer verification and tools

## Prerequisites

- Node.js v18
- pnpm
- ngrok
- Twilio CLI with Serverless plugin

## Project Structure

```
.
├── server/          # WebSocket server for conversation relay
|   ├── services    # Various servicess used
│   └── .env        # Server environment variables
└── serverless/       # Twilio Serverless Functions
    ├── .env        # Twilio credentials and phone numbers
    ├── assets/
    │   ├── context.md           # GPT conversation context
    │   └── toolManifest.json    # Available tools configuration
    └── functions/
        └── tools/               # Tool implementations
```

## Server Component

The server handles WebSocket connections and manages conversation relay functionality. It includes GPT service integration and communicates with Twilio Functions.

### Running the Server

1. Navigate to the server directory:
```bash
cd server
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm dev
```

4. Expose the server using ngrok:
```bash
ngrok http --domain server-yourdomain.ngrok.dev 3001
```

## Silence Handling

The system includes a robust silence detection mechanism to manage periods of inactivity during conversations. This functionality is implemented in the `SilenceHandler` class and operates based on two key thresholds:

- `SILENCE_SECONDS_THRESHOLD` (5 seconds): The duration of silence before triggering a reminder
- `SILENCE_RETRY_THRESHOLD` (3 attempts): Maximum number of reminders before ending the call

### How It Works

1. **Initialization**: Silence monitoring starts after the initial setup message, ensuring the system is ready for conversation.

2. **Message Tracking**:
   - The system tracks the time since the last meaningful message
   - Info-type messages are intentionally ignored to prevent false resets
   - Valid messages (prompt, interrupt, dtmf) reset both the timer and retry counter

3. **Response Sequence**:
   - After 5 seconds of silence: Sends a reminder message ("I'm sorry, I didn't catch that...")
   - Each reminder increments a retry counter
   - After 3 unsuccessful attempts: Ends the call with an "unresponsive" reason code

4. **Cleanup**: The system properly cleans up monitoring resources when the call ends or disconnects.

### Implementation Details

The silence handling is modular and follows separation of concerns:
- `SilenceHandler` class manages the logic independently
- Messages are passed back to the server via callbacks
- The server maintains control of WebSocket communication
- Thresholds are configurable through constants in server.js

This design ensures reliable conversation flow while preventing indefinite silence periods, improving the overall user experience.

## Twilio Functions Component

The serverless component contains Twilio Serverless Functions for customer verification and various tools.

### Running the Functions

1. Navigate to the serverless directory:
```bash
cd serverless
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the Twilio Serverless development environment:
```bash
twilio serverless:start
```

4. Expose the serverless using ngrok:
```bash
ngrok http --domain serverless-yourdomain.ngrok.dev 3000
```

## Twilio Configuration

### TwiML Bin Setup

1. Create a new TwiML Bin in your Twilio console
2. Add the following TwiML code:
```xml
<Response>
   <Connect>
      <ConversationRelay 
         url="wss://server-yourdomain.ngrok.dev/conversation-relay" 
         voice="en-AU-Neural2-A" 
         dtmfDetection="true" 
         interruptByDtmf="true" 
         debug="true"
      />
   </Connect>
</Response>
```
3. Configure your Twilio phone number to use this TwiML Bin for incoming voice calls

### WebSocket Connection Flow

1. When a call is received, Twilio initiates a WebSocket connection to `wss://server-yourdomain.ngrok.dev/conversation-relay`
2. The server receives a 'setup' message containing call details:
   - Caller's phone number (`from`)
   - Called number (`to`)
   - Call SID
   - Other call metadata

3. The server then:
   - Stores the call parameters for the session
   - Makes a request to the `get-customer` function with the caller's phone number
   - Receives customer details (including first name)
   - Uses this information to generate a personalized greeting
   - Initiates the verification process

4. The `get-customer` function:
   - Receives the caller's phone number
   - Looks up customer information
   - Returns customer details for personalization
   - Enables the conversation to proceed with verified customer context

### Important Note on WebSocket Implementation

⚠️ **Warning**: When implementing async/await with WebSocket connections, be careful about where you place your await statements. Do not use await in the main WebSocket connection handler (app.ws part). Instead, ensure all async operations are handled within the message event handler (ws.on("message")). This is crucial because:

1. WebSocket connections are synchronous by nature
2. Using await in the main connection handler could cause you to miss messages
3. Example of correct implementation:

```javascript
// INCORRECT - Don't do this
app.ws('/conversation-relay', async (ws, req) => {
    await someAsyncOperation(); // This could cause missed messages
    ws.on('message', (msg) => {
        // Handle message
    });
});

// CORRECT - Do this instead
app.ws('/conversation-relay', (ws, req) => {
    ws.on('message', async (msg) => {
        await someAsyncOperation(); // Safe to use await here
        // Handle message
    });
});
```

## GPT Context Configuration

The server uses two key files to configure the GPT conversation context:

### context.md

Located in `serverless/assets/context.md`, this file defines:
- The AI assistant's persona (Joules, an energy company phone operator)
- Conversation style guidelines
- Response formatting rules
- Authentication process steps
- Customer validation requirements

Key sections to configure:
1. Objective - Define the AI's role and primary tasks
2. Style Guardrails - Set conversation tone and behavior rules
3. Response Guidelines - Specify formatting and delivery rules
4. Instructions - Detail specific process steps
5. Validation - Define the customer verification workflow

### toolManifest.json

Located in `serverless/assets/toolManifest.json`, this file defines the available tools for the GPT service:

1. `get-customer`
   - Retrieves customer details using caller's phone number
   - Required parameter: `from` (phone number)

2. `verify-code`
   - Verifies provided authentication code
   - Required parameters: `code` and `from`

3. `verify-send`
   - Sends verification code via SMS
   - Required parameter: `from`

4. `live-agent-handoff`
   - Transfers call to human agent
   - Required parameter: `callSid`

The server fetches both files during initialization to hydrate the GPT context and enable tool usage during conversations.

## Environment Configuration

The project requires two separate environment configuration files:

### Functions Environment Variables (serverless/.env)

Create a `.env` file in the serverless directory with the following variables:

```bash
# Twilio Account Credentials
ACCOUNT_SID=your_twilio_account_sid
AUTH_TOKEN=your_twilio_auth_token

# Phone Numbers Configuration
SMS_FROM_NUMBER=your_twilio_sms_number    # Number used to send verification codes
CALL_FROM_NUMBER=your_twilio_call_number  # Number used for outbound calls
```

These variables are used by the Twilio Functions for:
- Authentication with Twilio's API
- Sending SMS verification codes
- Making outbound calls

### Server Environment Variables (server/.env)

Create a `.env` file in the server directory with the following variables:

```bash
PORT=3001                                    # Server port number
TWILIO_FUNCTIONS_URL=your_functions_url      # URL to your deployed Twilio Functions
OPENAI_API_KEY=your_openai_api_key          # OpenAI API key for GPT integration
```

These variables are used by the server for:
- Configuring the server port
- Connecting to Twilio Functions
- Authenticating with OpenAI's API

## Dependencies

### Server Dependencies
- express
- express-ws
- openai
- dotenv

### Functions Dependencies
- twilio
- @twilio/runtime-handler
