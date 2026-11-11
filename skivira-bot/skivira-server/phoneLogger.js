// phoneLogger.js - Logger specifically for Twilio calls

const fs = require('fs');
const path = require('path');

// Base folder where all logs will be stored
const LOG_DIR_BASE = path.resolve(__dirname, 'data', 'chat-logs');

/**
 * Formats session history into a nice text log.
 * @param {object} logData - Session object from server.js
 * @param {string} ipAddress - IP address
 * @returns {string} Ready text content for file
 */
function formatPhoneLogToText(logData, ipAddress) {
    let content = '';
    const separator = '----------------------------------------';

    // 1. Header (metadata)
    content += `Phone Session ID: ${logData.logSessionId || 'N/A'}\n`;
    content += `Twilio Call SID: ${logData.twilioCallSid || 'N/A'}\n`;
    content += `Caller Number: ${logData.phoneNumber || 'Unknown'}\n`; // <--- ADDED THIS LINE
    content += `Saved At: ${logData.savedAt}\n`;
    content += `Client IP: ${ipAddress || 'Unknown'}\n`;
    content += `${separator}\n\n`;

    // 3. Transcript
    if (logData.history && logData.history.length > 0) {
        for (const msg of logData.history) {

            // If ts was saved (in server.js), use it.
            // If not (old records), use current time.
            let msgDate;
            if (msg.ts) {
                msgDate = new Date(msg.ts);
            } else {
                msgDate = new Date();
            }

            const time = msgDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Map 'role' to 'SENDER'
            const sender = (msg.role === 'user') ? 'USER' : 'ASSISTANT';

            // Extract text from 'parts'
            const text = msg.parts && msg.parts.length > 0 ? msg.parts[0].text : '[empty message]';

            content += `[${time}] ${sender}:\n`;
            content += `${text}\n\n`;
        }
    } else {
        content += '[No messages recorded]\n';
    }

    return content;
}

/**
 * Saves (or overwrites) call transcript to a .txt file.
 *
 * @param {object} logData Object with log data (from server.js).
 * @param {string} ipAddress Caller IP address (from server.js).
 * @param {string} logSessionId Filename (Session ID)
 * @returns {string} Saved filename.
 */
function savePhoneLog(logData, ipAddress, logSessionId) {
    // Ensure folder exists
    if (!fs.existsSync(LOG_DIR_BASE)) {
        fs.mkdirSync(LOG_DIR_BASE, { recursive: true });
        console.log(`[PhoneLogger] Created log directory at: ${LOG_DIR_BASE}`);
    }

    // Use Session ID as filename + .txt
    const filename = `${logSessionId}.txt`;
    const filePath = path.join(LOG_DIR_BASE, filename);

    // Format as .txt
    const content = formatPhoneLogToText(logData, ipAddress);

    try {
        // fs.writeFileSync will overwrite existing file
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[PhoneLogger] Log saved/updated: ${filename}`);
        return filename;
    } catch (e) {
        console.error(`[PhoneLogger] Failed to write log file ${filename}:`, e.message);
        throw new Error('Failed to save log file');
    }
}

module.exports = { savePhoneLog };