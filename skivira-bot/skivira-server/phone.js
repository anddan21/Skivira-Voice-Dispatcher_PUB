// phone.js - IVR module (Barge-in + 2-way switching)
const twilio = require('twilio');

const langConfig = {
  'en-US': { voice: 'Google.en-US-Chirp3-HD-Fenrir' },
  'es-ES': { voice: 'Google.es-ES-Standard-B' },
  'ru-RU': { voice: 'Google.ru-RU-Standard-B' }
};

let config = {
  greetingText: 'Hello. How can I help you?',
  turnEndpoint: '/api/phone/turn'
};

function initialize(options) {
  config.greetingText = options.greetingText || config.greetingText;
  config.turnEndpoint = options.turnEndpoint || config.turnEndpoint;
}

/**
 * STEP 1: Incoming call
 */
function handleIncomingCall() {
  const twiml = new twilio.twiml.VoiceResponse();

  // 1. Initial IVR (Only buttons for barge-in)
  const gather = twiml.gather({
    input: 'dtmf',
    numDigits: 1,
    action: '/api/phone/language-selection',
    method: 'POST',
    timeout: 1
  });

  // Phrase 1: Spanish option
  gather.say({
    language: 'es-ES',
    voice: 'Google.es-ES-Standard-B'
  }, "Para español, presione el número 2.");

  gather.pause({ length: 1 });

  // Phrase 2: English greeting
  gather.say({
    language: 'en-US',
    voice: 'Google.en-US-Chirp3-HD-Fenrir'
  }, config.greetingText);

  // --- Fallback: If nothing was pressed and speech ended ---
  // Switch to listening to VOICE + BUTTONS (so they can switch later)
  const voiceGather = twiml.gather({
    input: 'speech dtmf', // <--- Listen to BOTH voice AND buttons
    numDigits: 1,         // If they press a button - one is enough
    enhanced: 'true',
    speechTimeout: 'auto',
    action: config.turnEndpoint + '?lang=en-US', // Default English
    method: 'POST',
    language: 'en-US',
    speechModel: 'phone_call'
  });

  return twiml.toString();
}

/**
 * STEP 2: Processing the next turn (Dialogue)
 */
function handleNextTurn(aiResponseText, currentLang = 'en-US') {
  const twiml = new twilio.twiml.VoiceResponse();
  const selectedConfig = langConfig[currentLang] || langConfig['en-US'];

  const gather = twiml.gather({
    input: 'speech dtmf', // <--- IMPORTANT: Listen to voice AND buttons during dialogue
    numDigits: 1,         // Wait for 1 digit to switch language
    enhanced: 'true',
    speechTimeout: 'auto',
    timeout: 15,
    action: config.turnEndpoint + `?lang=${currentLang}`,
    method: 'POST',
    language: currentLang,
    speechModel: 'phone_call'
  });

  gather.say({
    voice: selectedConfig.voice,
    language: currentLang
  }, aiResponseText);

  twiml.redirect({ method: 'POST' }, config.turnEndpoint + `?lang=${currentLang}`);
  return twiml.toString();
}

function handleSilenceWarning(currentLang = 'en-US') {
  const twiml = new twilio.twiml.VoiceResponse();
  const selectedConfig = langConfig[currentLang] || langConfig['en-US'];

  let phrase = 'I did not hear anything. Is anyone there?';
  if (currentLang === 'es-ES') phrase = 'No escuché nada. ¿Hola?';
  if (currentLang === 'ru-RU') phrase = 'Я вас не слышу. Вы здесь?';

  const gather = twiml.gather({
    input: 'speech dtmf', // And here too we listen to buttons
    numDigits: 1,
    enhanced: 'true',
    speechTimeout: 'auto',
    action: config.turnEndpoint + `?lang=${currentLang}`,
    method: 'POST',
    language: currentLang,
    speechModel: 'phone_call'
  });

  gather.say({ voice: selectedConfig.voice, language: currentLang }, phrase);
  twiml.redirect({ method: 'POST' }, config.turnEndpoint + `?lang=${currentLang}`);
  return twiml.toString();
}

function handleFinalHangup(currentLang = 'en-US') {
  const twiml = new twilio.twiml.VoiceResponse();
  const selectedConfig = langConfig[currentLang] || langConfig['en-US'];

  let phrase = 'Goodbye.';
  if (currentLang === 'es-ES') phrase = 'Adiós.';
  if (currentLang === 'ru-RU') phrase = 'До свидания.';

  twiml.say({ voice: selectedConfig.voice, language: currentLang }, phrase);
  twiml.hangup();
  return twiml.toString();
}

module.exports = { initialize, handleIncomingCall, handleNextTurn, handleSilenceWarning, handleFinalHangup };