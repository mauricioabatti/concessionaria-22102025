import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

// ====== ENV ======
const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,
  TWILIO_AUTH_TOKEN, // usado para validar a assinatura do webhook
} = process.env;

if (!OPENAI_API_KEY || !WORKFLOW_ID || !TWILIO_AUTH_TOKEN) {
  console.error(
    '❌ Faltando variáveis no .env/Variables (Railway): OPENAI_API_KEY, WORKFLOW_ID, TWILIO_AUTH_TOKEN'
  );
  process.exit(1);
}

// ====== OpenAI client (user-level key: DEVE começar com "sk-") ======
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== Express ======
const app = express();

// Twilio envia application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Validação de assinatura do Twilio (requer HTTPS em produção; o Railway provê)
const verifyTwilio = twilio.webhook({
  validate: true,
  protocol: 'https',
  host: undefined, // Railway já fornece o host correto
});

// ====== Helpers ======
const sanitizeId = (raw, prefix = 'wa_') => {
  const cleaned = String(raw || '')
    .replace(/[^A-Za-z0-9_-]/g, '') // só [a-zA-Z0-9_-]
    .slice(0, 64); // limite de segurança
  return `${prefix}${cleaned || 'anon'}`;
};

// Gera um conversation.id válido a partir do payload do Twilio
function getConversationId(body) {
  // Twilio WhatsApp envia "WaId" (somente dígitos do WhatsApp do usuário)
  // Ex.: "554199999999"
  if (body.WaId) return sanitizeId(body.WaId);

  // Alternativa: derivar do "From"
  if (body.From) {
    // Ex.: "whatsapp:+554199999999"
    const digits = String(body.From).replace(/\D/g, ''); // só números
    if (digits) return sanitizeId(digits);
  }

  // fallback: usar MessageSid (já vem limpo)
  if (body.MessageSid) return sanitizeId(body.MessageSid, 'sid_');

  // último fallback
  return sanitizeId('fallback');
}

// ====== Rotas ======
app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/healthz', (_, res) => res.status(200).send('ok'));

// Webhook do Twilio (WhatsApp) – configure no Twilio como POST https://SEU-APP.railway.app/twilio/whatsapp
app.post('/twilio/whatsapp', verifyTwilio, async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const { Body: bodyTextRaw = '' } = req.body;
    const userText = String(bodyTextRaw || '').trim();
    const conversationId = getConversationId(req.body);

    if (!userText) {
      twiml.message('Não recebi texto. Pode enviar sua mensagem novamente?');
      return res.type('text/xml').send(twiml.toString());
    }

    console.log('🔹 Mensagem recebida:', {
      from: req.body.From,
      waId: req.body.WaId,
      conversationId,
      text: userText,
    });

    // Chama o WORKFLOW do Agent Builder via Responses API
    const response = await openai.responses.create({
      workflow_id: WORKFLOW_ID,
      // O Responses API com workflow usa "input" com eventos/mensagens:
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }],
        },
      ],
      // Define um conversation.id válido (letras/números/_/-)
      conversation: { id: conversationId },
    });

    // Extrai o texto de saída
    let reply =
      (response && response.output_text) ||
      (response?.output?.[0]?.content?.[0]?.text ?? null);

    if (!reply || typeof reply !== 'string') {
      reply = 'Tudo certo! Pode me dar mais detalhes para eu te ajudar melhor?';
    }

    console.log('✅ Resposta do workflow:', reply);

    twiml.message(reply);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    // Log detalhado para debug
    const apiError = err?.response?.data ?? err;
    console.error('❌ ERRO ao chamar workflow:', apiError);

    twiml.message(
      'Tive um probleminha ao falar com o assistente. Pode repetir a última mensagem?'
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

// ====== Start ======
app.listen(Number(PORT), () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
