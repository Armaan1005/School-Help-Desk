// Simple Express proxy to forward chat requests to OpenAI (or other AI provider)
// Usage: set OPENAI_API_KEY in environment or create a .env file with OPENAI_API_KEY=...
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
// Use the global fetch available in Node 18+ (avoid requiring node-fetch which is an ESM-only module)

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory sessions store (sessionId -> message history array)
const sessions = new Map();

// Debug: print which provider is selected and whether keys are present (masked)
function maskKey(k){ if (!k) return '(missing)'; try { return k.slice(0,4) + '...' + k.slice(-4); } catch(e){ return '(set)'; } }
console.log('AI_PROVIDER:', process.env.AI_PROVIDER || '(unset)');
// Show which key is set for the active provider (masked)
const activeProvider = (process.env.AI_PROVIDER || '').toLowerCase();
let activeKeyName = 'CHATBASE_API_KEY';
if (activeProvider === 'openai') activeKeyName = 'OPENAI_API_KEY';
if (activeProvider === 'chatbase') activeKeyName = 'CHATBASE_API_KEY';
console.log(activeKeyName + ':', maskKey(process.env[activeKeyName]));

// Serve static files from project root so chat.html loads from same origin
app.use(express.static(__dirname));

// Serve the homepage at root for convenience
app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'cr7.html'));
});

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro';

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are an AI Help Desk assistant. Your goal is to help users with their technical issues. Be concise, helpful, and polite. Provide clear, step-by-step instructions and include links to resources when appropriate.';

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
    const sid = sessionId || 'default';

    // Ensure session exists and has a system prompt
    if (!sessions.has(sid)) {
      sessions.set(sid, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }
    const history = sessions.get(sid);

    // Append the user message to history
    history.push({ role: 'user', content: message });

    if (AI_PROVIDER === 'openai') {
      if (!OPENAI_KEY) return res.status(500).json({ error: 'server missing OPENAI_API_KEY' });
      // Forward the full conversation history to OpenAI Chat Completions API
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: history.map(h => ({ role: h.role, content: h.content })),
          max_tokens: 512,
          temperature: 0.2
        })
      });

      if (!resp.ok) {
        const t = await resp.text();
        return res.status(502).json({ error: 'upstream error', details: t });
      }
      const data = await resp.json();
      const assistant = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return res.json({ reply: assistant || 'No reply from AI.' });
    }

    if (AI_PROVIDER === 'chatbase') {
      const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY;
      if (!CHATBASE_API_KEY) return res.status(500).json({ error: 'server missing CHATBASE_API_KEY' });

      // Documented Chatbase API
      const messages = history.map(h => ({ role: h.role, content: h.content }));
      const CHATBASE_CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;
      const documentedUrl = (process.env.CHATBASE_BASE_URL && process.env.CHATBASE_BASE_URL.replace(/\/+$/, '')) || 'https://www.chatbase.co';
      const documentedEndpoint = documentedUrl + '/api/v1/chat';

      try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${CHATBASE_API_KEY}` };
        // Build Chatbase payload to follow the documented/curl example provided by the user
        const CHATBASE_MODEL = process.env.CHATBASE_MODEL || 'gpt-4o';
        const CHATBASE_TEMPERATURE = typeof process.env.CHATBASE_TEMPERATURE !== 'undefined' ? parseFloat(process.env.CHATBASE_TEMPERATURE) : 0.7;
        const conversationId = sid; // use session id as conversation id
        const contactId = sid; // use session id as contact id unless a different mapping is desired

        const bodyObj = {
          chatbotId: CHATBASE_CHATBOT_ID,
          messages,
          conversationId,
          contactId,
          model: CHATBASE_MODEL,
          temperature: CHATBASE_TEMPERATURE,
          stream: false
        };

        // Use the exact fetch shape provided by the user (curl -> JS fetch)
        const url = documentedEndpoint;
        const options = {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CHATBASE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chatbotId: CHATBASE_CHATBOT_ID,
            messages,
            conversationId: conversationId,
            contactId: contactId,
            model: CHATBASE_MODEL,
            temperature: CHATBASE_TEMPERATURE,
            stream: false
          })
        };

        const resp = await fetch(url, options);
        const raw = await resp.text();
        console.log(`Primary Chatbase attempt to ${url}: status=${resp.status}`);
        console.log('Primary response snippet:', raw && raw.substring ? raw.substring(0, 2000) : raw);
        if (!resp.ok) {
          let details;
          try { details = JSON.parse(raw); } catch (e) { details = raw; }
          // Fallback to OpenAI if available
          if (OPENAI_KEY) {
            const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`,
              },
              body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: history.map(h => ({ role: h.role, content: h.content })),
                max_tokens: 512,
                temperature: 0.2
              })
            });
            const text = await resp2.text();
            if (!resp2.ok) {
              let details2;
              try { details2 = JSON.parse(text); } catch (e) { details2 = text; }
              return res.status(502).json({ error: 'chatbase failed; openai fallback failed', details, openai: details2 });
            }
            const data2 = await resp2.json();
            const assistant2 = data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content;
            history.push({ role: 'assistant', content: assistant2 });
            return res.json({ reply: assistant2, diagnostics: [{ endpoint: documentedEndpoint, status: resp.status, body: raw }], fallback: 'openai' });
          }
          return res.status(502).json({ error: 'documented chatbase failed', details });
        }
        const data = JSON.parse(raw);
        const assistant = data && data.text;
        history.push({ role: 'assistant', content: assistant });
        return res.json({ reply: assistant, diagnostics: [{ endpoint: documentedEndpoint, status: resp.status, body: raw, used: 'documented' }] });
      } catch (err) {
        console.error('Documented Chatbase request error:', err);
        if (OPENAI_KEY) {
          try {
            const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`,
              },
              body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: history.map(h => ({ role: h.role, content: h.content })),
                max_tokens: 512,
                temperature: 0.2
              })
            });
            const text = await resp2.text();
            if (!resp2.ok) {
              let details2;
              try { details2 = JSON.parse(text); } catch (e) { details2 = text; }
              return res.status(502).json({ error: 'documented chatbase error; openai fallback failed', openai: details2 });
            }
            const data2 = await resp2.json();
            const assistant2 = data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content;
            history.push({ role: 'assistant', content: assistant2 });
            return res.json({ reply: assistant2, fallback: 'openai' });
          } catch (err) {
            console.error('OpenAI fallback error:', err);
            return res.status(502).json({ error: 'documented chatbase error and openai fallback error', details: String(err) });
          }
        }
        return res.status(500).json({ error: 'documented chatbase request error', details: String(err) });
      }
    }

    return res.status(500).json({ error: 'unsupported AI_PROVIDER' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error', details: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dev server listening at http://localhost:${PORT}/`);
});
