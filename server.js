// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

const {
  PORT = 3000,
  TWILIO_AUTH_TOKEN,        // no sandbox pode deixar sem validar; em produção ative a validação
  OPENAI_API_KEY,
  WORKFLOW_ID               // EX: wf_68e675eed8308190b879e7bee93f77380b5a95a081872a01
} = process.env;

if (!OPENAI_API_KEY || !WORKFLOW_ID) {
  console.error('❌ Defina OPENAI_API_KEY e WORKFLOW_ID nas variáveis de ambiente.');
  process.exit(1);
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Durante os testes no Twilio Sandbox é comum desativar a validação.
// Em produção, mude para: twilio.webhook({ validate: true, protocol: 'https' })
const twilioMiddleware = twilio.webhook({ validate: false });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function extractTextFromResponse(resp) {
  // Respostas do /v1/responses com Workflow normalmente têm `output_text`
  if (resp?.output_text) return String(resp.output_text).trim();

  // fallback mais genérico: varre a estrutura de output
  const parts = [];
  if (Array.isArray(resp?.output)) {
    for (const block of resp.output) {
      if (Array.isArray(block.content)) {
        for (const c of block.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') {
            parts.push(c.text);
          } else if (typeof c?.text === 'string') {
            parts.push(c.text);
          }
        }
      }
    }
  }
  return (parts.join('\n').trim()) || 'Desculpe, não consegui gerar uma resposta agora.';
}

app.post('/twilio/whatsapp', twilioMiddleware, async (req, res) => {
  try {
    const from = (req.body.From || '').trim();     // ex: 'whatsapp:+55...'
    const userText = (req.body.Body || '').trim();

    console.log('📩 Mensagem recebida:', { from, userText });

    if (!userText) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Pode repetir a sua mensagem?');
      return res.type('text/xml').send(twiml.toString());
    }

    // CHAMADA AO WORKFLOW via /v1/responses — o model é o próprio WORKFLOW_ID
    const response = await openai.responses.create({
      model: WORKFLOW_ID,          // <<< ponto-chave: o ID do workflow vai aqui
      // você pode passar só a string em `input`, mas manter o formato estruturado é ok:
      input: [
        { role: 'user', content: [{ type: 'input_text', text: userText }] }
      ],
      // manter estado por contato do WhatsApp
      conversation: { id: `wa:${from}` }
    });

    const replyText = extractTextFromResponse(response);
    console.log('🤖 Resposta do Workflow:', replyText);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('❌ ERRO Workflow:', err?.response?.data || err);

    // Se quiser falhar explicitamente quando o Workflow não responder, mantenha essa mensagem curta:
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Tive um problema ao falar com o assistente. Tente novamente em instantes.');
    return res.type('text/xml').send(twiml.toString());
  }
});

app.get('/', (_, res) => res.send('OK - Twilio webhook (Workflow-only)'));

app.listen(PORT, () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
