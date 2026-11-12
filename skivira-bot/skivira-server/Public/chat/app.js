// Skira client — server proxy /api/generate + keep focus in textarea
console.log('[Skivira] boot (server proxy /api/generate; focus keep)');

const $ = s => document.querySelector(s);
const logEl = $('#log');
const promptEl = $('#prompt');
const sendBtn = $('#sendBtn');
const modelEl = $('#model');
const statusEl = $('#status');
const clearBtn = $('#clearBtn');

const LS_CHAT = 'skivira_chat_history';
const LS_MODEL = 'skivira_last_model';
const SS_SESSION_ID = 'skivira_chat_session_id'; // <-- Session Storage key
let AI_API_KEY = ''; // used only to list models

// --- CHANGE: no fallback greeting ---
let serverGreetingText = ''; // (Loaded from /api/model)

let chat = loadChat();
let currentChatSessionId = null; // <-- Session ID

function loadChat() { try { return JSON.parse(localStorage.getItem(LS_CHAT)) ?? []; } catch { return []; } }
function saveChat() { localStorage.setItem(LS_CHAT, JSON.stringify(chat)); }

// --- NEW: ID generator (moved from textLogger.js) ---
function getTimestampSessionId() {
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const d = new Date();
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${Y}-${M}-${D}_${h}-${m}-${s}_chat`;
}

// --- CHANGE: addGreeting (now uses a variable) ---
function addGreeting() {
  // const greetingText = '...'; // <-- REMOVED
  chat = []; // Clear
  chat.push({
    role: 'assistant',
    content: serverGreetingText, // <-- CHANGED
    ts: Date.now()
  });
  currentChatSessionId = getTimestampSessionId();
  sessionStorage.setItem(SS_SESSION_ID, currentChatSessionId);
  console.log('[Chat] New Session ID created:', currentChatSessionId);
  saveChat();
  render();
  if (promptEl) promptEl.focus();
}

// --- Save log ---
async function saveChatLog(history) {
  const hasUserMessages = history.some(m => m.role === 'user');
  if (!hasUserMessages) {
    console.log('[SaveChat] No user messages found. Skipping save.');
    return;
  }
  if (!currentChatSessionId) {
    console.warn('[SaveChat] No session ID, cannot save.');
    return;
  }
  console.log(`[SaveChat] Saving session ${currentChatSessionId}...`);
  const payload = {
    savedAt: new Date().toISOString(),
    chatSessionId: currentChatSessionId,
    messages: history
  };
  try {
    const response = await fetch('/api/save-text-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    const result = await response.json();
    if (response.ok) {
      console.log('[SaveChat] Text log updated:', result.filename);
    } else {
      console.error('[SaveChat] Server error updating log:', result.error.message);
    }
  } catch (err) {
    console.error('[SaveChat] Network error:', err.message);
  }
}

// <--- REMOVED: saveChatLogBeacon ---
// (No longer needed since 'beforeunload' was removed)

// ... (el, render, setStatus, setSending) ...
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function render() {
  logEl.innerHTML = '';
  for (const m of chat) {
    const isUser = m.role === 'user';
    const wrap = el('div', 'msg ' + (isUser ? 'user' : 'assistant'));
    if (!isUser) {
      wrap.appendChild(el('div', 'avatar', 'J'));
      const right = el('div');
      right.appendChild(el('div', 'bubble', m.content));
      right.appendChild(el('div', 'meta', new Date(m.ts).toLocaleTimeString()));
      wrap.appendChild(right);
    } else {
      wrap.appendChild(el('div', 'bubble', m.content));
    }
    logEl.appendChild(wrap);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(text, ok = false, err = false) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : err ? 'error' : '';
}
function setSending(disabled) {
  if (sendBtn) sendBtn.disabled = disabled;
  if (modelEl) modelEl.disabled = disabled;
  if (!disabled && promptEl) promptEl.focus();
}

// prevent button from stealing focus on click
sendBtn?.addEventListener('mousedown', e => e.preventDefault());

// --- SAVE (1/2): "New Chat" click ---
clearBtn?.addEventListener('click', async () => {
  // 1. First save the current chat (with the old ID)
  //await saveChatLog(chat); //
  // 2. Then start a new one (addGreeting creates a new ID)
  addGreeting();
});

// ... (toGeminiContents and other helpers) ...
function toGeminiContents(history) {
  const contents = [];
  for (const m of history) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: m.content }] });
    }
  }
  return contents;
}
async function listModelsRaw(ver = 'v1beta') {
  const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(AI_API_KEY)}&pageSize=200`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`listModels HTTP ${r.status}`);
  return r.json();
}
async function listModels(ver = 'v1beta') {
  const j = await listModelsRaw(ver);
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
}
function namesFromModels(models) { return models.map(m => (m.name || '').replace('models/', '')); }
function pickDefaultName(names) {
  const version = n => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  return names.slice().sort((a, b) => {
    const al = /latest/i.test(a) ? 0 : 1, bl = /latest/i.test(b) ? 0 : 1; if (al !== bl) return al - bl;
    const af = /flash/i.test(a) ? 0 : 1, bf = /flash/i.test(b) ? 0 : 1; if (af !== bf) return af - bf;
    const av = version(a), bv = version(b); if (av !== bv) return bv - av;
    return a.localeCompare(b);
  })[0];
}
modelEl?.addEventListener('change', () => localStorage.setItem(LS_MODEL, modelEl.value));


// ---- Send via server proxy ----
promptEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
sendBtn?.addEventListener('click', send);

async function send() {
  const text = (promptEl?.value || '').trim();
  if (!text) return;

  chat.push({ role: 'user', content: text, ts: Date.now() });
  saveChat(); render(); // Save to localStorage
  if (promptEl) { promptEl.value = ''; promptEl.focus(); }

  setSending(true);
  setStatus('Typing...');

  try {
    const payload = {
      contents: toGeminiContents(chat),
      generationConfig: { temperature: 0.7 }
    };
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    const textOut = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('').trim() || '[empty response]';

    chat.push({ role: 'assistant', content: textOut, ts: Date.now() }); //
    saveChat(); render(); // Save to localStorage
    localStorage.setItem(LS_MODEL, modelEl.value);
    setStatus('Done.', true);

    // <--- START OF CHANGE: ---
    // --- SAVE (2/2): after AI reply ---
    console.log('[SaveChat] Turn complete. Saving log...');
    saveChatLog(chat); // Save on the server
    // <--- END OF CHANGE ---

  } catch (e) {
    chat.push({ role: 'assistant', content: `Error: ${String(e.message || e)}`, ts: Date.now() });
    saveChat(); render(); setStatus('Request error.', false, true);
  } finally {
    setSending(false);
  }
}

// --- CHANGED: boot (session ID logic AND greeting loading) ---
(async () => {
  // --- NEW: load the config first (including the greeting) ---
  try {
    const modelRes = await fetch('/api/model');
    if (modelRes.ok) {
      const modelData = await modelRes.json();
      if (modelData.greetingText) {
        serverGreetingText = modelData.greetingText;
        console.log('[Boot] Greeting loaded from server.');
      } else {
        console.warn('[Boot] /api/model OK, but greetingText is missing.');
      }
    } else {
      console.warn(`[Boot] Could not fetch /api/model (HTTP ${modelRes.status}).`);
    }
  } catch (e) {
    console.warn('[Boot] Network error fetching /api/model.', e.message);
  }
  // --- END OF NEW ---

  render();
  if (promptEl) promptEl.focus();

  // 1. Try to load the ID from sessionStorage
  currentChatSessionId = sessionStorage.getItem(SS_SESSION_ID);

  if (chat.length === 0) {
    // If the chat in localStorage is EMPTY, always start a new session
    addGreeting(); // This creates a new ID
  } else if (!currentChatSessionId) {
    // If the chat is NOT empty but there is NO ID in sessionStorage
    currentChatSessionId = getTimestampSessionId();
    sessionStorage.setItem(SS_SESSION_ID, currentChatSessionId);
    console.log('[Chat] New Session ID created for existing chat:', currentChatSessionId);
  } else {
    // Chat loaded, session ID loaded.
    console.log('[Chat] Resuming Session ID:', currentChatSessionId);
  }

  setStatus('Ready.');
  if (promptEl) promptEl.focus();

  // <--- REMOVED: 'visibilitychange' and 'beforeunload' handlers ---
  // ( ... )
  // <--- END OF CHANGE ---

})();