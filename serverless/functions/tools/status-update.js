exports.handler = async function (context, event, callback) {
  try {
    // Just log what you got
    console.log(`[status-update] returned:`, JSON.stringify(event, null, 4));
    const response = {
      "Customer Reference": event.customerReference,
      "Status": event.status
    };
    return callback(null, response);
  } catch (error) {
    return callback(`[status-update] Error: ${error}`);
  }
}
