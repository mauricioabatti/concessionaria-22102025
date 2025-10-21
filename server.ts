import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { runWorkflow } from './workflow.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Twilio webhook para WhatsApp
app.post('/twilio/whatsapp', async (req, res) => {
  const { From, Body } = req.body;
  
  console.log('📩 IN', { from: From, userText: Body });

  try {
    // Executar o workflow do Agents SDK
    const result = await runWorkflow({ input_as_text: Body });
    
    // Extrair a resposta
    const responseText = result.output_text || 'Desculpe, não consegui processar sua mensagem.';
    
    console.log('✅ WF OK', { preview: responseText.substring(0, 50) + '...' });
    
    // Responder via Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseText);
    
    console.log('📤 OUT', { to: From, sentPreview: responseText.substring(0, 50) + '...' });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error) {
    console.error('❌ ERROR', error);
    
    // Resposta de erro
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
  console.log(`   Webhook: http://0.0.0.0:${PORT}/twilio/whatsapp`);
});

