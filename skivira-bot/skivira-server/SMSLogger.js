// SMSLogger.js
const fs = require('fs');
const path = require('path');

// Use the same base folder for logs
const LOG_DIR_BASE = path.resolve(__dirname, 'data', 'chat-logs');
const SEPARATOR = '----------------------------------------';

/**
 * Creates a formatted timestamp, like in server.js
 * (e.g., 2025-11-16_17-01-23)
 */
function getTimestamp() {
    const pad2 = (n) => (n < 10 ? '0' : '') + n;
    const d = new Date();
    const Y = d.getFullYear();
    const M = pad2(d.getMonth() + 1);
    const D = pad2(d.getDate());
    const h = pad2(d.getHours());
    const m = pad2(d.getMinutes());
    const s = pad2(d.getSeconds());
    return `${Y}-${M}-${D}_${h}-${m}-${s}`;
}

/**
 * Formats and appends SMS to the log file.
 * Renames the file so its name contains the timestamp of the last message.
 *
 * @param {object} smsData - Object with SMS data { from: string, body: string }
 * @param {string} ipAddress - IP address (from Twilio)
 * @returns {string} New filename in which the record was made.
 */
function saveSmsLog(smsData, ipAddress) {
    const { from, body } = smsData;

    // 1. Ensure 'data/chat-logs' folder exists
    if (!fs.existsSync(LOG_DIR_BASE)) {
        fs.mkdirSync(LOG_DIR_BASE, { recursive: true });
        console.log(`[SMSLogger] Created log directory at: ${LOG_DIR_BASE}`);
    }

    // 2. Prepare identifiers
    // (e.g., +15551230000 -> _+15551230000_sms.txt)
    const cleanFrom = from || 'unknown_sender';
    const fileSuffix = `_${cleanFrom}_sms.txt`;

    // 3. Find existing log file for this number
    let oldFilename = null;
    try {
        const files = fs.readdirSync(LOG_DIR_BASE);
        // Find file ENDING with our suffix
        oldFilename = files.find(f => f.endsWith(fileSuffix));
    } catch (e) {
        console.error(`[SMSLogger] Failed to read log directory:`, e.message);
        throw new Error('Failed to read log directory');
    }

    // 4. Prepare record (content to append)
    const time = new Date().toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'medium'
    });

    let contentToAppend = `[${time}] (IP: ${ipAddress || 'N/A'})\n`;
    contentToAppend += `${body}\n\n`; // Add empty line for separation

    // 5. Define paths
    const newTimestamp = getTimestamp();
    const newFilename = `${newTimestamp}${fileSuffix}`;
    const newFilePath = path.join(LOG_DIR_BASE, newFilename);

    // --- Writing logic ---

    try {
        if (!oldFilename) {
            // --- CASE 1: New conversation ---
            // File doesn't exist, create header
            let header = `Session ID: ${newFilename}\n`; // Session ID = first filename
            header += `SMS Log For: ${from}\n`;
            header += `First Seen IP: ${ipAddress || 'N/A'}\n`;
            header += `${SEPARATOR}\n\n`;

            const content = header + contentToAppend;

            fs.writeFileSync(newFilePath, content, 'utf-8');
            console.log(`[SMSLogger] New log created: ${newFilename}`);
        } else {
            // --- CASE 2: Existing conversation ---
            const oldFilePath = path.join(LOG_DIR_BASE, oldFilename);

            // 1. Append new content to OLD file
            fs.appendFileSync(oldFilePath, contentToAppend, 'utf-8');

            // 2. Rename OLD file to NEW
            fs.renameSync(oldFilePath, newFilePath);

            console.log(`[SMSLogger] Log updated and renamed to: ${newFilename}`);
        }
        return newFilename;

    } catch (e) {
        console.error(`[SMSLogger] Failed to write/rename log file ${newFilename}:`, e.message);
        // Attempt to rescue data if renaming fails
        if (!fs.existsSync(newFilePath)) {
            fs.writeFileSync(path.join(LOG_DIR_BASE, `ERR_${newFilename}`), contentToAppend, 'utf-8');
        }
        throw new Error('Failed to save log file');
    }
}

module.exports = { saveSmsLog };