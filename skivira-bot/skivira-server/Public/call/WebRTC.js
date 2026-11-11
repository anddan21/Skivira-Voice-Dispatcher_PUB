// WebRTC.js - Клиентская логика для Gemini Live API (ai.live.connect)
// ТЕПЕРЬ ЭТО ES-МОДУЛЬ (с 2-х этапным запуском)

import { GoogleGenAI, Modality } from "@google/genai";

const Live = {};

// --- Глобальные переменные ---
let ai; // Инициализируется один раз
let apiKey; // Храним ключ
let systemInstructionText; // Храним инструкции
let liveModelName; // Имя Live модели из .env
let ttsModelName; // Имя TTS модели из .env
let greetingText; // Greeting text from .env
let ttsVoiceName; // Voice name from .env

// --- Constants ---
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const OUTPUT_CHANNELS = 1;

// --- State variables ---
let session = null;
let mediaStream = null;
let inputAudioContext = null;
let scriptProcessor = null;
let mediaStreamSource = null;

let outputAudioContext = null;
let outputNode = null;
let nextStartTime = 0;
const sources = new Set();
let isPaused = false;
let ringtoneAudioElement = null; // <-- 1. VARIABLE FOR RINGTONE

// --- Callbacks (will be set on initialize) ---
let onUser, onModel, onStatus, onError, addTranscriptEntry;

// --- Encoding/decoding functions (from gemini.ts) ---
function encode(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- SAFE DECODING FUNCTION ---
async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  // Check if audio context is 'alive'.
  if (!ctx || ctx.state === 'closed') {
    console.warn('decodeAudioData called with null or closed context.');
    return null; // Return null instead of crashing
  }

  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
// --- END OF FUNCTION ---

// --- Audio functions (from gemini.ts) ---
function createPcmBlob(data) {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
  };
}

function initializeOutputAudio() {
  if (!outputAudioContext) {
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: OUTPUT_SAMPLE_RATE,
    });
    outputNode = outputAudioContext.createGain();
    outputNode.connect(outputAudioContext.destination);
    console.log('[Audio] Output context initialized');
  }
}

// --- Public interface ---

// 1. INITIALIZATION (called on app.js load)
Live.initialize = async (opts = {}) => {
  // Assign callbacks IMMEDIATELY
  onUser = opts.onUser;
  onModel = opts.onModel;
  onStatus = opts.onStatus;
  onError = opts.onError;
  addTranscriptEntry = opts.addTranscriptEntry;
  ringtoneAudioElement = opts.ringtoneEl; // <-- 2. SAVE RINGTONE

  try {
    const [keyRes, instrRes, modelRes] = await Promise.all([
      fetch('/api/gemini-key'),
      fetch('/api/instructions'),
      fetch('/api/model') // <-- Request models from server
    ]);

    if (!keyRes.ok) throw new Error('Failed to retrieve API key.');
    if (!instrRes.ok) throw new Error('Failed to load instructions.');
    if (!modelRes.ok) throw new Error('Failed to load models.'); // <-- Check

    const keyData = await keyRes.json();
    const modelData = await modelRes.json(); // <-- Get JSON of models

    apiKey = keyData.key;
    systemInstructionText = await instrRes.text();

    // <-- Save ALL names to global variables
    liveModelName = modelData.liveModel;
    ttsModelName = modelData.ttsModel;
    greetingText = modelData.greetingText; // <-- Save greeting
    ttsVoiceName = modelData.voiceName;   // <-- Save voice name

    // <--- FIX: Check ALL variables ---
    if (!liveModelName || !ttsModelName || !ttsVoiceName || !greetingText) {
      console.error('Missing config from server:', modelData);
      throw new Error('Server did not provide required model/voice/greeting config.');
    }
    // <--- END OF FIX ---

    // Initialize AI SDK
    ai = new GoogleGenAI({ apiKey: apiKey });
    // Initialize audio output
    initializeOutputAudio();

    console.log(`[Live] SDK initialized (Live: ${liveModelName}, TTS: ${ttsModelName}, Voice: ${ttsVoiceName})`);
    return true;
  } catch (e) {
    console.error('[Live] SDK Initialization failed:', e);
    if (onError) onError(e); // Use callback
    return false;
  }
};

// 2. GENERATE GREETING
Live.generateAndPlayGreeting = async () => {
  initializeOutputAudio();

  if (!ai || !outputAudioContext || !outputNode) {
    throw new Error("Audio context not initialized. Call initialize() first.");
  }

  if (!ttsModelName || !ttsVoiceName || !greetingText) {
    throw new Error("TTS Model, Voice Name, or Greeting Text not loaded. Call initialize() first.");
  }

  try {
    const response = await ai.models.generateContent({
      model: ttsModelName,
      contents: [{ parts: [{ text: greetingText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: ttsVoiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("Failed to generate greeting audio.");
    }

    const audioBuffer = await decodeAudioData(
      decode(base64Audio),
      outputAudioContext,
      OUTPUT_SAMPLE_RATE,
      OUTPUT_CHANNELS
    );

    if (!audioBuffer) {
      console.warn('Greeting audio decoding cancelled (context closed).');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (ringtoneAudioElement) {
        ringtoneAudioElement.pause();
        ringtoneAudioElement.loop = false;
      }

      addTranscriptEntry({ sender: 'assistant', text: greetingText, isFinal: true });

      const source = outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputNode);
      source.onended = () => resolve(); // Notify when audio ends
      source.onerror = (e) => reject(new Error("Audio playback failed"));
      source.start();
    });
  } catch (e) {
    console.error("Error generating/playing greeting:", e);
    addTranscriptEntry({ sender: 'system', text: 'Failed to generate greeting.', isFinal: true });
    if (onError) onError(e);
    throw e; // <-- IMPORTANT: Throw error so app.js can catch it
  }
};


// 3. START LIVE SESSION
Live.start = async function () {

  initializeOutputAudio();

  if (!liveModelName || !ttsVoiceName) {
    throw new Error("Live Model or Voice Name not loaded. Call initialize() first.");
  }

  try {
    let currentInputTranscription = '';
    let currentOutputTranscription = '';

    session = await ai.live.connect({
      model: liveModelName,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: ttsVoiceName },
          },
        },
        systemInstruction: systemInstructionText,
      },
      callbacks: {
        onopen: () => {
          onStatus('Connected');
        },
        onmessage: async (message) => {

          // (Live transcript logic)
          if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            currentInputTranscription += text;
            addTranscriptEntry({ sender: 'user', text: currentInputTranscription, isFinal: false });
          }
          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            currentOutputTranscription += text;
            addTranscriptEntry({ sender: 'assistant', text: currentOutputTranscription, isFinal: false });
          }

          if (message.serverContent?.turnComplete) {
            if (currentInputTranscription) {
              addTranscriptEntry({ sender: 'user', text: currentInputTranscription, isFinal: true });
              currentInputTranscription = '';
            }
            if (currentOutputTranscription) {
              addTranscriptEntry({ sender: 'assistant', text: currentOutputTranscription, isFinal: true });
              currentOutputTranscription = '';
            }
          }

          // (Audio processing)
          const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64EncodedAudioString && outputAudioContext && outputNode) {
            nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);

            const audioBuffer = await decodeAudioData(
              decode(base64EncodedAudioString),
              outputAudioContext,
              OUTPUT_SAMPLE_RATE,
              OUTPUT_CHANNELS,
            );

            if (audioBuffer) {
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.addEventListener('ended', () => sources.delete(source));
              source.start(nextStartTime);
              nextStartTime = nextStartTime + audioBuffer.duration;
              sources.add(source);
            }
          }
          if (message.serverContent?.interrupted) {
            for (const source of sources.values()) {
              source.stop();
              sources.delete(source);
            }
            nextStartTime = 0;
          }
        },
        onclose: () => {
          Live.stop(); // Start full cleanup
        },
        onerror: (e) => {
          console.error("Session error:", e);
          onError(new Error(e.message || 'Unknown session error.'));
          addTranscriptEntry({ sender: 'system', text: `Error: ${e.message}`, isFinal: true });
          Live.stop(); // Start full cleanup
        },
      },
    });

    // 5. Start microphone
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser does not support the MediaDevices API.');
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
    mediaStreamSource = inputAudioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
      const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData);
      if (session) {
        session.sendRealtimeInput({ media: pcmBlob });
      }
    };

    mediaStreamSource.connect(scriptProcessor);

    // --- Echo/silence fix (remains) ---
    const muteNode = inputAudioContext.createGain();
    muteNode.gain.setValueAtTime(0, inputAudioContext.currentTime);
    scriptProcessor.connect(muteNode);
    muteNode.connect(inputAudioContext.destination);
    // --- End of fix ---

    return true; // Success

  } catch (err) {
    console.error('Failed to start session:', err);
    onError(err);
    onStatus('Connection error.', false, true);
    await Live.stop(); // Cleanup in case of failure
    return false;
  }
};

// 4. STOP
Live.stop = async function () {
  if (session) {
    session.close();
    session = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (mediaStreamSource) {
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }
  if (inputAudioContext && inputAudioContext.state !== 'closed') {
    try { await inputAudioContext.close(); } catch { }
    inputAudioContext = null;
  }

  if (outputAudioContext && outputAudioContext.state !== 'closed') {
    try { await outputAudioContext.close(); } catch { }
  }
  outputAudioContext = null;
  outputNode = null;

  nextStartTime = 0;
  sources.clear();

  isPaused = false;

  if (onStatus) onStatus('Disconnected.');
};

// --- NEW PAUSE / RESUME FUNCTIONS ---

Live.pauseListening = function () {
  // Do nothing if already paused or no call
  if (isPaused || !session) return;
  isPaused = true;
  console.log('[Live] Pausing listening and output...');

  if (mediaStreamSource && scriptProcessor) {
    mediaStreamSource.disconnect(scriptProcessor);
  }

  if (outputNode && outputAudioContext) {
    outputNode.gain.setValueAtTime(0, outputAudioContext.currentTime);
  }
};

Live.resumeListening = function () {
  // Do nothing if not paused
  if (!isPaused || !session) return;
  isPaused = false;
  console.log('[Live] Resuming listening and output...');

  if (mediaStreamSource && scriptProcessor) {
    mediaStreamSource.connect(scriptProcessor);
  }

  if (outputNode && outputAudioContext) {
    outputNode.gain.setValueAtTime(1, outputAudioContext.currentTime);
  }
};

// --- END OF NEW FUNCTIONS ---

// Export Live so app.js can import it
export const SkiviraLive = Live;