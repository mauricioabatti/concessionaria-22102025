// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,                      // wf_...
  FALLBACK_MODEL = 'gpt-4.1-mini',
  DEBUG_LOG = '0',                  // 1 = logs verbosos no console
  DEBUG_ECHO = '1',                 // 1 = prefixa WF✅/WF❌/FB✅ no Whats
  FORCE_FALLBACK = '0',             // 1 = ignora workflow e usa fallback
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('❌ Falta OPENAI_API_KEY (use sk-..., não sk-proj-...).');
  process.exit(1);
}
if (!WORKFLOW_ID) {
  console.error('❌ Falta WORKFLOW_ID (wf_...).');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// homologação: sem validação da assinatura do Twilio
const twilioWebhook = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = new Map();
const log = (...a) => (DEBUG_LOG === '1' ? console.log(...a) : undefined);

// -------------- helpers -----------------

function extractText(obj) {
  try {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (obj.output_text) return String(obj.output_text);
    const first = obj.output?.[0]?.content?.[0];
    if (first?.text) return String(first.text);
    return JSON.stringify(obj).slice(0, 800);
  } catch {
    return '';
  }
}

function conversationIdFor(from) {
  // se quiser testar conversa persistente via API e teu tenant aceitar:
  const onlyDigits = (from || '').replace(/\D+/g, '');
  return `wa_${onlyDigits || 'unknown'}`;
}

/** Faz as tentativas de workflow e retorna { data, prefix }.
 *  Se falhar, lança erro com todos os detalhes para debug. */
async function runWorkflowMultiEndpoints({ userText /*, convId*/ }) {
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const payload = {
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
    // Se seu tenant aceitar, habilite:
    // conversation: { id: convId },
  };

  const attempts = [
    {
      label: 'runs-path',
      url: `https://api.openai.com/v1/workflows/${WORKFLOW_ID}/runs`,
      body: payload,
    },
    {
      label: 'runs-body',
      url: `https://api.openai.com/v1/workflows/runs`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
    {
      label: 'run_workflow',
      url: `https://api.openai.com/v1/run_workflow`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
  ];

  const errors = [];

  for (const att of attempts) {
    try {
      log(`→ WF try: ${att.label} ${att.url}`);
      const res = await fetch(att.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(att.body),
      });

      const reqId =
        res.headers.get('x-request-id') ||
        res.headers.get('openai-organization-request-id') ||
        '';

      if (res.ok) {
        const data = await res.json();
        const prefix =
          DEBUG_ECHO === '1'
            ? `WF✅[${att.label}/${res.status}${reqId ? `/${reqId}` : ''}] `
            : '';
        log('✅ WF OK', { label: att.label, status: res.status, reqId, preview: extractText(data) });
        return { data, prefix };
      } else {
        const text = await res.text();
        log('❗ WF FAIL', { label: att.label, status: res.status, body: text.slice(0, 600) });
        errors.push({
          label: att.label,
          status: res.status,
          reqId,
          body: text,
        });
      }
    } catch (e) {
      errors.push({
        label: att.label,
        status: 'fetch-error',
        body: e?.message || String(e),
      });
    }
  }

  // Se chegou aqui, nenhuma rota de workflow aceitou.
  const compact = JSON.stringify(errors, null, 2);
  const err = new Error(compact);
  err._failures = errors; // carregamos para compor mensagem ao WhatsApp
  throw err;
}

async function runFallback(userText) {
  const r = await openai.responses.create({
    model: FALLBACK_MODEL,
    input: userText,
  });
  const text =
    r?.output_text ??
    r?.output?.[0]?.content?.[0]?.text ??
    'Certo! Pode me contar um pouco mais?';
  const prefix = DEBUG_ECHO === '1' ? 'FB✅ ' : '';
  log('↩️ FB OK', { preview: text.slice(0, 200) });
  return { text, prefix };
}

// -------------- handler ------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  const convId = conversationIdFor(from);

  log('📩 IN', { from, userText, convId });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  let replyText = '';
  let prefix = '';
  let diagLine = ''; // linha curta de diagnóstico para mostrar no Whats

  try {
    if (FORCE_FALLBACK === '1') {
      const fb = await runFallback(userText);
      replyText = fb.text;
      prefix = fb.prefix;
    } else {
      try {
        const wf = await runWorkflowMultiEndpoints({ userText /*, convId*/ });
        replyText = extractText(wf.data) || 'Tudo certo! Pode me contar mais?';
        prefix = wf.prefix;
      } catch (wfErr) {
        // Monta uma linha curta de diagnóstico WF❌ para aparecer no Whats
        let first = '';
        if (wfErr?._failures?.length) {
          const f = wfErr._failures[0];
          const status = f.status || '';
          const label = f.label || '';
          let msg = '';
          try {
            const parsed = JSON.parse(f.body);
            msg =
              parsed?.error?.message ||
              parsed?.message ||
              f.body;
          } catch {
            msg = f.body || String(wfErr.message || wfErr);
          }
          msg = String(msg).replace(/\s+/g, ' ').slice(0, 280);
          first = `WF❌[${status}/${label}] ${msg}`;
        } else {
          first = `WF❌ ${String(wfErr.message || wfErr).slice(0, 280)}`;
        }
        diagLine = DEBUG_ECHO === '1' ? `${first}\n` : '';

        // Cai no fallback
        const fb = await runFallback(userText);
        replyText = fb.text;
        prefix = fb.prefix;
      }
    }

    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`${diagLine}${prefix}${replyText}`);
    res.type('text/xml').send(twiml.toString());

    log('📤 OUT', { to: from, sentPreview: replyText.slice(0, 200) });
  } catch (err) {
    console.error('❌ Handler error', err?.message || err);
    const twiml = new twilio.twiml.MessagingResponse();
    const msg =
      DEBUG_ECHO === '1'
        ? `ERR❌ ${String(err?.message || err).slice(0, 800)}`
        : 'Tive um probleminha agora 😅. Pode tentar de novo?';
    twiml.message(msg);
    res.type('text/xml').send(twiml.toString());
  }
});

// health
app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://0.0.0.0:${PORT}`);
  console.log(`   DEBUG_LOG=${DEBUG_LOG} DEBUG_ECHO=${DEBUG_ECHO} FORCE_FALLBACK=${FORCE_FALLBACK}`);
});

