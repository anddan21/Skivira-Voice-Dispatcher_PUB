// Skira Voice Call UI — Управляет WebRTC.js (Gemini Live)
// ТЕПЕРЬ ЭТО ES-МОДУЛЬ (с 2-х этапным запуском)

import { SkiviraLive } from './WebRTC.js';

const $ = s => document.querySelector(s);
const logEl = $('#log');
const statusEl = $('#status');
const callBtn = $('#callBtn');
const endBtn = $('#endBtn');
const ringtoneEl = $('#ringtone');

let callActive = false;
let currentCallId = 0;
let silenceTimer = null;

const SS_SESSION_ID = 'skivira_call_session_id';
let currentCallSessionId = null;

// --- Управление чатом (без изменений) ---
let chat = loadChat();
function loadChat() {
  return [];
}
function saveChat() {
  // (не используется)
}

// --- Генератор ID (без изменений) ---
function getTimestampSessionId() {
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const d = new Date();
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${Y}-${M}-${D}_${h}-${m}-${s}_call`;
}

// --- addTranscriptEntry (Сохраняет по ответу ИИ) ---
function addTranscriptEntry(entry) {
  const lastUnfinished = chat.findLast(
    (m) => m.sender === entry.sender && !m.isFinal
  );
  if (lastUnfinished) {
    lastUnfinished.text = entry.text;
    lastUnfinished.isFinal = entry.isFinal;
    lastUnfinished.ts = Date.now();
  } else {
    chat.push({
      ...entry,
      id: Date.now().toString(),
      ts: Date.now()
    });
  }
  render();

  if (!callActive) return;

  if (entry.sender === 'user') {
    console.log('[SilenceTimer] User spoke, timer cleared.');
    clearTimeout(silenceTimer);
  }
  else if (entry.sender === 'assistant' && entry.isFinal) {

    // <--- СОХРАНЕНИЕ (1/3): ПОСЛЕ ОТВЕТА ИИ ---
    console.log('[SaveChat] Turn complete. Saving log...');
    saveChatLog(chat);
    // <--- КОНЕЦ ИЗМЕНЕНИЯ ---

    console.log('[SilenceTimer] AI finished, 60s timer started...');
    clearTimeout(silenceTimer);

    silenceTimer = setTimeout(() => {
      console.warn('[SilenceTimer] 60s timeout reached. Forcing hangup.');
      addTranscriptEntry({ sender: 'system', text: 'Call ended due to inactivity.', isFinal: true });
      endCall(); // <-- endCall не сохраняет
    }, 60000);
  }
}

// --- Рендеринг (без изменений) ---
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
    const sender = m.sender || m.role;

    const wrap = el('div', 'msg ' + (sender === 'user' ? 'user' : 'assistant'));
    if (sender === 'assistant' || sender === 'system') {
      wrap.appendChild(el('div', 'avatar', sender === 'system' ? 'S' : 'J'));
      const right = el('div');
      right.appendChild(el('div', 'bubble', m.text || m.content));
      right.appendChild(el('div', 'meta', new Date(m.ts).toLocaleTimeString()));
      wrap.appendChild(right);
    } else { // User
      wrap.appendChild(el('div', 'bubble', m.text || m.content));
      wrap.appendChild(el('div', 'meta', new Date(m.ts).toLocaleTimeString()));
    }
    logEl.appendChild(wrap);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(text, ok = true, err = false) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : err ? 'error' : '';
}

// --- Функция saveChatLog (без изменений) ---
async function saveChatLog(history) {
  const hasUserMessages = history.some(m => m.sender === 'user');
  if (!hasUserMessages) {
    console.log('[SaveChat] No user messages found. Skipping save.');
    return;
  }
  if (!currentCallSessionId) {
    console.warn('[SaveChat] No session ID, cannot save.');
    return;
  }
  console.log(`[SaveChat] Saving session ${currentCallSessionId}...`);
  const payload = {
    savedAt: new Date().toISOString(),
    callId: currentCallId,
    callSessionId: currentCallSessionId,
    messages: history
  };
  try {
    const response = await fetch('/api/save-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    const result = await response.json();
    if (response.ok) {
      console.log('[SaveChat] Log successfully saved/updated:', result.filename);
    } else {
      console.error('[SaveChat] Server error while saving:', result.error.message);
    }
  } catch (err) {
    console.error('[SaveChat] Network error sending log:', err.message);
  }
}

// --- playAudioAndWait (без изменений) ---
function playAudioAndWait(audioElement) {
  if (!audioElement) {
    console.warn('Ringtone element not found.');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.onpause = null;
    };
    audioElement.onended = () => {
      cleanup();
      resolve();
    };
    audioElement.onerror = (e) => {
      cleanup();
      reject(new Error('Audio playback error'));
    };
    audioElement.onpause = () => {
      cleanup();
      resolve();
    };
    audioElement.currentTime = 0;
    audioElement.play().catch(e => {
      cleanup();
      reject(new Error('Audio play() failed: ' + e.message));
    });
  });
}

// --- Логика кнопок (Call / End) ---

async function startCall() {
  clearTimeout(silenceTimer);
  chat = [];
  render();
  if (callActive) return;
  currentCallId++;
  const thisCallId = currentCallId;
  currentCallSessionId = getTimestampSessionId();
  sessionStorage.setItem(SS_SESSION_ID, currentCallSessionId);
  console.log('[Call] New Call Session ID created:', currentCallSessionId);
  callBtn.disabled = true;
  callBtn.textContent = 'CONNECTING...';
  endBtn.disabled = false;
  try {
    setStatus('Connecting...');
    if (ringtoneEl) {
      ringtoneEl.currentTime = 0;
      ringtoneEl.loop = true;
      ringtoneEl.play();
    }
    setStatus('Connecting...');
    await SkiviraLive.generateAndPlayGreeting();
    if (thisCallId !== currentCallId) {
      console.log('Call was cancelled during greeting generation.');
      return;
    }
    setStatus('Connecting live session...');
    const success = await SkiviraLive.start();
    if (success) {
      callActive = true;
      callBtn.textContent = 'SPEAK';
      endBtn.disabled = false;
      console.log('[SilenceTimer] Greeting finished, 60s timer started...');
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        console.warn('[SilenceTimer] 60s timeout reached after greeting. Forcing hangup.');
        addTranscriptEntry({ sender: 'system', text: 'Call ended due to inactivity.', isFinal: true });
        endCall();
      }, 60000);
    } else {
      throw new Error('Failed to start live session.');
    }
  } catch (e) {
    if (ringtoneEl) {
      ringtoneEl.pause();
      ringtoneEl.loop = false;
    }
    console.error("StartCall failed:", e);
    if (thisCallId === currentCallId) {
      setStatus(e.message, false, true);
      callBtn.disabled = false;
      callBtn.textContent = 'CALL';
      endBtn.disabled = true;
    } else {
      console.warn('Supressing UI reset from an old, cancelled call.');
    }
  }
}

// --- endCall (без изменений, НЕ сохраняет) ---
function endCall() {
  if (callBtn.textContent !== 'CONNECTING...' && !callActive) {
    return;
  }
  clearTimeout(silenceTimer);
  silenceTimer = null;
  currentCallId++;
  callActive = false;
  currentCallSessionId = null;
  sessionStorage.removeItem(SS_SESSION_ID);
  if (ringtoneEl) {
    ringtoneEl.pause();
    ringtoneEl.loop = false;
  }
  SkiviraLive.stop(true);
  callBtn.disabled = false;
  callBtn.textContent = 'CALL';
  endBtn.disabled = true;
}

// ===== UI wiring =====
callBtn.onclick = startCall;

// <--- ИЗМЕНЕНО: endBtn.onclick ТЕПЕРЬ СНОВА СОХРАНЯЕТ ---
endBtn.onclick = () => {
  // 1. Добавляем сообщение о причине
  addTranscriptEntry({ sender: 'system', text: 'Connection closed by Caller.', isFinal: true });

  // <--- СОХРАНЕНИЕ (2/3): ПО НАЖАТИЮ "END" ---
  console.log('[SaveChat] "END" button pressed. Saving log...');
  saveChatLog(chat);
  // <--- КОНЕЦ ИЗМЕНЕНИЯ ---

  // 3. Завершаем звонок
  endCall();
};
// <--- КОНЕЦ ИЗМЕНЕНИЯ ---

window.callApp = {
  startNewChat() {
    endCall();
    chat = [];
    render();
  }
};

// ===== "boot" =====
(async () => {
  render();
  setStatus('Initializing SDK...');
  callBtn.disabled = true;
  endBtn && (endBtn.disabled = true);
  currentCallSessionId = sessionStorage.getItem(SS_SESSION_ID);
  if (currentCallSessionId) {
    console.log('[Call] Resuming Call Session ID:', currentCallSessionId);
  }

  const ready = await SkiviraLive.initialize({
    ringtoneEl: ringtoneEl,
    onStatus: (s, ok, err) => setStatus(s, ok, err),

    // <--- СОХРАНЕНИЕ (3/3): ПРИ ОШИБКЕ SDK ---
    onError: (e) => {
      setStatus(String(e.message || e), false, true);
      if (callActive) {
        console.error('[SaveChat] Saving log due to critical error...');
        saveChatLog(chat); // <--- Сохраняем здесь
        endCall();
      }
    },
    // <--- КОНЕЦ ИЗМЕНЕНИЯ ---

    addTranscriptEntry: addTranscriptEntry,
    onHangupRequest: null
  });

  if (ready) {
    setStatus('Ready.');
    callBtn.disabled = false;
    console.log('[App] SkiviraLive SDK is ready.');
  } else {
    setStatus('SDK failed to load. Please refresh.', false, true);
    console.error('[App] SkiviraLive SDK failed to initialize.');
  }

  // <--- УДАЛЕНЫ обработчики visibilitychange и beforeunload ---
  document.addEventListener('visibilitychange', () => {
    if (!callActive) {
      return;
    }
    if (document.hidden) {
      SkiviraLive.pauseListening();
      console.log('[App] Tab hidden, pausing stream.');
    } else {
      SkiviraLive.resumeListening();
    }
  });

})();