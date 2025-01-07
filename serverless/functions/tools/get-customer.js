exports.handler = async function (context, event, callback) {
  console.log("[getCustomer] Event object:", JSON.stringify(event, null, 4));

  try {
    // Extract phone-number from the event object
    let customerReference = event.customParameters.customerReference;
    if (!customerReference) {
      throw new Error('[getCustomer] customerReference is missing so cannot look up customer data');
    }

    console.log(`[getCustomer] Phone number provided:`, customerReference);

    // Pull customer data from environment variables
    const customerData = {
      to: event.to,
      from: event.from,
      callSid: event.callSid,
      customerReference: event.customerReference,
      firstname: context.CUSTOMER_NAME,
      lastname: context.CUSTOMER_LASTNAME,
      greetingText: `Greet the customer with name ${firstname} in a friendly manner. Do not constantly use their name, but drop it in occasionally. Tell them that you have to fist verify their details before you can proceed to ensure confidentiality of the conversation.`
    }
    console.log(`[getCustomer] customer returned:`, customerData);
    return callback(null, customerData);
  } catch (error) {
    return callback(`[getCustomer] Error: ${error}`);
  }
}
