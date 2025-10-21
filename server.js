import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';

/**
 * ==== Variáveis de ambiente ====
 */
const {
  PORT = 3000,
  TWILIO_AUTH_TOKEN,
  OPENAI_API_KEY,
  WORKFLOW_ID,
} = process.env;

if (!OPENAI_API_KEY || !WORKFLOW_ID) {
  console.error(
    '❌ Faltam variáveis no .env: OPENAI_API_KEY e/ou WORKFLOW_ID.'
  );
  process.exit(1);
}
if (!TWILIO_AUTH_TOKEN) {
  console.error(
    '⚠️  TWILIO_AUTH_TOKEN não definido. A validação de webhook do Twilio não funcionará.'
  );
}

/**
 * ==== Inicialização ====
 */
const app = express();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Twilio envia `application/x-www-form-urlencoded`
 */
app.use(bodyParser.urlencoded({ extended: false }));

/**
 * Middleware de verificação de assinatura do Twilio.
 * Em produção (Railway) a URL é HTTPS, então podemos validar.
 */
const twilioWebhook =
  TWILIO_AUTH_TOKEN
    ? twilio.webhook({ validate: true, protocol: 'https' })
    : // fallback sem validação (NÃO recomendado em prod)
      (req, res, next) => next();

/**
 * Utilitário: cria um ID de conversa “limpo” (apenas [A-Za-z0-9_-])
 * A OpenAI exige esse formato no `conversation.id`.
 * Preferimos `WaId` (vem como apenas dígitos do Twilio) e,
 * se faltar, sanitizamos o `From`.
 */
function buildConversationId(req) {
  const raw =
    req.body.WaId ||
    String(req.body.From || '').replace(/^whatsapp:/, ''); // remove "whatsapp:"
  const clean = raw.toString().replace(/[^\w-]/g, '_').slice(-64); // limita para evitar ids enormes
  return `wa_${clean || 'unknown'}`;
}

/**
 * ==== Endpoint do webhook do Twilio/WhatsApp ====
 */
app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  try {
    const from = String(req.body.From || '');
    const to = String(req.body.To || '');
    const userText = String(req.body.Body || '').trim();

    if (!userText) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Não entendi a mensagem (vazia). Pode tentar novamente?');
      return res.type('text/xml').send(twiml.toString());
    }

    // conversation.id válido para o Agent Builder
    const conversationId = buildConversationId(req);

    console.log('➡️  Mensagem IN:', {
      from,
      to,
      waId: req.body.WaId,
      body: userText,
      conversationId,
    });

    // ==== Chamada ao workflow do Agent Builder via Responses API ====
    const oaResp = await openai.responses.create({
      workflow_id: WORKFLOW_ID,
      // Conversa “stateful” no lado da OpenAI, agrupada por esse ID:
      conversation: { id: conversationId },

      // Payload no formato do Responses API:
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }],
        },
      ],

      // Opcional: útil para debugar/filtrar no lado da OpenAI
      metadata: { source: 'twilio-whatsapp' },
    });

    // Extrai o texto da resposta (duas formas possíveis)
    let replyText = '';
    if (oaResp?.output_text) {
      replyText = oaResp.output_text;
    } else if (
      Array.isArray(oaResp?.output) &&
      oaResp.output[0]?.content?.[0]?.text
    ) {
      replyText = oaResp.output[0].content[0].text;
    }

    if (!replyText) {
      replyText =
        'Tudo certo por aqui, mas não recebi uma resposta válida. Pode reformular a sua pergunta?';
    }

    console.log('⬅️  Workflow OK. Resposta:', replyText);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    // Log detalhado no Railway para diagnóstico
    console.error('❌ ERRO ao falar com o workflow:', {
      status: err?.status,
      message: err?.message,
      data: err?.response?.data,
    });

    const fallback =
      'Tive um problema ao falar com o assistente. Tente novamente em instantes.';

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(fallback);
    return res.type('text/xml').send(twiml.toString());
  }
});

/**
 * ==== Endpoints auxiliares ====
 */
app.get('/', (_req, res) => res.send('OK - Twilio webhook ativo'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/**
 * ==== Sobe o servidor ====
 */
app.listen(Number(PORT), () => {
  console.log(`🚀 Webhook ouvindo em http://localhost:${PORT}`);
});
