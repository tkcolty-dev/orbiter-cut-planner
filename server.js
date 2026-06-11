const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '6mb' }));

// Optional AI shape identification. Enabled only when ANTHROPIC_API_KEY is set
// (e.g. via `cf set-env` or a bound GenAI marketplace service). Without it the
// endpoint reports {available:false} and the client falls back to local cleanup.
const AI_KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
app.post('/api/identify', async (req, res) => {
  try {
    if (!AI_KEY) return res.json({ available: false });
    const img = (req.body && req.body.image) || '';
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(img);
    if (!m) return res.json({ available: false, error: 'bad image' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': AI_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
            { type: 'text', text: 'This is a line-traced outline a maker wants to cut from foam. Identify the object in 2-5 words and whether it is bilaterally symmetric. Respond ONLY as JSON: {"label":"...","symmetry":"vertical"|"horizontal"|"none"}' }
          ]
        }]
      })
    });
    if (!r.ok) return res.json({ available: false, error: 'ai ' + r.status });
    const data = await r.json();
    let txt = (data.content && data.content[0] && data.content[0].text) || '{}';
    let parsed = {};
    try { parsed = JSON.parse(txt.replace(/```json|```/g, '').trim()); } catch (e) {}
    return res.json({ available: true, label: parsed.label || 'shape', symmetry: parsed.symmetry || 'none' });
  } catch (e) {
    return res.json({ available: false, error: String(e.message || e) });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Orbiter Cut Planner running on port ${PORT}`);
});
