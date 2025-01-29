const { logOut, logError } = require('../utils/logger');

class SegmentService {
    /**
     * Processes a call status update and returns a formatted response.
     * 
     * @param {string} customerReference - Reference ID for the customer
     * @param {string} status - The current status of the call
     * @returns {Object} Formatted status update response
     */
    processStatusUpdate(customerReference, status) {
        try {
            logOut('SegmentService', `Processing status update - Customer Reference: ${customerReference}, Status: ${status}`);

            const response = {
                "Customer Reference": customerReference,
                "Status": status
            };

            logOut('SegmentService', `Status update response: ${JSON.stringify(response, null, 4)}`);
            return response;

        } catch (error) {
            logError('SegmentService', `Error processing status update: ${error}`);
            throw error;
        }
    }
}

module.exports = { SegmentService };
