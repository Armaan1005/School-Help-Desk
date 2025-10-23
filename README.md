# Help Desk V2

Lightweight help desk landing site with a small Express proxy that forwards chat requests to Chatbase (with optional OpenAI fallback).

This repo contains a static front-end and a simple Node/Express server that exposes an API endpoint at `/api/chat` used by the client to interact with an AI provider without exposing secrets in the browser.

## Quick start (local)

1. Install dependencies

```powershell
npm install
```

2. Create a `.env` file in the project root (example):

```
AI_PROVIDER=chatbase
CHATBASE_API_KEY=your-chatbase-key
CHATBASE_CHATBOT_ID=your-chatbot-id
# Optional fallback
OPENAI_API_KEY=your-openai-key
PORT=3000
```

3. Start the server

```powershell
npm start
```

Open `http://localhost:3000/cr7.html` in your browser.

## Deploy to Vercel

This project includes `vercel.json` for a straightforward deployment to Vercel.

1. Install the Vercel CLI (optional):

```powershell
npm i -g vercel
```

2. From the project root run:

```powershell
vercel --prod
```

3. Configure environment variables in the Vercel dashboard (Project Settings -> Environment Variables):

- `AI_PROVIDER` = `chatbase`
- `CHATBASE_API_KEY`
- `CHATBASE_CHATBOT_ID`
- `OPENAI_API_KEY` (optional)

Notes

- `.env` is listed in `.gitignore` to avoid committing secrets. Use Vercel environment variables for production.
- The server relies on global `fetch` (Node 18+). If you select an older Node runtime on Vercel, ensure `node-fetch` is available.

## Files

- `server.js` — Express server and `/api/chat` handler
- `cr7.html`, `chat.html`, `submit-ticket.html`, `in-person-support.html` — frontend pages
- `vercel.json` — Vercel build & route configuration
- `.gitignore` — ignores `node_modules` and `.env`

## Session and persistence

- The server keeps short-lived session history in memory (lost on restart). For durable sessions, connect a database (Redis, etc.).

## License

MIT
