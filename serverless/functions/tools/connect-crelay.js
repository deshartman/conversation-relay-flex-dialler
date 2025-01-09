/**
 * Connects call to Conversation Relay and passes call specific body parameters along.
 * Requires the server URL (domain and path) to be sent
 */
exports.handler = async function (context, event, callback) {

   try {
      const callbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
         <Response>
            <Connect >
               <ConversationRelay 
                  url="wss://${event.serverUrl}" 
                  voice="en-AU-Neural2-A" 
                  dtmfDetection="true" 
                  interruptByDtmf="true" 
                  debug="true">
                  <Parameter name="customerReference" value="${event.customerReference}"/>
               </ConversationRelay>
            </Connect>
         </Response>`;

      console.log("twiml ==> ", callbackTwiml);

      // Return the twiml to Twilio
      return callback(null, `${callbackTwiml}`);


   } catch (error) {
      console.error("Error in connect-crelay: ", error);
      return callback(error);

   }

}

