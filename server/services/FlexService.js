const EventEmitter = require('events');
const twilio = require('twilio');
const TaskRouter = require("twilio-taskrouter");
const AccessToken = twilio.jwt.AccessToken;
const TaskRouterGrant = AccessToken.TaskRouterGrant;

// Extract environment variables
const {
    ACCOUNT_SID,
    AUTH_TOKEN,
    FLEX_INSTANCE_SID,
    FLEX_WORKSPACE_SID,
    FLEX_WORKFLOW_SID,
    TASK_ROUTER_SID,
    TASK_QUEUE_VA,
    TASK_QUEUE_HUMAN,
    TASK_WORKFLOW_HUMAN,
    TASK_CHANNEL_CHAT,
    WORKER_SID_VA,
    SIGNING_KEY_SID,
    SIGNING_KEY_SECRET
} = process.env;

class FlexService extends EventEmitter {
    constructor() {
        super();
        this.client = twilio(ACCOUNT_SID, AUTH_TOKEN);
        this.activities = [];
        this.available = null;
        // Initialize activities
        this.getWorkerActivities().catch(error => {
            console.error('[FlexService] Error initializing activities:', error);
        });
    }

    /**
     * Get the list of activities for the workspace
     * TODO: Incorporate various values
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
                console.log('[FlexService] Set Available activity SID:', this.available);
            } else {
                console.error('[FlexService] Could not find Available activity');
            }

            //console.log('[FlexService] Activities:', this.activities);
        } catch (error) {
            console.error('[FlexService] Error in getWorkerActivities:', error);
            throw error;
        }
    }

    /**
     *  This creates a new interaction for the AI worker. It will call the AssignmentCallbackURL, which is configured in Flex Task Assignment Workflows.
     * The basic lifecycle of a [successful] TaskRouter Task is as follows:
     *      Task Created (via Interaction) → eligible Worker becomes available → Worker reserved → Reservation accepted → Task assigned to Worker.
     */
    async createInteraction(channelProperties = {}, routing = {}) {
        try {
            console.log('[FlexService] workspaceSid:', FLEX_WORKSPACE_SID);

            const interaction = await this.client.flexApi.v1.interaction.create({
                channel: {
                    // sid: THE_INTERACTIONS_CHANNEL_SID, // If not available, the 
                    type: 'chat',
                    initiated_by: 'api'
                },
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

            console.log(`[FlexService] Created interaction with SID: ${interaction}`);
            // this.emit('interactionCreated', interaction);
            return {
                interaction,
                activities: this.activities
            };
        } catch (error) {
            console.error('[FlexService] Error in createInteraction:', error);
            this.emit('createInteractionError', error);
            throw error;
        }
    }

    // Accept the task for this worker
    async acceptTask(assignment) {
        console.log(`[FlexService] Accepting task for assignment: ${JSON.stringify(assignment)}`);
        // Before the task can be accepted, make sure the agent is available. If not make available and accept tasks
        const worker = await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).fetch();
        // Check the worker's activity
        const workerActivity = await worker.activitySid;
        if (workerActivity !== this.available) {
            console.log(`[FlexService] Worker ${worker.sid} is not available. Changing status to Available`);
            await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).update({ activitySid: this.available });
        }
        try {
            const reservation = await this.client.taskrouter.v1
                .workspaces(assignment.WorkspaceSid)
                .tasks(assignment.TaskSid)
                .reservations(assignment.ReservationSid)
                .update({ reservationStatus: "accepted" });

            console.log(reservation.reservationStatus);

        } catch (error) {
            console.error('[FlexService] Error in acceptTask:', error);
            throw error;
        }
    }

    /**
     * 
     * Add PArticipants to the Conversation. Pass in the PArticipants to add to the conversation
     */
    async setUpConversation(participants = []) {
        // Create a conversation
        const conversation = await this.client.conversations.conversations.create({
            friendlyName: 'My First Conversation',
            attributes: JSON.stringify({ conversationType: 'chat' })
        });
        console.log(`[FlexService] Created conversation with SID: ${conversation.sid}`);
        return conversation;
    }
}

module.exports = { FlexService };
