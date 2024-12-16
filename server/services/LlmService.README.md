# LlmService Documentation

LlmService is a Node.js service that integrates OpenAI's Chat Completion API with tool execution capabilities. It extends EventEmitter to manage conversation state and handle tool-based interactions.

```javascript
const { LlmService } = require('./services/LlmService');

const llmService = new LlmService(promptContext, toolManifest);
