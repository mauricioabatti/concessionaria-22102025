import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { runWorkflow } from './workflow.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============= CONFIGURAÇÕES =============
const {
  GOOGLE_SHEETS_SPREADSHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  VENDEDOR_WHATSAPP,
  DEBUG_LOG = '1',
} = process.env;

const log = (...args: any[]) => (DEBUG_LOG === '1' ? console.log(...args) : undefined);

// ============= GOOGLE SHEETS =============

let doc: GoogleSpreadsheet | null = null;
let sheetsLeads: any = null;
let sheetsInteracoes: any = null;
let sheetsFollowups: any = null;

// Cliente Twilio para notificações
let twilioClient: any = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function initializeGoogleSheets() {
  try {
    if (!GOOGLE_SHEETS_SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      console.log('⚠️ Google Sheets não configurado (variáveis faltando)');
      return false;
    }

    console.log('🔄 Conectando ao Google Sheets...');
    
    // Criar JWT para autenticação
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Conectar ao documento
    doc = new GoogleSpreadsheet(GOOGLE_SHEETS_SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();

    console.log(`✅ Planilha conectada: "${doc.title}"`);

    // Carregar as abas
    sheetsLeads = doc.sheetsByTitle['LEADS'];
    sheetsInteracoes = doc.sheetsByTitle['INTERACOES'];
    sheetsFollowups = doc.sheetsByTitle['FOLLOWUPS'];

    if (!sheetsLeads || !sheetsInteracoes) {
      console.error('❌ Abas LEADS ou INTERACOES não encontradas!');
      return false;
    }

    console.log('✅ Abas carregadas com sucesso!');
    return true;
  } catch (error: any) {
    console.error('❌ Erro ao conectar Google Sheets:', error.message);
    return false;
  }
}

// ============= FUNÇÕES DO GOOGLE SHEETS =============

async function getLeadByPhone(phone: string) {
  try {
    if (!sheetsLeads) return null;
    const rows = await sheetsLeads.getRows();
    const lead = rows.find((row: any) => row.get('Telefone') === phone);
    return lead || null;
  } catch (error: any) {
    console.error('❌ Erro ao buscar lead:', error.message);
    return null;
  }
}

async function createLead(data: any) {
  try {
    if (!sheetsLeads) return null;
    
    const now = new Date().toISOString();
    const rows = await sheetsLeads.getRows();
    const newId = rows.length + 1;

    await sheetsLeads.addRow({
      ID: newId,
      Data_Cadastro: now,
      Nome: data.nome || 'Novo Contato',
      Telefone: data.telefone,
      Email: data.email || '',
      Tipo_Interesse: data.tipo_interesse || '',
      Modelo_Interesse: data.modelo_interesse || '',
      Versao_Interesse: data.versao_interesse || '',
      Faixa_Preco_Min: data.faixa_preco_min || '',
      Faixa_Preco_Max: data.faixa_preco_max || '',
      Prazo_Compra: data.prazo_compra || '',
      Forma_Pagamento: data.forma_pagamento || '',
      Tem_Carro_Troca: data.tem_carro_troca || '',
      Marca_Carro_Troca: '',
      Modelo_Carro_Troca: '',
      Ano_Carro_Troca: '',
      KM_Carro_Troca: '',
      Pontuacao: 0,
      Classificacao: 'muito_frio',
      Status: 'novo',
      Origem: 'whatsapp',
      Ultima_Interacao: now,
      Vendedor_Responsavel: '',
      Observacoes: '',
      Data_Atualizacao: now,
    });

    log('✅ Lead criado:', newId, data.telefone);
    return newId;
  } catch (error: any) {
    console.error('❌ Erro ao criar lead:', error.message);
    return null;
  }
}

async function updateLead(phone: string, updates: any) {
  try {
    if (!sheetsLeads) return false;
    
    const lead = await getLeadByPhone(phone);
    if (!lead) {
      console.error('❌ Lead não encontrado para atualizar:', phone);
      return false;
    }

    // Atualizar campos
    Object.keys(updates).forEach(key => {
      lead.set(key, updates[key]);
    });
    lead.set('Data_Atualizacao', new Date().toISOString());
    lead.set('Ultima_Interacao', new Date().toISOString());

    await lead.save();
    log('✅ Lead atualizado:', phone);
    return true;
  } catch (error: any) {
    console.error('❌ Erro ao atualizar lead:', error.message);
    return false;
  }
}

async function logInteraction(leadId: number, phone: string, type: string, agent: string, clientMsg: string, botMsg: string) {
  try {
    if (!sheetsInteracoes) return;

    const rows = await sheetsInteracoes.getRows();
    const newId = rows.length + 1;

    await sheetsInteracoes.addRow({
      ID: newId,
      Lead_ID: leadId,
      Telefone: phone,
      Data_Hora: new Date().toISOString(),
      Tipo: type, // 'entrada' ou 'saida'
      Agente: agent,
      Mensagem_Cliente: clientMsg || '',
      Mensagem_Bot: botMsg || '',
    });

    log('✅ Interação registrada:', type, phone);
  } catch (error: any) {
    console.error('❌ Erro ao registrar interação:', error.message);
  }
}

function calculateScore(leadData: any) {
  let score = 0;

  // Prazo de compra
  const prazo = (leadData.get('Prazo_Compra') || '').toLowerCase();
  if (prazo.includes('imediato') || prazo.includes('urgente')) score += 50;
  else if (prazo.includes('30 dias') || prazo.includes('curto')) score += 30;
  else if (prazo.includes('90 dias') || prazo.includes('médio')) score += 15;

  // Orçamento definido
  if (leadData.get('Faixa_Preco_Min') && leadData.get('Faixa_Preco_Max')) score += 30;

  // Modelo específico
  if (leadData.get('Modelo_Interesse')) score += 10;

  // Versão específica
  if (leadData.get('Versao_Interesse')) score += 20;

  // Forma de pagamento
  const pagamento = (leadData.get('Forma_Pagamento') || '').toLowerCase();
  if (pagamento.includes('vista') || pagamento.includes('à vista')) score += 40;
  else if (pagamento.includes('financ')) score += 20;
  else if (pagamento.includes('consórcio')) score += 10;

  // Tem carro para troca
  if (leadData.get('Tem_Carro_Troca') === 'sim') score += 25;

  return score;
}

function classifyLead(score: number) {
  if (score >= 100) return 'quente';
  if (score >= 60) return 'morno';
  if (score >= 30) return 'frio';
  return 'muito_frio';
}

async function notifyVendedor(leadData: any) {
  if (!twilioClient || !VENDEDOR_WHATSAPP || !TWILIO_WHATSAPP_FROM) {
    log('⚠️ Notificação de vendedor desabilitada (faltam credenciais Twilio)');
    return;
  }

  try {
    const mensagem = `
🔥 LEAD QUENTE! 🔥

Nome: ${leadData.get('Nome') || 'Não informado'}
Telefone: ${leadData.get('Telefone')}
Interesse: ${leadData.get('Tipo_Interesse') || 'Não especificado'}
Modelo: ${leadData.get('Modelo_Interesse') || 'Não especificado'}
Prazo: ${leadData.get('Prazo_Compra') || 'Não informado'}
Pontuação: ${leadData.get('Pontuacao')}

Entre em contato AGORA!
    `.trim();

    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${VENDEDOR_WHATSAPP}`,
      body: mensagem,
    });

    log('✅ Vendedor notificado:', VENDEDOR_WHATSAPP);
  } catch (error: any) {
    console.error('❌ Erro ao notificar vendedor:', error.message);
  }
}

function extractLeadData(userText: string, replyText: string) {
  const data: any = {};
  const combined = `${userText} ${replyText}`.toLowerCase();

  // Modelos Fiat
  const modelos = ['mobi', 'argo', 'cronos', 'pulse', 'fastback', 'strada', 'toro', 'titano', 'fiorino', 'ducato'];
  for (const modelo of modelos) {
    if (combined.includes(modelo)) {
      data.modelo_interesse = modelo.charAt(0).toUpperCase() + modelo.slice(1);
      break;
    }
  }

  // Tipo de interesse
  if (combined.includes('novo') || combined.includes('0km') || combined.includes('zero')) {
    data.tipo_interesse = 'carros_novos';
  } else if (combined.includes('seminovo') || combined.includes('usado')) {
    data.tipo_interesse = 'seminovos';
  } else if (combined.includes('financ')) {
    data.tipo_interesse = 'financiamento';
  }

  // Prazo de compra
  if (combined.includes('urgente') || combined.includes('imediato') || combined.includes('agora')) {
    data.prazo_compra = 'imediato';
  } else if (combined.includes('30 dias') || combined.includes('mês')) {
    data.prazo_compra = '30_dias';
  } else if (combined.includes('90 dias') || combined.includes('3 meses')) {
    data.prazo_compra = '90_dias';
  }

  // Forma de pagamento
  if (combined.includes('vista') || combined.includes('à vista')) {
    data.forma_pagamento = 'à vista';
  } else if (combined.includes('financ') || combined.includes('parcela')) {
    data.forma_pagamento = 'financiado';
  } else if (combined.includes('consórcio')) {
    data.forma_pagamento = 'consórcio';
  }

  // Faixa de preço
  const precoMatch = combined.match(/(\d+)\s*(mil|k)/);
  if (precoMatch) {
    const valor = parseInt(precoMatch[1]) * 1000;
    data.faixa_preco_max = valor;
  }

  // Carro na troca
  if (combined.includes('troca') || combined.includes('trocar')) {
    data.tem_carro_troca = 'sim';
  }

  return data;
}

// ============= MIDDLEWARE =============

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ============= ROTAS =============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true,
    googleSheets: !!doc,
    planilha: doc?.title || 'não conectado'
  });
});

// Twilio webhook para WhatsApp
app.post('/twilio/whatsapp', async (req, res) => {
  const { From, Body } = req.body;
  
  console.log('📩 IN', { from: From, userText: Body });

  try {
    // 1. Buscar ou criar lead
    let lead = await getLeadByPhone(From);
    let leadId = null;

    if (!lead) {
      log('✨ Criando novo lead para', From);
      leadId = await createLead({ telefone: From });
      lead = await getLeadByPhone(From);
    } else {
      leadId = lead.get('ID');
      log('📋 Lead existente:', leadId, From);
    }

    // 2. Registrar mensagem do cliente
    await logInteraction(leadId, From, 'entrada', 'cliente', Body, '');

    // 3. Executar o workflow do Agents SDK
    const result = await runWorkflow({ input_as_text: Body });
    
    // 4. Extrair a resposta
    const responseText = result.output_text || 'Desculpe, não consegui processar sua mensagem.';
    
    console.log('✅ WF OK', { preview: responseText.substring(0, 50) + '...' });

    // 5. Extrair dados da conversa
    const extractedData = extractLeadData(Body, responseText);
    
    // 6. Atualizar lead com dados extraídos
    if (Object.keys(extractedData).length > 0 && lead) {
      await updateLead(From, extractedData);
      lead = await getLeadByPhone(From); // Recarregar
    }

    // 7. Calcular pontuação e classificar
    if (lead) {
      const score = calculateScore(lead);
      const classificacao = classifyLead(score);
      
      await updateLead(From, {
        Pontuacao: score,
        Classificacao: classificacao,
      });

      log('📊 Lead atualizado:', `Pontuação=${score}`, `Classificação=${classificacao}`);

      // 8. Notificar vendedor se lead quente
      if (score >= 100) {
        lead = await getLeadByPhone(From); // Recarregar com pontuação
        await notifyVendedor(lead);
      }
    }

    // 9. Registrar resposta do bot
    await logInteraction(leadId, From, 'saida', 'workflow', '', responseText);
    
    // 10. Responder via Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseText);
    
    console.log('📤 OUT', { to: From, sentPreview: responseText.substring(0, 50) + '...' });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error: any) {
    console.error('❌ ERROR', error);
    
    // Resposta de erro
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// ============= INICIALIZAÇÃO =============

async function startServer() {
  // Inicializar Google Sheets
  await initializeGoogleSheets();

  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`   Webhook: http://0.0.0.0:${PORT}/twilio/whatsapp`);
    if (doc) {
      console.log(`   Google Sheets: ${doc.title}`);
    }
    console.log('---');
  });
}

startServer();

