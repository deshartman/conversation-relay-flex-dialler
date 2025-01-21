const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m'
};

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
    console.log(`${colors.green}[${getSydneyTimestamp()}] [${identifier}] ${message}${colors.reset}`);
};

const logError = (identifier, message) => {
    console.error(`${colors.red}[${getSydneyTimestamp()}] [${identifier}] ${message}${colors.reset}`);
};

module.exports = {
    logOut,
    logError
};
