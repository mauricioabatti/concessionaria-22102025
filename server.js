// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

// ----- Env -----
const {
  PORT = 3000,
  TWILIO_AUTH_TOKEN, // Mantemos para futura validação
  OPENAI_API_KEY,
  WORKFLOW_ID,
} = process.env;

if (!OPENAI_API_KEY || !WORKFLOW_ID) {
  console.error('❌ Faltam variáveis: OPENAI_API_KEY e/ou WORKFLOW_ID.');
  process.exit(1);
}

// ----- App -----
const app = express();
app.set('trust proxy', true); // útil atrás de proxy (Railway)

// Twilio envia application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// (DEBUG) Desativar validação de assinatura do Twilio por enquanto.
// Depois que tudo estiver OK, troque para validate:true e configure corretamente.
const twilioWebhook = twilio.webhook({ validate: false });

// OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Sessões em memória (apenas para manter o histórico durante o processo)
const sessions = new Map(); // key = From (usuário)

// ----- Rotas -----
app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  try {
    const from = req.body.From || '';
    const userText = (req.body.Body || '').trim();

    console.log('📩 Mensagem recebida:', { from, userText });

    const hist = sessions.get(from) ?? [];
    hist.push({ role: 'user', content: userText });

    // Chamada ao workflow do Agent Builder (Responses API)
    const resp = await openai.responses.create({
      workflow_id: WORKFLOW_ID,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }],
        },
      ],
    });

    // Tentar extrair texto da resposta em diferentes formatos
    let replyText =
      resp?.output_text ??
      resp?.output?.[0]?.content?.[0]?.text ??
      (typeof resp === 'string' ? resp : JSON.stringify(resp).slice(0, 900));

    if (!replyText || replyText.trim().length === 0) {
      replyText = 'Certo! Pode me contar um pouco mais?';
    }

    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    console.log('✅ Resposta enviada:', replyText);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    const payload = err?.response?.data ?? err?.data ?? err?.message ?? err;
    console.error('❌ ERRO OpenAI/Workflow:', payload);

    // Envia o erro de forma truncada no WhatsApp para debug
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      'DEBUG ERRO: ' +
        (typeof payload === 'string' ? payload : JSON.stringify(payload)).slice(0, 900)
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

// Healthchecks / Debug
app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

// ----- Start -----
app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
