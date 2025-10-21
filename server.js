// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,                       // ex: wf_abc123...
  WORKFLOW_MODEL = 'gpt-4.1-mini',   // **OBRIGATÓRIO** p/ /v1/responses + workflow_id no seu tenant
  FALLBACK_MODEL = 'gpt-4.1-mini',   // usado se o workflow falhar
  DEBUG_LOG = '0',                   // "1" para logs verbosos no console
  DEBUG_ECHO = '0',                  // "1" para prefixar no Whats (WF✅/WF❌/FB✅)
  FORCE_FALLBACK = '0',              // "1" para ignorar workflow e ir direto no fallback
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('❌ Falta OPENAI_API_KEY (use chave de usuário `sk-...`, não `sk-proj-...`).');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

// Em homologação, desative a validação de assinatura do Twilio:
const twilioWebhook = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = new Map();

const log = (...a) => { if (DEBUG_LOG === '1') console.log(...a); };

// -------- Helpers ------------------------------------------------------------

/** Extrai texto independente do formato de retorno da API nova. */
function extractText(any) {
  try {
    if (!any) return '';
    if (typeof any === 'string') return any;

    if (any.output_text) return String(any.output_text);
    // Estrutura comum em Responses API
    const c0 = any.output?.[0]?.content?.[0];
    if (c0?.text) return String(c0.text);

    return JSON.stringify(any).slice(0, 900);
  } catch {
    return '';
  }
}

/** Constrói um conversation.id válido (apenas [a-zA-Z0-9_-]) a partir do número do Whats. */
function conversationIdFor(from) {
  // from vem como "whatsapp:+55..." — vamos extrair só dígitos e prefixar "wa_"
  const digits = (from || '').replace(/\D+/g, '');
  return `wa_${digits || 'unknown'}`;
}

/** Chama o workflow via /v1/responses, com model + workflow_id + conversation.id */
async function runWorkflowWithDiagnostics({ userText, conversationId }) {
  if (!WORKFLOW_ID) {
    throw new Error('WORKFLOW_ID não definido');
  }
  const url = 'https://api.openai.com/v1/responses';

  const body = {
    model: WORKFLOW_MODEL,              // <- **ESSENCIAL** no seu tenant
    workflow_id: WORKFLOW_ID,
    // conversation é opcional, mas ajuda o Agent Builder a manter contexto
    conversation: { id: conversationId },
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

  const reqId =
    res.headers.get('x-request-id') ||
    res.headers.get('openai-organization-request-id') ||
    '';

  if (!res.ok) {
    const errText = await res.text();
    const prefix = DEBUG_ECHO === '1' ? `WF❌ [${res.status}${reqId ? `/${reqId}` : ''}] ` : '';
    log('⚠️ Workflow FAIL', { status: res.status, reqId, errText });
    throw new Error(`${prefix}${errText}`);
  }

  const data = await res.json();
  const prefix = DEBUG_ECHO === '1' ? `WF✅ [${res.status}${reqId ? `/${reqId}` : ''}] ` : '';
  log('✅ Workflow OK', { status: res.status, reqId, preview: extractText(data) });
  return { data, prefix };
}

/** Fallback para o modelo puro (Responses API) */
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
  log('↩️ Fallback OK', { preview: txt.slice(0, 160) });
  return { text: txt, prefix };
}

// -----------------------------------------------------------------------------

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  const convId = conversationIdFor(from);

  log('📩 IN:', { from, userText, convId });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  try {
    let finalText = '';
    let echoPrefix = '';

    if (FORCE_FALLBACK === '1') {
      const fb = await runFallback(userText);
      finalText = fb.text;
      echoPrefix = fb.prefix;
    } else {
      try {
        const wf = await runWorkflowWithDiagnostics({
          userText,
          conversationId: convId,
        });
        finalText = extractText(wf.data);
        echoPrefix = wf.prefix;
      } catch (wfErr) {
        // Se o workflow falhar, cai no fallback
        log('→ caindo no fallback. Motivo:', wfErr?.message || wfErr);
        const fb = await runFallback(userText);
        finalText = fb.text;
        echoPrefix = (DEBUG_ECHO === '1' ? (wfErr?.message?.slice(0, 240) + ' → ') : '') + fb.prefix + finalText;
        // Se não quiser incluir a mensagem de erro no Whats, troque pela linha abaixo:
        // echoPrefix = fb.prefix;
      }
    }

    if (!finalText || !finalText.trim()) {
      finalText = 'Certo! Pode me contar um pouco mais?';
    }

    hist.push({ role: 'assistant', content: finalText });
    sessions.set(from, hist);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message((DEBUG_ECHO === '1' ? echoPrefix : '') + finalText);
    res.type('text/xml').send(twiml.toString());

    log('📤 OUT:', { to: from, sent: finalText.slice(0, 160) });
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

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://0.0.0.0:${PORT}`);
  console.log(`   DEBUG_LOG=${DEBUG_LOG} DEBUG_ECHO=${DEBUG_ECHO} FORCE_FALLBACK=${FORCE_FALLBACK}`);
});
