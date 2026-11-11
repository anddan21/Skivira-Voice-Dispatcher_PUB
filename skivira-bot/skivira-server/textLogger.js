const fs = require('fs');
const path = require('path');

// Base folder where all logs will be stored
const LOG_DIR_BASE = path.resolve(__dirname, 'data', 'chat-logs');

// (Function getTimestampFilename() is REMOVED from here, as it moved to app.js)

/**
 * Formats transcript into a nice text log.
 * @param {object} textLog - Object from app.js
 * @param {string} ipAddress - IP address
 * @returns {string} Ready text content for file
 */
function formatChatToText(textLog, ipAddress) {
    let content = '';
    const separator = '----------------------------------------';

    // 1. Header (metadata)
    content += `Session ID: ${textLog.chatSessionId || 'N/A'}\n`; // <-- Use Session ID
    content += `Saved At: ${textLog.savedAt}\n`;
    content += `Client IP: ${ipAddress || 'Unknown'}\n`;
    
    // 2. Separator
    content += `${separator}\n\n`;

    // 3. Transcript
    if (textLog.messages && textLog.messages.length > 0) {
        for (const msg of textLog.messages) {
            const time = new Date(msg.ts).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const sender = (msg.role || 'system').toUpperCase();
            content += `[${time}] ${sender}:\n`;
            content += `${msg.content}\n\n`;
        }
    } else {
        content += '[No messages recorded]\n';
    }

    return content;
}

/**
 * Saves (or overwrites) chat transcript to a .txt file.
 *
 * @param {object} textLog Object with log data (from app.js).
 * @param {string} ipAddress IP address (from server.js).
 * @param {string} chatSessionId Filename (Session ID)
 * @returns {string} Saved filename.
 */
function saveTextChat(textLog, ipAddress, chatSessionId) {
    // Ensure folder exists
    if (!fs.existsSync(LOG_DIR_BASE)) {
        fs.mkdirSync(LOG_DIR_BASE, { recursive: true });
        console.log(`[TextLogger] Created log directory at: ${LOG_DIR_BASE}`);
    }

    // Use Session ID as filename + .txt
    const filename = `${chatSessionId}.txt`;
    const filePath = path.join(LOG_DIR_BASE, filename);
    
    // Format as .txt
    const content = formatChatToText(textLog, ipAddress);

    try {
        // fs.writeFileSync will overwrite existing file
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[TextLogger] Log saved/updated: ${filename}`);
        return filename;
    } catch (e) {
        console.error(`[TextLogger] Failed to write log file ${filename}:`, e.message);
        throw new Error('Failed to save log file');
    }
}

module.exports = { saveTextChat };