# Skivira Voice Dispatcher

AI dispatcher for an appliance repair business that answers phone calls, web voice calls, web chat and SMS, powered by Google Gemini and Twilio.

## What it does

- **Phone line (Twilio).** Answers inbound calls, lets the caller pick a language with the keypad (1 English, 2 Spanish, 7 Russian), recognizes speech, generates replies with Gemini and speaks them back with Google voices. Supports barge-in, so the caller can interrupt.
- **Web voice call.** A browser page that talks to the Gemini Live API in real time (native audio model), with a generated spoken greeting.
- **Web text chat.** A chat page whose requests are proxied by the server to Gemini.
- **SMS.** Receives inbound SMS through a Twilio webhook and logs them.
- **Spam protection.** Rejects calls flagged by the Nomorobo add-on and blocks messages that match phrases in `config/spam-filter.txt`.
- **Configurable dispatcher.** The assistant's behavior, prices and service area / schedule are plain text files in `config/instructions/`, so a non-developer can edit them.
- **Conversation logs.** Calls, phone sessions, chats and SMS are saved as text files for review.

## Tech stack

- **Backend:** Node.js (18+), built-in `http` server, `twilio`, `ws`
- **AI:** Google Gemini API (text generation, Live API native audio, TTS)
- **Telephony:** Twilio Programmable Voice and Messaging (TwiML, speech gather, DTMF)
- **Frontend:** vanilla JavaScript, WebRTC, `@google/genai` SDK in the browser
- **Deployment:** Linux server, PM2, `deploy.sh`

## Project structure

```
skivira-bot/skivira-server/
  server.js            HTTP server, API routes, Twilio webhooks, Gemini proxy
  phone.js             IVR flow: language selection, speech gather, barge-in
  callLogger.js        Web voice call logs
  phoneLogger.js       Phone call logs
  textLogger.js        Web chat logs
  SMSLogger.js         SMS logs
  check_models.js      Lists Gemini models available to the API key
  config/
    instructions/      Dispatcher prompt, price list, ZIP codes and schedule
    spam-filter.txt    Phrases that mark a message as spam
  Public/
    call/              Web voice call UI (Gemini Live)
    chat/              Web text chat UI
  deploy.sh            Install dependencies and restart via PM2
  .env.example         Required environment variables
Idea_MASTER.txt        Product concept and architecture notes
Implementation_v3_MASTER.txt  Implementation plan and status
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/phone/incoming` | Twilio voice webhook: start of a call, spam check, IVR |
| POST | `/api/phone/language-selection` | Twilio: language chosen with the keypad |
| POST | `/api/phone/turn` | Twilio: one dialogue turn (speech in, Gemini reply out) |
| POST | `/api/sms/incoming` | Twilio SMS webhook |
| GET | `/api/model` | Model names and greeting for the voice client |
| GET | `/api/gemini-key` | API key for the browser voice client (see Security notes) |
| GET | `/api/instructions` | Dispatcher instructions |
| POST | `/api/generate` | Text chat, proxied to Gemini |
| POST | `/api/save-chat` | Save a web voice call log |
| POST | `/api/save-text-chat` | Save a web chat log |

## Getting started

```bash
cd skivira-bot/skivira-server
npm install
cp .env.example .env      # then fill in AI_API_KEY and model names
node server.js            # listens on PORT, default 5500
```

Open `http://localhost:5500/call/` for the voice call or `http://localhost:5500/chat/` for the text chat.

For the phone line, point your Twilio number's voice webhook to `https://<your-domain>/api/phone/incoming` and the messaging webhook to `https://<your-domain>/api/sms/incoming`.

## Security notes

- **Gemini key in the browser.** The web voice client connects to the Gemini Live API directly from the browser, so the server currently hands the API key to the page via `/api/gemini-key`. This is fine for a demo, but anyone who opens the page can read the key. For production this should be replaced with short-lived ephemeral tokens issued by the server, and the key should be restricted by HTTP referrer and quota in Google Cloud.
- **Twilio webhooks** are not yet validated with the `X-Twilio-Signature` header. Production use should add signature validation.
- **Personal data.** Call, chat and SMS logs contain phone numbers and transcripts. They are written to `data/chat-logs/`, which is excluded from git. In California, call recording requires consent from all parties, so the greeting should mention recording.
- **Secrets** live only in `.env`, which is excluded from git. See `.env.example`.

## Author

**Andrey Zabolotsky**, Senior Full Stack Developer
[LinkedIn](https://linkedin.com/in/andzab) · [GitHub](https://github.com/anddan21)
