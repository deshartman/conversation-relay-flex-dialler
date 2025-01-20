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
    async createInteraction(customerData) {
        try {
            console.log('[FlexService] workspaceSid:', FLEX_WORKSPACE_SID);
            console.log(`[FlexService] Setting parameters: ${customerData.customerReference}`);

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

            console.log(`[FlexService] Created interaction with SID: ${interaction.sid}`);
            return {
                interaction,
                activities: this.activities
            };
        } catch (error) {
            console.error('[FlexService] Error in createInteraction:', error);
            return {
                interaction: null,
                activities: null
            };

        }
    }

    // Accept the task for this worker
    async acceptTask(assignment) {
        try {
            // console.log(`[FlexService] Accepting task for assignment: ${JSON.stringify(assignment, null, 4)}`);
            // Before the task can be accepted, make sure the agent is available. If not make available and accept tasks
            const worker = await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).fetch();

            // Check the worker's activity
            const workerActivity = await worker.activitySid;
            if (workerActivity !== this.available) {
                console.log(`[FlexService] Worker ${worker.sid} is not available. Changing status to Available`);
                await this.client.taskrouter.v1.workspaces(assignment.WorkspaceSid).workers(assignment.WorkerSid).update({ activitySid: this.available });
            }


            const reservation = await this.client.taskrouter.v1
                .workspaces(assignment.WorkspaceSid)
                .tasks(assignment.TaskSid)
                .reservations(assignment.ReservationSid)
                .update({ reservationStatus: "accepted" });
            console.log(`[FlexService] Reservation: ${JSON.stringify(reservation, null, 4)}`);
            // console.log(`[FlexService] reservation.reservationStatus: ${reservation.reservationStatus}`);

            const taskAttributes
                = JSON.parse(assignment.TaskAttributes);
            console.log(`[FlexService] Task accepted for assignment: ${JSON.stringify(taskAttributes, null, 4)}`);

            const participants = await this.client.flexApi.v1
                .interaction(taskAttributes.flexInteractionSid)
                .channels(taskAttributes.flexInteractionChannelSid)
                .participants.list();
            console.log(`[FlexService] Accepted task Participants: ${JSON.stringify(participants, null, 4)}`);


            // Emit the Task Accepted event with the task attributes
            console.log(`[FlexService] Emitting [[reservationAccepted.${taskAttributes.flexInteractionSid}]]`);
            // TODO: Should I just return the entire reservation?
            this.emit(`reservationAccepted.${taskAttributes.flexInteractionSid}`, reservation, taskAttributes);

        } catch (error) {
            console.error('[FlexService] Error in acceptTask:', error);
        }
    }

    // Close the interaction
    async closeInteraction(interactionSid, channelSid) {
        try {
            const interaction = await this.client.flexApi.v1
                .interaction(interactionSid)
                .channels(channelSid)
                .update({
                    status: 'closed',
                    // routing: 'closed'    // TODO: What is the parameter?
                });
            console.log(`[FlexService] Closed interaction: ${JSON.stringify(interaction, null, 4)}`);
        } catch (error) {
            console.error('[FlexService] Error in closeInteraction:', error);
            throw error;
        }
    }

    /**
     * 
     * Add Participants to the Conversation. Pass in the Participants to add to the conversation
     */
    async setUpConversation(participants = []) {
        // Create a conversation
        const conversation = await this.client.conversations.v1.conversations.create({
            friendlyName: 'My First Conversation',
            attributes: JSON.stringify({ conversationType: 'chat' })
        });
        console.log(`[FlexService] Created conversation with SID: ${conversation.sid}`);
        return conversation;
    }

    async createConversationMessage(conversationSid, author, message) {
        console.log(`[FlexService] Creating Conversation message: ${author} - ${message}`);


        try {
            const messageResponse = await this.client.conversations.v1
                .conversations(conversationSid)
                .messages.create({
                    author: author,
                    body: message,
                });
            console.log(`[FlexService] Created message with SID: ${messageResponse.sid}`);
            return messageResponse;
        } catch (error) {
            console.error('[FlexService] Error in createConversationMessage:', error);
            return null;
        }
    }

    /** */

    // TEMP
    async getChannel(sessionCustomerData) {
        try {
            const interactionSid = sessionCustomerData.flexInteraction.sid;
            const channelSid = sessionCustomerData.taskAttributes.flexInteractionChannelSid;

            const channel = await this.client.flexApi.v1
                .interaction(interactionSid)
                .channels(channelSid)
                .fetch();

            console.log(`[Server] Interaction Channel: ${JSON.stringify(channel, null, 4)}`);
            return channel;
        } catch (error) {
            console.error('[FlexService] Error in getChannel:', error);
            return null;
        }
    }


    async getParticipants(sessionCustomerData) {
        try {
            const interactionSid = sessionCustomerData.flexInteraction.sid;
            const channelSid = sessionCustomerData.taskAttributes.flexInteractionChannelSid;

            const participants = await this.client.flexApi.v1
                .interaction(interactionSid)
                .channels(channelSid)
                .participants.list();

            console.log(`[Server] Interaction Participants: ${JSON.stringify(participants, null, 4)}`);
            return participants;
        } catch (error) {
            console.error('[FlexService] Error in getParticipants:', error);
            return null;

        }
    }

}

module.exports = { FlexService };
