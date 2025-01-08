exports.handler = async function (context, event, callback) {
  console.log("[getCustomer] Event object:", JSON.stringify(event, null, 4));

  try {

    // Pull customer data from environment variables
    const customerData = {
      to: event.to,
      from: event.from,
      callSid: event.callSid,
      customerReference: event.customParameters?.customerReference || null,
      firstname: context.CUSTOMER_NAME,
      lastname: context.CUSTOMER_LASTNAME,
      greetingText: `Greet the customer with name ${context.CUSTOMER_NAME} in a friendly manner. Do not constantly use their name, but drop it in occasionally. Tell them that you have to fist verify their details before you can proceed to ensure confidentiality of the conversation.`
    }
    console.log(`[getCustomer] customer returned:`, customerData);
    return callback(null, customerData);
  } catch (error) {
    return callback(`[getCustomer] Error: ${error}`);
  }
}
