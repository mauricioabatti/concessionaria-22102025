// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

// ----- Env -----
const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,               // wf_...
  FALLBACK_MODEL = 'gpt-4.1-mini', // usado só no fallback
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('❌ Faltam variáveis: OPENAI_API_KEY.');
  process.exit(1);
}
if (!WORKFLOW_ID) {
  console.warn('⚠️  WORKFLOW_ID não definido. Vou usar fallback com model:', FALLBACK_MODEL);
}

// ----- App -----
const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// (DEBUG) assinatura Twilio desativada enquanto testamos
const twilioWebhook = twilio.webhook({ validate: false });

// Cliente OpenAI (para o fallback)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Sessões em memória
const sessions = new Map();

// ----------- helpers -----------
async function callWorkflow(userText) {
  const url = `https://api.openai.com/v1/workflows/${WORKFLOW_ID}/runs`;
  const body = {
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Workflow HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

function extractText(data) {
  // Tenta vários formatos comuns
  return (
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 900)
  );
}
// --------------------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  console.log('📩 Mensagem recebida:', { from, userText });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  try {
    let replyText = '';

    if (WORKFLOW_ID) {
      // ✅ Caminho principal: chama seu Workflow do Agent Builder
      const data = await callWorkflow(userText);
      replyText = extractText(data);
    } else {
      // 🔁 Fallback: usa Responses API com model explícito
      const resp = await openai.responses.create({
        model: FALLBACK_MODEL,
        input: userText,
      });
      replyText =
        resp?.output_text ??
        resp?.output?.[0]?.content?.[0]?.text ??
        'Certo! Pode me contar um pouco mais?';
    }

    if (!replyText || !replyText.trim()) {
      replyText = 'Certo! Pode me contar um pouco mais?';
    }

    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    console.log('✅ Resposta enviada:', replyText);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('❌ ERRO no processamento:', err?.message || err);
    const twiml = new twilio.twiml.MessagingResponse();
    const msg =
      'DEBUG ERRO: ' +
      (err?.message
        ? err.message
        : typeof err === 'string'
        ? err
        : JSON.stringify(err)
      ).slice(0, 900);
    twiml.message(msg);
    return res.type('text/xml').send(twiml.toString());
  }
});

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
