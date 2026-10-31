const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/* ===================== AI PROXY (opcional) ===================== */
/* Configure as variáveis de ambiente para habilitar a análise generativa:      */
/*   AI_API_KEY=sk-...                                                          */
/*   AI_BASE_URL=https://api.openai.com/v1   (ou Groq/Gemini/OpenRouter/Ollama) */
/*   AI_MODEL=gpt-4o-mini                                                       */
/* A chave fica apenas no servidor, nunca no navegador.                         */
const AI_BASE_URL = String(process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = String(process.env.AI_MODEL || 'gpt-4o-mini');
const AI_API_KEY = String(process.env.AI_API_KEY || '');
const AI_TIMEOUT = Number(process.env.AI_TIMEOUT || 60000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJson(req, limit) {
  const max = limit || 2000000;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function extractAIText(data) {
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content.map(part => (typeof part === 'string' ? part : part && part.text) || '').join('');
    if (joined.trim()) return joined.trim();
  }
  return '';
}

async function handleAI(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/ai/status') {
    return sendJson(res, 200, {
      enabled: !!AI_API_KEY,
      model: AI_MODEL,
      baseUrl: AI_BASE_URL
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/api/ai') {
    return sendJson(res, 404, { error: 'Rota de IA não encontrada.' });
  }

  if (!AI_API_KEY) {
    return sendJson(res, 503, {
      error: 'Servidor sem chave de IA. Defina AI_API_KEY no ambiente para habilitar a análise generativa. A análise local continua funcionando no navegador.'
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJson(res, 400, { error: 'Envie um array "messages" no formato OpenAI.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT);

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: body.messages,
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.5,
        max_tokens: 1100
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const raw = await response.text();

    if (!response.ok) {
      return sendJson(res, 502, {
        error: `Provedor de IA respondeu ${response.status}.`,
        detail: raw.slice(0, 500)
      });
    }

    let data;
    try { data = JSON.parse(raw); } catch (err) {
      return sendJson(res, 502, { error: 'O provedor devolveu uma resposta inválida.' });
    }

    const text = extractAIText(data);
    if (!text) return sendJson(res, 502, { error: 'O provedor respondeu sem conteúdo.' });
    return sendJson(res, 200, { text });
  } catch (err) {
    clearTimeout(timeout);
    if (err && err.name === 'AbortError') {
      return sendJson(res, 504, { error: 'O provedor de IA demorou demais para responder.' });
    }
    return sendJson(res, 502, { error: 'Falha ao consultar o provedor de IA.', detail: String(err && err.message || err).slice(0, 300) });
  }
}

/* ===================== STATIC SERVER ===================== */
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/ai')) {
    handleAI(req, res).catch(err => sendJson(res, 500, { error: 'Erro interno no proxy de IA.' }));
    return;
  }

  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  let filePath = path.join(ROOT, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\nSystem Training Protocol: http://localhost:${PORT}`);
  console.log(AI_API_KEY
    ? `IA generativa habilitada no servidor (${AI_MODEL}).`
    : 'IA generativa desabilitada no servidor (defina AI_API_KEY para habilitar). Análise local ativa.');
  console.log('');
});
