// Vercel serverless handler for /api/chat
// Uses environment variables: CHATBASE_API_KEY, CHATBASE_CHATBOT_ID, OPENAI_API_KEY, AI_PROVIDER

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are an AI Help Desk assistant. Help politely and concisely.';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

    const body = req.body || {};
    const message = body.message;
    const sessionId = body.sessionId || 'default';

    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

    const AI_PROVIDER = (process.env.AI_PROVIDER || 'chatbase').toLowerCase();
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY;
    const CHATBASE_CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    // Build a minimal messages array (stateless serverless handler)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message }
    ];

    if (AI_PROVIDER === 'openai') {
      if (!OPENAI_KEY) return res.status(500).json({ error: 'server missing OPENAI_API_KEY' });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 512, temperature: 0.2 })
      });
      const text = await resp.text();
      if (!resp.ok) return res.status(502).json({ error: 'openai error', details: text });
      const data = JSON.parse(text);
      const assistant = data.choices?.[0]?.message?.content || null;
      return res.json({ reply: assistant });
    }

    // Default: Chatbase documented API
    if (!CHATBASE_API_KEY) return res.status(500).json({ error: 'server missing CHATBASE_API_KEY' });

    const CHATBASE_MODEL = process.env.CHATBASE_MODEL || 'gpt-4o';
    const CHATBASE_TEMPERATURE = typeof process.env.CHATBASE_TEMPERATURE !== 'undefined' ? parseFloat(process.env.CHATBASE_TEMPERATURE) : 0.7;

    try {
      const url = (process.env.CHATBASE_BASE_URL || 'https://www.chatbase.co').replace(/\/+$/, '') + '/api/v1/chat';
      const options = {
        method: 'POST',
        headers: { Authorization: `Bearer ${CHATBASE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatbotId: CHATBASE_CHATBOT_ID,
          messages,
          conversationId: sessionId,
          contactId: sessionId,
          model: CHATBASE_MODEL,
          temperature: CHATBASE_TEMPERATURE,
          stream: false
        })
      };

      const resp = await fetch(url, options);
      const raw = await resp.text();
      if (!resp.ok) {
        let details;
        try { details = JSON.parse(raw); } catch (e) { details = raw; }
        // fallback to OpenAI if configured
        if (OPENAI_KEY) {
          const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 512, temperature: 0.2 })
          });
          const text2 = await resp2.text();
          if (!resp2.ok) return res.status(502).json({ error: 'chatbase failed; openai fallback failed', details, openai: text2 });
          const data2 = JSON.parse(text2);
          const assistant2 = data2.choices?.[0]?.message?.content || null;
          return res.json({ reply: assistant2, fallback: 'openai' });
        }
        return res.status(502).json({ error: 'chatbase failed', details });
      }

      const data = JSON.parse(raw);
      const assistant = data?.text || null;
      return res.json({ reply: assistant, provider: 'chatbase' });
    } catch (err) {
      console.error('Chatbase request error:', err);
      // Try OpenAI fallback if configured
      if (OPENAI_KEY) {
        try {
          const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 512, temperature: 0.2 })
          });
          const text2 = await resp2.text();
          if (!resp2.ok) return res.status(502).json({ error: 'openai fallback failed', details: text2 });
          const data2 = JSON.parse(text2);
          const assistant2 = data2.choices?.[0]?.message?.content || null;
          return res.json({ reply: assistant2, fallback: 'openai' });
        } catch (err2) {
          console.error('OpenAI fallback error:', err2);
          return res.status(502).json({ error: 'chatbase error and openai fallback error', details: String(err2) });
        }
      }
      return res.status(500).json({ error: 'chatbase request error', details: String(err) });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error', details: String(err) });
  }
};
