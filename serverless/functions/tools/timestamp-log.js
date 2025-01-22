const { logOut, logError } = require('../utils/logger');

// Simply timelog calls to this function
exports.handler = async function (context, event, callback) {

    logOut(`Timestamp Log`, `Event received ${JSON.stringify(event.CallStatus, null, 4)} `);
}
