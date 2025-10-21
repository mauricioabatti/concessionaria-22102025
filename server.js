// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,                    // ex.: wf_xxxxxx
  FALLBACK_MODEL = 'gpt-4.1-mini',
  DEBUG_LOG = '0',                // "1" => logs verbosos no console
  DEBUG_ECHO = '0',               // "1" => prefixa WF✅/WF❌/FB✅ na resposta do Whats
  FORCE_FALLBACK = '0',           // "1" => ignora workflow e usa fallback p/ testar
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('❌ Falta OPENAI_API_KEY (use chave de usuário `sk-…`, não `sk-proj-…`).');
  process.exit(1);
}
if (!WORKFLOW_ID) {
  console.error('❌ Falta WORKFLOW_ID (wf_…).');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// Em homologação, sem validar assinatura do Twilio:
const twilioWebhook = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = new Map();
const log = (...args) => { if (DEBUG_LOG === '1') console.log(...args); };

// ---------------- Helpers ----------------

function extractText(any) {
  try {
    if (!any) return '';
    if (typeof any === 'string') return any;

    // Novo formato
    if (any.output_text) return String(any.output_text);
    const c0 = any.output?.[0]?.content?.[0];
    if (c0?.text) return String(c0.text);

    return JSON.stringify(any).slice(0, 900);
  } catch {
    return '';
  }
}

function conversationIdFor(from) {
  // alguns endpoints rejeitam chars especiais — manter só [a-zA-Z0-9_-]
  const digits = (from || '').replace(/\D+/g, '');
  return `wa_${digits || 'unknown'}`;
}

/**
 * Faz a chamada ao workflow tentando diferentes endpoints.
 * Ordem de tentativas (sem `model`):
 *   1) POST /v1/workflows/{id}/runs
 *   2) POST /v1/workflows/runs  { workflow_id }
 *   3) POST /v1/run_workflow    { workflow_id }
 * Retorna { data, prefix } ou lança erro consolidado.
 */
async function runWorkflowMultiEndpoints({ userText /*, conversationId */ }) {
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // payload “oficial” de workflow (sem model; algumas contas não aceitam conversation)
  const payload = {
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
    // Se no seu tenant esse campo for aceito, você pode descomentar:
    // conversation: { id: conversationId },
  };

  const attempts = [
    {
      url: `https://api.openai.com/v1/workflows/${WORKFLOW_ID}/runs`,
      body: payload,
      label: 'runs-path',
    },
    {
      url: `https://api.openai.com/v1/workflows/runs`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
      label: 'runs-body',
    },
    {
      url: `https://api.openai.com/v1/run_workflow`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
      label: 'run_workflow',
    },
  ];

  const errors = [];

  for (const att of attempts) {
    try {
      log(`→ Tentando workflow via ${att.label}: ${att.url}`);
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
        const prefix = DEBUG_ECHO === '1'
          ? `WF✅[${att.label}/${res.status}${reqId ? `/${reqId}` : ''}] `
          : '';
        log('✅ Workflow OK', { label: att.label, status: res.status, reqId, preview: extractText(data) });
        return { data, prefix };
      } else {
        const text = await res.text();
        log('❗ FAIL', { label: att.label, status: res.status, body: text.slice(0, 500) });
        errors.push({ label: att.label, status: res.status, body: text });
      }
    } catch (e) {
      errors.push({ label: att.label, error: e?.message || String(e) });
    }
  }

  const consolidated = JSON.stringify(errors, null, 2).slice(0, 1500);
  throw new Error(`Nenhum endpoint de Workflow aceitou a chamada.\n${consolidated}`);
}

/** Fallback simples (Responses API) */
async function runFallback(userText) {
  const r = await openai.responses.create({
    model: FALLBACK_MODEL,
    input: userText,
  });
  const txt =
    r?.output_text ??
    r?.output?.[0]?.content?.[0]?.text ??
    'Certo! Pode me contar um pouco mais?';
  const prefix = DEBUG_ECHO === '1' ? 'FB✅ ' : '';
  log('↩️ Fallback OK', { preview: txt.slice(0, 200) });
  return { text: txt, prefix };
}

// ---------------- Handler ------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  const convId = conversationIdFor(from);

  log('📩 IN:', { from, userText, convId });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  try {
    let reply = '';
    let prefix = '';

    if (FORCE_FALLBACK === '1') {
      const fb = await runFallback(userText);
      reply = fb.text;
      prefix = fb.prefix;
    } else {
      try {
        const wf = await runWorkflowMultiEndpoints({
          userText,
          // conversationId: convId, // descomente se seu tenant aceitar
        });
        reply = extractText(wf.data);
        prefix = wf.prefix;
      } catch (wfErr) {
        log('⚠️ Workflow falhou. Caindo no fallback. Motivo:', wfErr?.message || wfErr);
        const fb = await runFallback(userText);
        // Se quiser ver o erro do workflow no Whats, concatene:
        // prefix = (DEBUG_ECHO === '1' ? `WF❌ ${String(wfErr?.message || wfErr).slice(0, 180)} → ` : '') + fb.prefix;
        prefix = fb.prefix;
        reply = fb.text;
      }
    }

    if (!reply?.trim()) reply = 'Certo! Pode me contar um pouco mais?';

    hist.push({ role: 'assistant', content: reply });
    sessions.set(from, hist);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message((DEBUG_ECHO === '1' ? prefix : '') + reply);
    res.type('text/xml').send(twiml.toString());

    log('📤 OUT:', { to: from, sent: reply.slice(0, 180) });
  } catch (err) {
    console.error('❌ ERRO no handler:', err?.message || err);
    const twiml = new twilio.twiml.MessagingResponse();
    const msg = (DEBUG_ECHO === '1'
      ? `ERR❌ ${String(err?.message || err).slice(0, 900)}`
      : 'Tive um probleminha agora 😅. Pode tentar novamente?');
    twiml.message(msg);
    res.type('text/xml').send(twiml.toString());
  }
});

// Health
app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://0.0.0.0:${PORT}`);
  console.log(`   DEBUG_LOG=${DEBUG_LOG} DEBUG_ECHO=${DEBUG_ECHO} FORCE_FALLBACK=${FORCE_FALLBACK}`);
});
