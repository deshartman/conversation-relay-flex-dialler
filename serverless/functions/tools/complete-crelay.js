/**
 * Makes an outbound call based on the "to" number passed in the event and connects the original called number. 
 * 
 * @param {String} to - To phone number via event
 * 
 */
exports.handler = async function (context, event, callback) {

    const voiceResponse = new Twilio.twiml.VoiceResponse();
    console.log(`[Complete CRelay] Event: ${JSON.stringify(event)}`);

    try {


        return callback(null, `${call.sid}`);
    } catch (error) {
        return callback(`[CallOut] Error: ${error}`);
    }
}

