const getSydneyTimestamp = () => {
    return new Date().toLocaleString('en-AU', {
        timeZone: 'Australia/Sydney',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

const logOut = (identifier, message) => {
    console.log(`[${getSydneyTimestamp()}] [${identifier}] ${message}`);
};

const logError = (identifier, message) => {
    console.error(`[${getSydneyTimestamp()}] [${identifier}] ${message}`);
};

module.exports = {
    logOut,
    logError
};
