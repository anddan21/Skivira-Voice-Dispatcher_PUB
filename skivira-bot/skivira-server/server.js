// server.js
// Skivira-server — static server + /api/generate (Gemini Text) + /api/gemini-key (Voice)

const VOICE_TTS_NAME = 'Fenrir'

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// --- Import all loggers ---
const { saveCallLog } = require('./callLogger');
const { saveTextChat } = require('./textLogger');
const { savePhoneLog } = require('./phoneLogger.js');
const { saveSmsLog } = require('./SMSLogger.js');

const twilio = require('twilio');
const { twiml } = require('twilio');
const phoneHandler = require('./phone.js');

const PORT = Number(process.env.PORT || 5500);
const STATIC_DIR = path.resolve(__dirname, 'Public');
const ENV_PATH = path.resolve(__dirname, '.env');
const INSTR_DIR = path.resolve(__dirname, 'config', 'instructions');

// =================================================================
// --- HELPER FUNCTIONS ---
// =================================================================
function readEnvFile(filePath) {
  const env = {};
  try {
    let raw = fs.readFileSync(filePath, 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      let t = line.replace(/\s+$/, '');
      const trimmed = t.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2] ?? '';
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      } else {
        const idx = val.indexOf('#');
        if (idx >= 0) val = val.slice(0, idx);
        val = val.trim();
      }
      env[key] = val;
    }
  } catch { }
  return env;
}
function readTextSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); }
  catch { return ''; }
}
function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serve(filePath, res) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8'
  };
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
async function readUrlEncodedBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => {
      try {
        resolve(Object.fromEntries(new URLSearchParams(data)));
      }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function getTimestampSessionId(suffix = 'log') {
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const d = new Date();
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${Y}_${M}_${D}_${h}_${m}_${s}_${suffix}`;
}

// --- UNIVERSAL SPAM CHECK FUNCTION ---
function isSpamText(text) {
  if (!text) return false;
  const spamFilePath = path.resolve(__dirname, 'config', 'spam-filter.txt');
  try {
    if (fs.existsSync(spamFilePath)) {
      const spamText = fs.readFileSync(spamFilePath, 'utf-8');
      const spamPhrases = spamText.split(/\r?\n/).map(p => p.trim().toLowerCase()).filter(Boolean);
      const lowerText = text.toLowerCase();
      return spamPhrases.some(phrase => lowerText.includes(phrase));
    }
  } catch(e) { 
    console.error('[SpamFilter] Error reading spam-filter.txt:', e.message); 
  }
  return false;
}
// =================================================================
// --- END: HELPER FUNCTIONS ---
// =================================================================


function loadInstructions(directoryPath, mainFile) {
  let mainContent = '';
  const otherContents = [];
  const mainFilePath = path.join(directoryPath, mainFile);
  try {
    mainContent = readTextSafe(mainFilePath);
  } catch (e) {
    console.warn(`[InstrLoader] Main instruction file ${mainFile} not found.`);
  }
  try {
    const files = fs.readdirSync(directoryPath);
    const otherTxtFiles = files
      .filter(file =>
        file.toLowerCase().endsWith('.txt') &&
        file !== mainFile
      )
      .sort();
    for (const file of otherTxtFiles) {
      const filePath = path.join(directoryPath, file);
      const content = readTextSafe(filePath);
      if (content) {
        otherContents.push(content);
      }
    }
  } catch (e) {
    console.warn(`[InstrLoader] Failed to read instruction directory: ${e.message}`);
  }
  const separator = '\n\n___\n\n';
  return [mainContent, ...otherContents]
    .filter(Boolean)
    .join(separator)
    .trim();
}

// Call session storage
const callSessions = new Map();


// Startup: read .env and instruction ONCE
const ENV = readEnvFile(ENV_PATH);
const AI_KEY = ENV.AI_API_KEY || '';
const INSTRUCTION = loadInstructions(INSTR_DIR, 'dispatcher.txt');
const GREETING = ENV.VOICE_GREETING_TEXT || '';
const AI_MODEL_PHONE = ENV.AI_MODEL_PHONE || '';

if (!AI_KEY) console.warn('WARNING: AI_API_KEY not found in .env');
if (!AI_MODEL_PHONE) console.warn('WARNING: AI_MODEL_PHONE not found in .env');

// Initialization phone.js
phoneHandler.initialize({
  greetingText: GREETING,
  turnEndpoint: '/api/phone/turn'
});
console.log(`[Phone] Handler initialized.`);


// callGeminiGenerate
async function callGeminiGenerate({ contents, generationConfig, modelName }) {

  // 1. GET TIME FROM YOUR SERVER (It is now correct, PST)
  const nowPST = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });

  // 2. TELL IT TO AI
  // We add this line to your text instruction
  const timeInstruction = `\n\n[SYSTEM TIME CHECK]\nCurrent Server Time: ${nowPST}.\nUse this time for all scheduling.`;

  // Assemble the full instruction text for this specific request
  const finalSystemInstruction = INSTRUCTION ? { parts: [{ text: INSTRUCTION + timeInstruction }] } : undefined;

  const baseBody = {
    system_instruction: finalSystemInstruction,
    contents,
    generationConfig: generationConfig || { temperature: 0.7 }
  };

  const endpoints = [{ ver: 'v1beta', sys: 'systemInstruction' }];
  let lastErr = null;
  for (const ep of endpoints) {
    const body = { ...baseBody };
    if (baseBody.system_instruction && ep.sys === 'systemInstruction') {
      body.systemInstruction = baseBody.system_instruction;
      delete body.system_instruction;
    }
    const url = `https://generativelanguage.googleapis.com/${ep.ver}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(AI_KEY)}`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store'
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, data, ver: ep.ver };
      lastErr = { status: r.status, data };
    } catch (e) {
      lastErr = { status: 500, data: { error: { message: String(e) } } };
    }
  }
  return { ok: false, ...lastErr };
}


// --- Log update function ---
function updatePhoneLog(session, ip) {
  const { history, logSessionId } = session;
  const hasUserMessages = history.some(m => m.role === 'user');
  if (!hasUserMessages) return;

  const logData = {
    ...session,
    savedAt: new Date().toISOString()
  };

  try {
    savePhoneLog(logData, ip, logSessionId);
  } catch (e) {
    console.error(`[Session] Failed to update log ${logSessionId}:`, e.message);
  }
}


// --- Call termination function ---
function handleHangup(callSid, session, ip) {
  const { history, logSessionId } = session;
  console.log(`[Session] Hangup. Deleting session ${callSid} (Log ID: ${logSessionId})`);
  callSessions.delete(callSid);
  const hasUserMessages = history.some(m => m.role === 'user');
  if (hasUserMessages) {
    console.log(`[Session] Final log ${logSessionId}.txt saved.`);
  } else {
    console.log(`[Session] No user messages, empty log deleted for ${logSessionId}.`);
  }
}


// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = url.parse(req.url);
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;

    // --- TWILIO WEBHOOKS ---

    // 1. /api/phone/incoming (START)
    if (req.method === 'POST' && pathname === '/api/phone/incoming') {
      const body = await readUrlEncodedBody(req);
      const fromNumber = body.From; // <___ Save caller number

      // --- NOMOROBO SPAM FILTER START ---
      if (body.AddOns) {
        try {
          const addons = JSON.parse(body.AddOns);
          const spamData = addons.results?.nomorobo_spamscore?.result;

          if (spamData && spamData.score === 1) {
            console.log(`[SpamFilter] 🚫 BLOCKED call from ${fromNumber}. Nomorobo Score: 1`);

            const twiml = new twilio.twiml.VoiceResponse();
            twiml.reject();

            res.writeHead(200, { 'Content-Type': 'application/xml' });
            return res.end(twiml.toString());
          }
        } catch (e) {
          console.error('[SpamFilter] Error parsing AddOns JSON:', e.message);
        }
      }
      // --- NOMOROBO SPAM FILTER END ---

      const callSid = body.CallSid;
      const logSessionId = getTimestampSessionId('phone');

      console.log(`[Session] New call ${callSid} from ${fromNumber}. Log ID: ${logSessionId}`);

      callSessions.set(callSid, {
        history: [],
        logSessionId: logSessionId,
        silenceStrikes: 0,
        twilioCallSid: callSid,
        phoneNumber: fromNumber 
      });

      const twiml = phoneHandler.handleIncomingCall();
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(twiml);
    }

    // 2. /api/phone/language-selection (LANGUAGE SELECTION - INITIAL)
    if (req.method === 'POST' && pathname === '/api/phone/language-selection') {
      const body = await readUrlEncodedBody(req);
      const digits = body.Digits;

      let selectedLang = 'en-US';
      let greeting = 'Hello. My name is John. How can I help you?';

      if (digits === '2') {
        selectedLang = 'es-ES';
        greeting = 'Hola, soy John. ¿En qué puedo ayudarle?';
      }
      if (digits === '7') {
        selectedLang = 'ru-RU';
        greeting = 'Здравствуйте. Меня зовут Джон. Чем я могу вам помочь?';
      }

      const twiml = phoneHandler.handleNextTurn(greeting, selectedLang);

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(twiml);
    }

    // 3. /api/phone/turn (DIALOGUE)
    if (req.method === 'POST' && pathname === '/api/phone/turn') {
      const body = await readUrlEncodedBody(req);
      const { CallSid, SpeechResult, CallStatus, Digits } = body; 

      let queryParams = url.parse(req.url, true).query;
      let currentLang = queryParams.lang || 'en-US';

      let twiml;

      // --- A. CHECK: LANGUAGE CHANGE MID-CONVERSATION ---
      if (Digits === '1') {
        console.log(`[Twilio] User pressed 1. Switching to English.`);
        currentLang = 'en-US';
        twiml = phoneHandler.handleNextTurn("Switched to English. How can I help you?", currentLang);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(twiml.toString());
      }
      if (Digits === '2') {
        console.log(`[Twilio] User pressed 2. Switching to Spanish.`);
        currentLang = 'es-ES';
        twiml = phoneHandler.handleNextTurn("Cambiado a español. ¿En qué puedo ayudarle?", currentLang);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(twiml.toString());
      }
      if (Digits === '7') {
        console.log(`[Twilio] User pressed 7. Switching to Russian.`);
        currentLang = 'ru-RU';
        twiml = phoneHandler.handleNextTurn("Переключаюсь на русский. Чем могу помочь?", currentLang);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(twiml.toString());
      }
      // ___________________________________________________

      if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled' || CallStatus === 'no-answer' || CallStatus === 'busy') {
        console.log(`[Twilio] Call ${CallSid} ${CallStatus}.`);
        const session = callSessions.get(CallSid) || {
          history: [],
          logSessionId: (CallSid || 'unknown') + '_phone_fallback',
          twilioCallSid: CallSid
        };
        handleHangup(CallSid, session, ip);
        twiml = new twilio.twiml.VoiceResponse().toString();
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(twiml);
      }

      let session = callSessions.get(CallSid);
      if (!session) {
        console.warn(`[Session] No history found for ${CallSid}, creating new.`);
        const newLogId = getTimestampSessionId('phone');
        session = {
          history: [],
          logSessionId: newLogId,
          silenceStrikes: 0,
          twilioCallSid: CallSid
        };
        callSessions.set(CallSid, session);
      }

      if (!session.phoneNumber && body.From) {
        session.phoneNumber = body.From;
      }

      if (!SpeechResult) {
        console.log('[Twilio] User was silent.');
        session.silenceStrikes++;

        if (session.silenceStrikes >= 3) {
          twiml = phoneHandler.handleFinalHangup(currentLang);
        } else {
          twiml = phoneHandler.handleSilenceWarning(currentLang);
        }

      } else {
        session.silenceStrikes = 0;
        console.log(`[Twilio] STT: "${SpeechResult}"`);

        // --- CUSTOM SPAM FILTER CHECK (PHONE) ---
        if (isSpamText(SpeechResult)) {
            console.log(`[SpamFilter] 🚫 PHONE SPAM DETECTED in speech: "${SpeechResult}". Hanging up and discarding session.`);
            callSessions.delete(CallSid); // Delete session
            const rejectTwiml = new twilio.twiml.VoiceResponse();
            rejectTwiml.hangup();
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            return res.end(rejectTwiml.toString());
        }

        // Add ts
        session.history.push({
          role: 'user',
          parts: [{ text: SpeechResult }],
          ts: Date.now()
        });

        // Filter ts before sending to Google
        const historyForGemini = session.history.map(m => ({
          role: m.role,
          parts: m.parts
        }));

        const r = await callGeminiGenerate({
          contents: historyForGemini,
          modelName: AI_MODEL_PHONE
        });

        let aiResponseText;
        if (!r.ok) {
          console.error('[Gemini] Error:', r.data);
          aiResponseText = 'I apologize, I encountered an error.';
        } else {
          aiResponseText = (r.data?.candidates?.[0]?.content?.parts || [])
            .map(p => p.text || '')
            .join('').trim() || '[empty response]';
        }

        console.log(`[Gemini] Response: "${aiResponseText}"`);

        // Add ts
        session.history.push({
          role: 'model',
          parts: [{ text: aiResponseText }],
          ts: Date.now()
        });

        updatePhoneLog(session, ip);

        twiml = phoneHandler.handleNextTurn(aiResponseText, currentLang);
      }

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(twiml.toString());
    }
    // --- END WEBHOOKS ---

    // === SMS ===
    if (req.method === 'POST' && pathname === '/api/sms/incoming') {
      let body;
      try { body = await readUrlEncodedBody(req); } catch (e) { res.writeHead(400); return res.end('Bad Request'); }
      const fromNumber = body.From;
      const messageBody = body.Body;
      console.log(`[SMS] From: ${fromNumber}, Msg: "${messageBody}"`);
      try { saveSmsLog({ from: fromNumber, body: messageBody }, ip); } catch (e) { }
      const twimlResponse = new twiml.MessagingResponse();
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twimlResponse.toString());
      return;
    }

    // ... static files ...
    if (req.method === 'GET' && (pathname === '/call/')) {
      const file = path.join(STATIC_DIR, 'call', 'index.html');
      if (fs.existsSync(file)) return serve(file, res);
      res.writeHead(404); return res.end('index.html not found');
    }
    if (req.method === 'GET' && (pathname === '/chat/')) {
      const file = path.join(STATIC_DIR, 'chat', 'index.html');
      if (fs.existsSync(file)) return serve(file, res);
      res.writeHead(404); return res.end('index.html not found');
    }
    if (req.method === 'GET' && pathname === '/api/model') {
      return json(res, { liveModel: ENV.AI_MODEL_VOICE, ttsModel: ENV.AI_MODEL_TTS, greetingText: ENV.VOICE_GREETING_TEXT, voiceName: VOICE_TTS_NAME });
    }
    if (req.method === 'GET' && pathname === '/api/gemini-key') {
      return json(res, { key: AI_KEY });
    }
    if (req.method === 'GET' && pathname === '/api/instructions') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(INSTRUCTION);
    }
    if (req.method === 'POST' && pathname === '/api/generate') {
      let body;
      try { body = await readJsonBody(req); } catch { return json(res, {}, 400); }

      // --- CUSTOM SPAM FILTER CHECK (TEXT CHAT) ---
      let lastUserText = '';
      if (body.contents && Array.isArray(body.contents)) {
         const lastMsg = body.contents[body.contents.length - 1];
         if (lastMsg && lastMsg.role === 'user' && lastMsg.parts && lastMsg.parts[0]) {
             lastUserText = lastMsg.parts[0].text || '';
         }
      }

      if (isSpamText(lastUserText)) {
         console.log(`[SpamFilter] 🚫 TEXT CHAT SPAM DETECTED: "${lastUserText}". Blocking request.`);
         // Return a fake AI response so the frontend doesn't crash with an error
         return json(res, { 
             candidates: [{ content: { parts: [{ text: "System: Message blocked by spam filter." }] } }] 
         }, 200); 
      }
      // --------------------------------------------

      const r = await callGeminiGenerate({ contents: body.contents, generationConfig: body.generationConfig, modelName: ENV.AI_MODEL_CHAT });
      if (r.ok) return json(res, r.data, 200);
      return json(res, r.data, Number(r.status) || 500);
    }
    if (req.method === 'POST' && pathname === '/api/save-chat') {
      let body; try { body = await readJsonBody(req); } catch { return json(res, {}, 400); }
      try { const f = saveCallLog(body, ip, body.callSessionId); return json(res, { success: true, filename: f }); } catch (e) { return json(res, { error: { message: e.message } }, 500); }
    }
    if (req.method === 'POST' && pathname === '/api/save-text-chat') {
      let body; try { body = await readJsonBody(req); } catch { return json(res, {}, 400); }
      try { const f = saveTextChat(body, ip, body.chatSessionId); return json(res, { success: true, filename: f }); } catch (e) { return json(res, { error: { message: e.message } }, 500); }
    }

    // static files logic
    let p = decodeURIComponent(pathname || '/');
    const abs = path.join(STATIC_DIR, p);
    const rel = path.relative(STATIC_DIR, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); return res.end('Forbidden'); }
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return serve(abs, res);
    const spa = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(spa)) return serve(spa, res);

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');

  } catch (e) {
    console.warn(e);
    res.writeHead(500); res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  const head = (AI_KEY || '').slice(0, 6) + '…';
  console.log(`[Skivira-server] URL: http://localhost:${PORT}`);
  console.log(`[Skivira-server] PHONE: Twilio endpoints /api/phone/* enabled.`);
});