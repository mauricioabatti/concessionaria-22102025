// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,                 // wf_....
  FALLBACK_MODEL = 'gpt-4.1-mini', // usado se os endpoints de workflow não estiverem disponíveis
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('❌ Faltam variáveis: OPENAI_API_KEY.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// Enquanto testamos, deixo sem validação de assinatura do Twilio:
const twilioWebhook = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const sessions = new Map();

// ---------- helpers ----------
function extractText(data) {
  return (
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 900)
  );
}

// sanitiza e cria um conversation.id válido (somente [A-Za-z0-9_-])
function makeConversationId(reqBody) {
  const fromDigits = String(reqBody.WaId || '')
    || String(reqBody.From || '').replace(/\D/g, '')
    || String(reqBody.MessageSid || 'conv');

  const cleaned = fromDigits.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'conv';
}

/**
 * Executa o workflow via Responses API (rota suportada para Agent Builder)
 * - Necessita 'workflow_id'
 * - Usa 'conversation.id' para manter contexto
 */
async function tryRunWorkflow(userText, conversationId) {
  if (!WORKFLOW_ID) {
    throw new Error('WORKFLOW_ID não definido');
  }

  const baseHeaders = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const payload = {
    workflow_id: WORKFLOW_ID,
    conversation: { id: conversationId }, // ← MUITO IMPORTANTE
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
  };

  const url = `https://api.openai.com/v1/responses`;
  const res = await fetch(url, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow HTTP ${res.status}: ${text}`);
  }

  return res.json();
}
// -----------------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  console.log('📩 Mensagem recebida:', { from, userText });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  try {
    let replyText = '';

    const conversationId = makeConversationId(req.body); // <<— conversa estável/valida

    if (WORKFLOW_ID) {
      try {
        const wfData = await tryRunWorkflow(userText, conversationId);
        replyText = extractText(wfData);
      } catch (wfErr) {
        console.warn('⚠️ Falhou workflow; caindo no fallback:', wfErr?.message || wfErr);
        // 🔁 Fallback: Responses API com model explícito — responde normalmente
        const resp = await openai.responses.create({
          model: FALLBACK_MODEL,
          input: userText,
        });
        replyText =
          resp?.output_text ??
          resp?.output?.[0]?.content?.[0]?.text ??
          'Certo! Pode me contar um pouco mais?';
      }
    } else {
      // Sem WORKFLOW_ID, vai direto no fallback
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
    twiml.message(
      ('DEBUG ERRO: ' + (err?.message || JSON.stringify(err))).slice(0, 900)
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
