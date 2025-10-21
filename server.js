import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  TWILIO_AUTH_TOKEN,
  OPENAI_API_KEY,
  WORKFLOW_ID
} = process.env;

if (!TWILIO_AUTH_TOKEN || !OPENAI_API_KEY || !WORKFLOW_ID) {
  console.error('❌ Configure TWILIO_AUTH_TOKEN, OPENAI_API_KEY e WORKFLOW_ID (.env local ou Variables no Railway).');
  process.exit(1);
}

const app = express();

// Twilio envia application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Validação de assinatura do Twilio (requer HTTPS em produção – Railway fornece)
const twilioWebhook = twilio.webhook({ validate: true, protocol: 'https' });

// Cliente OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Sessão em memória (teste). Em produção use Redis ou DB.
const sessions = new Map(); // key = From (usuário); value = array de mensagens

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  try {
    // Chama o workflow do Agent Builder
    const resp = await openai.responses.create({
      workflow_id: WORKFLOW_ID,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }]
        }
      ]
    });

    let replyText = '';
    if (resp?.output_text) {
      replyText = resp.output_text;
    } else if (resp?.output?.[0]?.content?.[0]?.text) {
      replyText = resp.output[0].content[0].text;
    } else {
      replyText = 'Certo! Pode me contar um pouco mais?';
    }

    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Erro no workflow:', err?.response?.data || err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Tive um probleminha agora 😅. Pode repetir a última mensagem?');
    res.type('text/xml').send(twiml.toString());
  }
});

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
