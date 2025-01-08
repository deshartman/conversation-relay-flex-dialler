/**
 * SilenceHandler Class
 * 
 * Manages silence detection and response during voice conversations. This class monitors
 * the duration of silence (no messages received) and triggers appropriate responses based
 * on configurable thresholds. It implements a progressive response system, first sending
 * reminder messages and ultimately ending the call if silence persists.
 * 
 * Configuration (via environment variables):
 * - SILENCE_SECONDS_THRESHOLD: Number of seconds before triggering silence response (default: 5)
 * - SILENCE_RETRY_THRESHOLD: Maximum number of reminder attempts before ending call (default: 3)
 * 
 * Features:
 * - Tracks duration of silence since last message
 * - Implements progressive reminder system with different messages per retry
 * - Automatically ends call after maximum retry attempts
 * - Provides cleanup for proper resource management
 * 
 * Message Types:
 * - 'info': Ignored for silence detection (prevents false resets)
 * - 'text': Standard message that resets the silence timer
 * - 'prompt': Standard message that resets the silence timer
 * - 'end': Generated when ending call due to silence
 * 
 * @example
 * // Initialize handler
 * const silenceHandler = new SilenceHandler();
 * 
 * // Start monitoring with callback for handling messages
 * silenceHandler.startMonitoring((message) => {
 *   if (message.type === 'end') {
 *     // Handle call end due to silence
 *     console.log('Call ended:', message.handoffData);
 *   } else if (message.type === 'text') {
 *     // Handle silence breaker messages
 *     console.log('Silence reminder:', message.text);
 *   }
 * });
 * 
 * // Reset timer when receiving messages
 * silenceHandler.resetTimer();
 * 
 * // Cleanup when done
 * silenceHandler.cleanup();
 */

const {
    SILENCE_SECONDS_THRESHOLD = 5,
    SILENCE_RETRY_THRESHOLD = 3
} = process.env;

class SilenceHandler {
    /**
     * Creates a new SilenceHandler instance.
     */
    constructor() {
        this.silenceSecondsThreshold = SILENCE_SECONDS_THRESHOLD;
        this.silenceRetryThreshold = SILENCE_RETRY_THRESHOLD;
        this.lastMessageTime = null;
        this.silenceTimer = null;
        this.silenceRetryCount = 0;
        this.messageCallback = null;
    }

    /**
     * Creates the message to end the call due to silence.
     * 
     * @returns {Object} Message object with end type and handoff data
     */
    createEndCallMessage() {
        return {
            type: "end",
            handoffData: JSON.stringify({
                reasonCode: "unresponsive",
                reason: "The caller was not speaking"
            })
        };
    }

    /**
     * Creates a silence breaker reminder message.
     * 
     * @returns {Object} Message object with text type and reminder content
     */
    createSilenceBreakerMessage() {
        // Select a different silence breaker message depending how many times you have asked
        if (this.silenceRetryCount === 1) {
            return {
                type: 'text',
                token: "Still there?",
                last: true
            };
        } else if (this.silenceRetryCount === 2) {
            return {
                type: 'text',
                token: "Just checking you are still there?",
                last: true
            };
        }
    }

    /**
     * Starts monitoring for silence.
     * 
     * @param {Function} onMessage - Callback function to handle messages
     */
    startMonitoring(onMessage) {
        console.log("[Silence Monitor] Starting silence monitoring");
        this.lastMessageTime = Date.now();
        this.messageCallback = onMessage;

        this.silenceTimer = setInterval(() => {
            const silenceTime = (Date.now() - this.lastMessageTime) / 1000; // Convert to seconds
            console.log(`[Silence Monitor] Current silence duration: ${silenceTime.toFixed(1)} seconds`);
            if (silenceTime >= this.silenceSecondsThreshold) {
                this.silenceRetryCount++;
                console.log(`[Silence Monitor] SILENCE BREAKER - No messages for ${this.silenceSecondsThreshold}+ seconds (Retry count: ${this.silenceRetryCount}/${this.silenceRetryThreshold})`);

                if (this.silenceRetryCount >= this.silenceRetryThreshold) {
                    // End the call if we've exceeded the retry threshold
                    clearInterval(this.silenceTimer);
                    console.log("[Silence Monitor] Ending call due to exceeding silence retry threshold");
                    if (this.messageCallback) {
                        this.messageCallback(this.createEndCallMessage());
                    }
                } else {
                    // Send silence breaker message
                    if (this.messageCallback) {
                        this.messageCallback(this.createSilenceBreakerMessage());
                    }
                }
                // Reset the timer after sending the message or ending the call
                this.lastMessageTime = Date.now();
            }
        }, 1000);
    }

    /**
     * Resets the silence timer when a valid message is received.
     */
    resetTimer() {
        if (this.lastMessageTime !== null) {
            this.lastMessageTime = Date.now();
            // Reset the retry count when we get a valid message
            this.silenceRetryCount = 0;
            console.log("[Silence Monitor] Timer and retry count reset");
        } else {
            console.log("[Silence Monitor] Message received but monitoring not yet started");
        }
    }

    /**
     * Cleans up resources by clearing the silence timer.
     */
    cleanup() {
        if (this.silenceTimer) {
            console.log("[Silence Monitor] Cleaning up silence monitor");
            clearInterval(this.silenceTimer);
            this.messageCallback = null;
        }
    }
}

module.exports = { SilenceHandler };
