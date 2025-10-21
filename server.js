// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,                    // wf_...
  FALLBACK_MODEL = 'gpt-4.1-mini',
  DEBUG_LOG = '0',                // "1" para log detalhado no console (Railway)
  DEBUG_ECHO = '0',               // "1" para ecoar no WhatsApp um prefixo com resultado/erro
  FORCE_FALLBACK = '0',           // "1" ignora workflow e usa modelo fallback
} = process.env;

const log = (...args) => {
  if (String(DEBUG_LOG) === '1') {
    console.log('[DBG]', ...args);
  }
};

if (!OPENAI_API_KEY) {
  console.error('❌ Faltam variáveis: OPENAI_API_KEY.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// Em produção, ative validate:true e configure TWILIO_AUTH_TOKEN
const twilioWebhook = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const sessions = new Map();

// ---------- helpers ----------
function extractText(data) {
  try {
    if (data?.output_text) return data.output_text;
    if (Array.isArray(data?.output)) {
      const first = data.output[0];
      const text = first?.content?.[0]?.text;
      if (text) return text;
    }
    return JSON.stringify(data).slice(0, 900);
  } catch (e) {
    return 'Não consegui interpretar a resposta do agente.';
  }
}

// sanitiza e cria um conversation.id válido (somente [A-Za-z0-9_-])
function makeConversationId(reqBody) {
  const fromDigits =
    String(reqBody.WaId || '') ||
    String(reqBody.From || '').replace(/\D/g, '') ||
    String(reqBody.MessageSid || 'conv');

  const cleaned = fromDigits.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'conv';
}

/**
 * Executa o workflow via Responses API (rota suportada para Agent Builder)
 * - Necessita 'workflow_id'
 * - Usa 'conversation.id' para manter contexto
 * Retorna { json, requestId, status }
 */
async function runWorkflowWithDiagnostics({ userText, conversationId }) {
  if (!WORKFLOW_ID) throw new Error('WORKFLOW_ID não definido');

  const url = `https://api.openai.com/v1/responses`;
  const payload = {
    workflow_id: WORKFLOW_ID,
    conversation: { id: conversationId },
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
  };

  log('→ [WF] POST', url, 'payload:', JSON.stringify(payload));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const reqId = res.headers.get('x-request-id') || res.headers.get('openai-request-id') || 'n/a';
  const status = res.status;

  let bodyText;
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '<no-body>';
  }

  log('← [WF] status:', status, 'request-id:', reqId);
  if (!res.ok) {
    const shortErr = bodyText.slice(0, 800);
    log('← [WF] ERROR body:', shortErr);
    throw Object.assign(new Error(`Workflow HTTP ${status}`), {
      status,
      requestId: reqId,
      body: shortErr,
    });
  }

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = { raw: bodyText };
  }

  log('← [WF] OK body(sample):', bodyText.slice(0, 800));
  return { json, requestId: reqId, status };
}

/** chama fallback model explicitamente */
async function runFallbackLLM(userText) {
  const resp = await openai.responses.create({
    model: FALLBACK_MODEL,
    input: userText,
  });
  return (
    resp?.output_text ??
    resp?.output?.[0]?.content?.[0]?.text ??
    'Certo! Pode me contar um pouco mais?'
  );
}
// -----------------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  const conversationId = makeConversationId(req.body);

  log('📩 RX', { from, waId: req.body.WaId, conversationId, text: userText });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  let replyText = '';
  let debugPrefix = ''; // aparece no WhatsApp quando DEBUG_ECHO=1

  try {
    if (FORCE_FALLBACK === '1') {
      log('⤵️ FORCE_FALLBACK=1 → pulando workflow');
      replyText = await runFallbackLLM(userText);
      debugPrefix = 'FB✅ ';
    } else if (WORKFLOW_ID) {
      try {
        const t0 = Date.now();
        const { json, requestId, status } = await runWorkflowWithDiagnostics({
          userText,
          conversationId,
        });
        const dt = Date.now() - t0;
        replyText = extractText(json);
        debugPrefix = `WF✅ [${status}/${requestId} ${dt}ms] `;
      } catch (wfErr) {
        log('⚠️ WF FAIL →', wfErr?.message, 'reqId:', wfErr?.requestId, 'status:', wfErr?.status);
        // se quiser ecoar um pedaço do erro no WhatsApp:
        if (String(DEBUG_ECHO) === '1') {
          const errFrag = (wfErr?.body || wfErr?.message || '').slice(0, 220);
          debugPrefix = `WF❌ [${wfErr?.status || '?'} ${wfErr?.requestId || 'no-id'}] ${errFrag} → `;
        }
        // fallback
        const fb = await runFallbackLLM(userText);
        replyText = fb;
        if (!debugPrefix) debugPrefix = 'FB✅ ';
      }
    } else {
      log('ℹ️ Sem WORKFLOW_ID → fallback direto');
      replyText = await runFallbackLLM(userText);
      debugPrefix = 'FB✅ ';
    }

    if (!replyText || !replyText.trim()) {
      replyText = 'Certo! Pode me contar um pouco mais?';
    }

    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    const outMsg = (String(DEBUG_ECHO) === '1') ? (debugPrefix + replyText) : replyText;

    log('📤 TX', { to: from, size: outMsg.length, preview: outMsg.slice(0, 200) });
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(outMsg);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('❌ ERRO no processamento:', err?.message || err);
    const twiml = new twilio.twiml.MessagingResponse();
    const txt = (String(DEBUG_ECHO) === '1')
      ? ('ERR❌ ' + (err?.message || JSON.stringify(err))).slice(0, 900)
      : 'Tive um problema agora. Pode repetir a última mensagem?';
    twiml.message(txt);
    return res.type('text/xml').send(twiml.toString());
  }
});

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
  log('DEBUG_LOG=', DEBUG_LOG, 'DEBUG_ECHO=', DEBUG_ECHO, 'FORCE_FALLBACK=', FORCE_FALLBACK);
});
