// Vercel serverless function — proxies Anthropic Claude requests
// Keeps the API key server-side, fixes CORS

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI service not configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  // Extract the user message from OpenAI-style format our app sends
  const userMessage = body.messages?.find(m => m.role === 'user')?.content || '';

  // Build Anthropic-format request
  const anthropicBody = {
    model: 'claude-haiku-4-5',
    max_tokens: 1200,
    messages: [{ role: 'user', content: userMessage }],
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstream.ok) {
      console.error('Anthropic error:', upstream.status, text);
      return res.status(upstream.status).json(data);
    }

    // Convert Anthropic response → OpenAI-compatible format our app expects
    // Pass through as-is; app.js parses the structured JSON itself
    const content = (data.content?.[0]?.text || '').trim();
    return res.status(200).json({
      choices: [{ message: { role: 'assistant', content } }],
    });

  } catch (err) {
    console.error('Anthropic proxy error:', err.message);
    return res.status(502).json({ error: err.message });
  }
};
