exports.handler = async function (context, event, callback) {
  try {
    // Just log what you got
    console.log(`[send-dtmf] returned:`, JSON.stringify(event, null, 4));
    const response = {
      "dtmfDigit": event.dtmfDigit
    };
    return callback(null, response);
  } catch (error) {
    return callback(`[send-dtmf] Error: ${error}`);
  }
}