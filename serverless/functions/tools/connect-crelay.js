/**
 * Connects call to Conversation Relay and passes call specific body parameters along.
 * Requires the server URL (domain and path) to be sent
 */
exports.handler = async function (context, event, callback) {

    // Extract each of the data parameters into "name" and "value", constructing the <Parameter> parts
    const parameters = `<Parameter name="data" value="${event.data}"/>` // TODO: extract all

    const callbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
   <Connect >
      <ConversationRelay 
         url="wss://${event.serverUrl}" 
         voice="en-AU-Neural2-A" 
         dtmfDetection="true" 
         interruptByDtmf="true" 
         debug="true">
            ${parameters}
    </ConversationRelay>
   </Connect>
</Response>`;

    console.log("twiml ==> ", callbackTwiml);

    // Return the twiml to Twilio
    return callback(null, `${callbackTwiml}`);

}

