const { logOut, logError } = require('../utils/logger');

exports.handler = async function (context, event, callback) {
  try {
    logOut('StatusUpdate: Event', `${JSON.stringify(event, null, 4)}`);
    const response = {
      "Customer Reference": event.customerReference,
      "Status": event.status
    };
    logOut('StatusUpdate: Response', `${JSON.stringify(response, null, 4)}`);
    return callback(null, response);
  } catch (error) {
    logError('StatusUpdate: Error', `${error}`);
    return callback(`Error: ${error}`);
  }
}
