/**
 * @class FlexService
 * @extends EventEmitter
 * @description Manages Twilio Flex interactions, task routing, and conversation flows.
 * This service provides a comprehensive interface for:
 * 
 * 1. Task Router Management:
 *    - Worker activity status tracking and updates
 *    - Task creation, acceptance, and completion
 *    - Reservation handling for task assignments
 * 
 * 2. Flex Interactions:
 *    - Creates and manages chat-based interactions
 *    - Handles participant management
 *    - Controls interaction lifecycle (creation to closure)
 * 
 * 3. Conversation Management:
 *    - Creates and configures conversation channels
 *    - Manages message creation and delivery
 *    - Handles participant additions and updates
 * 
 * The service uses Twilio's APIs (Flex API, TaskRouter, Conversations) to orchestrate
 * communication flows between customers and agents (both AI and human).
 * 
 * @property {twilio} client - Twilio client instance for API interactions
 * @property {Array<Object>} activities - List of available worker activities
 * @property {string|null} available - SID of the 'Available' activity status
 * 
 * Environment Configuration Required:
 * - ACCOUNT_SID: Twilio account identifier
 * - AUTH_TOKEN: Twilio authentication token
 * - FLEX_WORKSPACE_SID: TaskRouter workspace identifier
 * - FLEX_WORKFLOW_SID: TaskRouter workflow identifier
 * - TASK_QUEUE_VA: Virtual agent task queue SID
 * - WORKER_SID_VA: Virtual agent worker identifier
 * 
 * @example
 * // Initialize the Flex service
 * const flexService = new FlexService();
 * 
 * // Create a new interaction
 * const customerData = {
 *   customerReference: 'customer123'
 * };
 * const { interaction } = await flexService.createInteraction(customerData);
 * 
 * // Listen for reservation acceptance
 * flexService.on('reservationAccepted.${interactionSid}', (reservation, attributes) => {
 *   console.log('Task accepted:', attributes.conversationSid);
 * });
 * 
 * // Close an interaction
 * await flexService.closeInteraction(interactionSid, channelSid, taskSid);
 */

const EventEmitter = require('events');
const twilio = require('twilio');
const TaskRouter = require("twilio-taskrouter");
const AccessToken = twilio.jwt.AccessToken;
const TaskRouterGrant = AccessToken.TaskRouterGrant;
const { logOut, logError } = require('../utils/logger');

// Extract environment variables
const {
    ACCOUNT_SID,
    AUTH_TOKEN,
    FLEX_WORKSPACE_SID,
    FLEX_WORKFLOW_SID,
    TASK_QUEUE_VA,
    WORKER_SID_VA
} = process.env;

class FlexService extends EventEmitter {
    constructor() {
        super();
        this.client = twilio(ACCOUNT_SID, AUTH_TOKEN);
        this.activities = [];
        this.available = null;
        // Initialize activities
        logOut('FlexService:', `Calling getWorkerActivities`);
        this.getWorkerActivities().catch(error => {
            logError('FlexService', `Error initializing activities: ${error}`);
        });
    }

    /**
     * Retrieves and initializes worker activities for the Flex workspace.
     * This method:
     * 1. Fetches all available activities from the TaskRouter workspace
     * 2. Identifies and stores the 'Available' activity SID
     * 3. Sets up the initial state for worker availability tracking
     * 
     * @async
     * @returns {Promise<void>} Resolves when activities are initialized
     * @throws {Error} If activities cannot be fetched or 'Available' status not found
     */
    async getWorkerActivities() {
        try {
            this.activities = await this.client.taskrouter.v1
                .workspaces(FLEX_WORKSPACE_SID)
                .activities.list();

            // Find and set the Available activity SID
            const availableActivity = this.activities.find(activity => activity.friendlyName === 'Available');
            if (availableActivity) {
                this.available = availableActivity.sid;
                logOut('FlexService: getWorkerActivities', `Set Available activity SID: ${this.available}`);
            } else {
                logError('FlexService: getWorkerActivities', 'Could not find Available activity');
            }
        } catch (error) {
            logError('FlexService: getWorkerActivities', `Error in getWorkerActivities: ${error}`);
            throw error;
        }
    }

    /**
     * Creates a new Flex interaction for the AI worker.
     * Implements the TaskRouter Task lifecycle:
     * 1. Creates interaction with chat channel
     * 2. Sets up routing properties for task assignment
     * 3. Configures worker and queue assignments
     * 
     * The task follows this lifecycle:
     * Task Creation → Worker Availability → Reservation → Acceptance → Assignment
     * 
     * @async
     * @param {Object} customerData - Customer information
     * @param {string} customerData.customerReference - Unique customer identifier
     * @returns {Promise<Object>} Object containing:
     *   - interaction: Created Flex interaction details
     *   - activities: Available worker activities
     * @throws {Error} If interaction creation fails
     */
    async createInteraction(customerData) {
        try {
            logOut('FlexService', `workspaceSid: ${FLEX_WORKSPACE_SID}`);
            logOut('FlexService', `Setting parameters: ${customerData.customerReference}`);

            const interaction = await this.client.flexApi.v1.interaction.create(
                {
                    // The Channel attributes are used to either create or to bind to an underlying media channel such as a Conversation. 
                    channel: {
                        type: 'chat',
                        initiated_by: 'api',
                        participants: [
                            {
                                identity: customerData.customerReference
                            }
                        ]

                    },
                    // The Routing attributes are used to create a task which is then routed according to your specified workspace and workflow.
                    routing: {
                        properties: {
                            task_channel_unique_name: "chat",
                            workspace_sid: FLEX_WORKSPACE_SID,
                            workflow_sid: FLEX_WORKFLOW_SID,
                            queue_sid: TASK_QUEUE_VA,
                            worker_sid: WORKER_SID_VA,
                        },
                    }
                });

            logOut('FlexService', `Created interaction with SID: ${interaction.sid}`);
            return {
                interaction,
                activities: this.activities
            };
        } catch (error) {
            logError('Flex', `Error in createInteraction: ${error}`);
            return {
                interaction: null,
                activities: null
            };
        }
    }

    /**
     * Accepts a task assignment for a worker.
     * Process:
     * 1. Verifies worker availability status
     * 2. Updates worker to 'Available' if needed
     * 3. Accepts the task reservation
     * 4. Emits reservation acceptance event
     * 
     * @async
     * @param {Object} assignment - Task assignment details
     * @param {string} assignment.WorkspaceSid - Workspace identifier
     * @param {string} assignment.WorkerSid - Worker identifier
     * @param {string} assignment.TaskSid - Task identifier
     * @param {string} assignment.ReservationSid - Reservation identifier
     * @param {string} assignment.TaskAttributes - JSON string of task attributes
     * @returns {Promise<void>} Resolves when task is accepted
     * @throws {Error} If task acceptance fails
     * @emits reservationAccepted.${flexInteractionSid}
     */
    async acceptTask(assignment) {
        // Before the task can be accepted, make sure the agent is available. If not make available and accept tasks
        const worker = await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).fetch();

        // Check the worker's activity
        const workerActivity = await worker.activitySid;
        if (workerActivity !== this.available) {
            logOut('FlexService: acceptTask', `Worker ${worker.sid} is not available. Changing status to Available`);
            await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).update({ activitySid: this.available });
        }

        try {
            const reservation = await this.client.taskrouter.v1
                .workspaces(assignment.WorkspaceSid)
                .tasks(assignment.TaskSid)
                .reservations(assignment.ReservationSid)
                .update({ reservationStatus: "accepted" });
            // logOut('FlexService: Reservation:', `reservations details ${JSON.stringify(reservation, null, 4)}`);

            const taskAttributes = JSON.parse(assignment.TaskAttributes);
            logOut('FlexService', `Task accepted for assignment: ${JSON.stringify(taskAttributes.conversationSid, null, 4)}`);

            // Emit the Task Accepted event with the task attributes
            logOut('FlexService', `Emitting [[reservationAccepted.${taskAttributes.flexInteractionSid}]]`);
            // TODO: Should I just return the entire reservation?
            this.emit(`reservationAccepted.${taskAttributes.flexInteractionSid}`, reservation, taskAttributes);

        } catch (error) {
            logError('FlexService', `Error in acceptTask: ${error}`);
            throw error;
        }
    }

    /**
     * Closes an active Flex interaction and its associated resources.
     * Steps:
     * 1. Updates interaction status to 'closed'
     * 2. Updates routing status to 'closed'
     * 3. Attempts cleanup of associated task
     * 
     * @async
     * @param {string} interactionSid - Interaction identifier
     * @param {string} channelSid - Channel identifier
     * @param {string} taskSid - Task identifier
     * @returns {Promise<void>} Resolves when interaction is closed
     * @throws {Error} If interaction closure fails
     */
    async closeInteraction(interactionSid, channelSid, taskSid) {
        try {
            const interaction = await this.client.flexApi.v1
                .interaction(interactionSid)
                .channels(channelSid)
                .update({
                    status: 'closed',
                    routing: { status: 'closed' }
                });
            // logOut('FlexService', `Closed interaction: ${JSON.stringify(interaction, null, 4)}`);

            // Now delete the task
            // https://taskrouter.twilio.com/v1/Workspaces/{WSaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}/Tasks/{taskSid}
            // const task = await this.client.taskrouter.v1
            //     .workspaces(FLEX_WORKSPACE_SID)
            //     .tasks(taskSid)
            //     .remove();  // This is a DELETE request, but not working

        } catch (error) {
            logError('Flex', `Error in closeInteraction: ${error}`);
            throw error;
        }
    }

    /**
     * Creates and configures a new conversation channel.
     * Initializes a conversation with:
     * - Friendly name for identification
     * - Chat-type conversation attributes
     * - Support for multiple participants
     * 
     * @async
     * @param {Array} [participants=[]] - Array of participants to add
     * @returns {Promise<Object>} Created conversation object
     * @throws {Error} If conversation creation fails
     */
    async setUpConversation(participants = []) {
        // Create a conversation
        const conversation = await this.client.conversations.v1.conversations.create({
            friendlyName: 'My First Conversation',
            attributes: JSON.stringify({ conversationType: 'chat' })
        });
        logOut('FlexService', `Created conversation with SID: ${conversation.sid}`);
        return conversation;
    }

    /**
     * Creates a message within a conversation.
     * Handles message creation with:
     * - Author attribution
     * - Message body content
     * - Proper conversation threading
     * 
     * @async
     * @param {string} conversationSid - Conversation identifier
     * @param {string} author - Message author identifier
     * @param {string} message - Message content
     * @returns {Promise<Object>} Created message object
     * @throws {Error} If message creation fails
     */
    async createConversationMessage(conversationSid, author, message) {
        logOut('FlexService', `Creating Conversation message: ${author} - ${message}`);

        const messageResponse = await this.client.conversations.v1
            .conversations(conversationSid)
            .messages.create({
                author: author,
                body: message,
            });
        logOut('FlexService', `Created message with SID: ${messageResponse.sid}`);
        return messageResponse;
    }

    /**
     * Retrieves channel information for a specific interaction.
     * 
     * @async
     * @param {Object} sessionCustomerData - Session and customer information
     * @param {Object} sessionCustomerData.flexInteraction - Flex interaction details
     * @param {Object} sessionCustomerData.taskAttributes - Task attribute details
     * @returns {Promise<Object>} Channel information
     * @throws {Error} If channel retrieval fails
     */
    async getChannel(sessionCustomerData) {
        try {
            const interactionSid = sessionCustomerData.flexInteraction.sid;
            const channelSid = sessionCustomerData.taskAttributes.flexInteractionChannelSid;

            const channel = await this.client.flexApi.v1
                .interaction(interactionSid)
                .channels(channelSid)
                .fetch();

            logOut('FlexService', `Interaction Channel: ${JSON.stringify(channel, null, 4)}`);
            return channel;
        } catch (error) {
            logError('FlexService', `Error in getChannel: ${error}`);
            throw error;
        }
    }

    /**
     * Retrieves participant information for an interaction channel.
     * 
     * @async
     * @param {Object} sessionCustomerData - Session and customer information
     * @param {Object} sessionCustomerData.flexInteraction - Flex interaction details
     * @param {Object} sessionCustomerData.taskAttributes - Task attribute details
     * @returns {Promise<Array>} List of channel participants
     * @throws {Error} If participant retrieval fails
     */
    async getParticipants(sessionCustomerData) {
        const interactionSid = sessionCustomerData.flexInteraction.sid;
        const channelSid = sessionCustomerData.taskAttributes.flexInteractionChannelSid;

        const participants = await this.client.flexApi.v1
            .interaction(interactionSid)
            .channels(channelSid)
            .participants.list();

        logOut('FlexService', `Interaction Participants: ${JSON.stringify(participants, null, 4)}`);
        return participants;
    }
}

module.exports = { FlexService };
