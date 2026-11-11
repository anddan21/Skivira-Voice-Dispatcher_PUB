const fs = require('fs');
const path = require('path');

// Base folder where all logs will be stored
const LOG_DIR_BASE = path.resolve(__dirname, 'data', 'chat-logs');

// (Function getTimestampFilename() is REMOVED from here, as it moved to app.js)

/**
 * Formats transcript into a nice text log.
 * @param {object} callLog - Object from app.js
 * @param {string} ipAddress - IP address
 * @returns {string} Ready text content for file
 */
function formatChatToText(callLog, ipAddress) {
    let content = '';
    const separator = '----------------------------------------';

    // 1. Header (metadata)
    content += `Call Session ID: ${callLog.callSessionId || 'N/A'}\n`; // <-- Use Session ID
    content += `Call ID (Internal): ${callLog.callId || 'N/A'}\n`;
    content += `Saved At: ${callLog.savedAt}\n`;
    content += `Client IP: ${ipAddress || 'Unknown'}\n`;

    // 2. Separator
    content += `${separator}\n\n`;

    // 3. Transcript
    if (callLog.messages && callLog.messages.length > 0) {
        for (const msg of callLog.messages) {
            // Get HH:MM:SS from timestamp
            const time = new Date(msg.ts).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            const sender = (msg.sender || 'system').toUpperCase();

            // Format: [10:30:15] USER:
            content += `[${time}] ${sender}:\n`;
            // The text itself on a new line
            content += `${msg.text}\n\n`;
        }
    } else {
        content += '[No messages recorded]\n';
    }

    return content;
}

/**
 * Saves (or overwrites) call transcript to a .txt file.
 *
 * @param {object} callLog Object with log data (from app.js).
 * @param {string} ipAddress Caller IP address (from server.js).
 * @param {string} callSessionId Filename (Session ID)
 * @returns {string} Saved filename.
 */
function saveCallLog(callLog, ipAddress, callSessionId) {
    // Ensure folder exists
    if (!fs.existsSync(LOG_DIR_BASE)) {
        fs.mkdirSync(LOG_DIR_BASE, { recursive: true });
        console.log(`[CallLogger] Created log directory at: ${LOG_DIR_BASE}`);
    }

    // Use Session ID as filename + .txt
    const filename = `${callSessionId}.txt`;
    const filePath = path.join(LOG_DIR_BASE, filename);

    // Format as .txt
    const content = formatChatToText(callLog, ipAddress);

    try {
        // fs.writeFileSync will overwrite existing file
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[CallLogger] Log saved/updated: ${filename}`);
        return filename;
    } catch (e) {
        console.error(`[CallLogger] Failed to write log file ${filename}:`, e.message);
        throw new Error('Failed to save log file');
    }
}

module.exports = { saveCallLog };