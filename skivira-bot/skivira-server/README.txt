# Skivira-server (v3 - Voice & Text)

This server acts as the backend for the Skivira project. It performs the following functions:

- Serves static files (HTML/CSS/JS) from the `./Public` folder
- Provides API keys and instructions for clients
- Processes requests to the Gemini API (for text chat)
- Receives and saves text and voice chat logs to the `/data/chat-logs` folder

## API Endpoints

- `GET /` → serves `./Public/index.html` (SPA routing)
- `GET /chat/` → serves `./Public/chat/index.html` (text chat)
- `GET /call/` → serves `./Public/call/index.html` (voice chat)
- `GET /api/gemini-key` → serves `AI_API_KEY` from `.env` (used on the frontend)
- `GET /api/instructions` → serves `./config/instructions/dispatcher.txt`
- `POST /api/generate` → text chat, proxy to Gemini
- `POST /api/save-chat` → saves voice call log to `.txt` (requires `callSessionId`)
- `POST /api/save-text-chat` → saves text chat log to `.txt` (requires `chatSessionId`)

## `.env` Configuration

The `.env` file must be placed next to `server.js`.

Minimum set of fields:

- `AI_API_KEY=...`
- `AI_MODEL=...`

After modifying `.env`, a restart with the `--update-env` flag is always required.

## Server Management (PM2)

The server is run via PM2 under the `anddan71` user and the `skivira-app` process in `fork` mode (single process).

All commands are executed from the project folder:

```bash
cd /var/www/skivira/skivira-server
```

### Restarting the server after updating code or `.env`

```bash
cd /var/www/skivira/skivira-server
pm2 restart skivira-app --update-env
```

### Stopping the server

```bash
cd /var/www/skivira/skivira-server
pm2 stop skivira-app
```

### Checking status and logs

```bash
pm2 list
pm2 logs skivira-app --lines 50
```

## Deployment from ZIP

The `deploy.sh` script is located in the project folder. Run it like this:

```bash
cd /var/www/skivira/skivira-server
bash deploy.sh
```

If you are already in that folder, you can simply:

```bash
bash deploy.sh
```

The script does the following:

- `npm ci` — installs dependencies from `package-lock.json`
- `pm2 restart skivira-app --update-env` — restarts the server and reloads `.env`

Last update of instructions: 2025-11-14.

## Security notes

The browser currently receives the Gemini API key from the server (`GET /api/gemini-key`) and uses that key in voice mode. For production, replace this with short-lived ephemeral tokens. Restrict the API key by allowed domain (HTTP referrer) and by quotas.
