exports.handler = async function (context, event, callback) {
  console.log("[getCustomer] Event object:", JSON.stringify(event, null, 4));

  try {
    // Extract phone-number from the event object
    let caller = event.from;
    if (!caller) {
      throw new Error('[getCustomer] phone-number is missing from the event object');
    }

    console.log(`[getCustomer] Phone number provided:`, caller);

    // Pull customer data from environment variables
    const customerData = {
      firstname: context.CUSTOMER_NAME,
      lastname: context.CUSTOMER_LASTNAME
    }
    console.log(`[getCustomer] customer returned:`, customerData);
    return callback(null, customerData);
  } catch (error) {
    return callback(`[getCustomer] Error: ${error}`);
  }
}
