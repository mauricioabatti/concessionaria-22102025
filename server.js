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

/**
 * Tenta executar o workflow em diferentes endpoints que existem hoje
 * em tenants/versões diferentes da API. Se todos falharem, lança erro.
 */
async function tryRunWorkflow(userText) {
  if (!WORKFLOW_ID) {
    throw new Error('WORKFLOW_ID não definido');
  }

  const baseHeaders = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // payload padrão do Agent Builder (input_text)
  const payload = {
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
  };

  // Lista de tentativas (endpoint + body) — algumas contas têm somente uma das rotas.
  const attempts = [
    // 1) /v1/workflows/{id}/runs
    {
      url: `https://api.openai.com/v1/workflows/${WORKFLOW_ID}/runs`,
      body: payload,
    },
    // 2) /v1/workflows/runs (workflow_id no corpo)
    {
      url: `https://api.openai.com/v1/workflows/runs`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
    // 3) /v1/run_workflow (workflow_id no corpo) — algumas contas bêta usam esse
    {
      url: `https://api.openai.com/v1/run_workflow`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
    // 4) Responses API com workflow_id — em algumas versões funciona,
    //    mas geralmente exige model; deixo sem model só para tentativa:
    {
      url: `https://api.openai.com/v1/responses`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(attempt.body),
      });

      if (res.ok) {
        return res.json();
      }

      const text = await res.text();
      errors.push({ urlTried: attempt.url, status: res.status, response: text });
    } catch (e) {
      errors.push({ urlTried: attempt.url, error: e?.message || String(e) });
    }
  }

  // Se chegou aqui, nenhuma rota de workflow funcionou
  const detail = JSON.stringify(errors, null, 2).slice(0, 1500);
  throw new Error(`Nenhum endpoint de Workflow aceitou a chamada.\nTentativas:\n${detail}`);
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

    if (WORKFLOW_ID) {
      try {
        const wfData = await tryRunWorkflow(userText);
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
