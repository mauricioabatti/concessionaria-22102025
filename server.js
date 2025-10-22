// server.js - Versão Completa com Google Sheets
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import OpenAI from 'openai';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// ============= CONFIGURAÇÕES =============
const {
  PORT = 3000,
  OPENAI_API_KEY,
  WORKFLOW_ID,
  FALLBACK_MODEL = 'gpt-4.1-mini',
  DEBUG_LOG = '0',
  DEBUG_ECHO = '1',
  FORCE_FALLBACK = '0',
  // Google Sheets
  GOOGLE_SHEETS_SPREADSHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  // Twilio (para notificações)
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  VENDEDOR_WHATSAPP, // Número do vendedor para notificações
} = process.env;

// Validações
if (!OPENAI_API_KEY) {
  console.error('❌ Falta OPENAI_API_KEY (use sk-..., não sk-proj-...).');
  process.exit(1);
}
if (!WORKFLOW_ID) {
  console.error('❌ Falta WORKFLOW_ID (wf_...).');
  process.exit(1);
}
if (!GOOGLE_SHEETS_SPREADSHEET_ID) {
  console.error('❌ Falta GOOGLE_SHEETS_SPREADSHEET_ID');
  process.exit(1);
}
if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error('❌ Falta credenciais do Google (SERVICE_ACCOUNT_EMAIL e PRIVATE_KEY)');
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: false }));

const twilioWebhook = twilio.webhook({ validate: false });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = new Map();
const log = (...a) => (DEBUG_LOG === '1' ? console.log(...a) : undefined);

// Cliente Twilio para enviar notificações
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// ============= GOOGLE SHEETS =============

let doc = null;
let sheetsLeads = null;
let sheetsInteracoes = null;
let sheetsFollowups = null;
let sheetsProdutosNovos = null;
let sheetsProdutosSeminovos = null;
let sheetsConfig = null;

async function initializeGoogleSheets() {
  try {
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
    sheetsProdutosNovos = doc.sheetsByTitle['PRODUTOS_NOVOS'];
    sheetsProdutosSeminovos = doc.sheetsByTitle['PRODUTOS_SEMINOVOS'];
    sheetsConfig = doc.sheetsByTitle['CONFIG'];

    if (!sheetsLeads || !sheetsInteracoes) {
      console.error('❌ Abas LEADS ou INTERACOES não encontradas!');
      return false;
    }

    console.log('✅ Abas carregadas com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar Google Sheets:', error.message);
    return false;
  }
}

// Funções auxiliares do Google Sheets

async function getLeadByPhone(phone) {
  try {
    const rows = await sheetsLeads.getRows();
    const lead = rows.find(row => row.get('Telefone') === phone);
    return lead || null;
  } catch (error) {
    console.error('❌ Erro ao buscar lead:', error.message);
    return null;
  }
}

async function createLead(data) {
  try {
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
  } catch (error) {
    console.error('❌ Erro ao criar lead:', error.message);
    throw error;
  }
}

async function updateLead(phone, updates) {
  try {
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
  } catch (error) {
    console.error('❌ Erro ao atualizar lead:', error.message);
    return false;
  }
}

async function logInteraction(leadId, phone, type, agent, clientMsg, botMsg) {
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
      Mensagem_Cliente: clientMsg,
      Mensagem_Bot: botMsg,
    });

    log('✅ Interação registrada:', type, phone);
  } catch (error) {
    console.error('❌ Erro ao registrar interação:', error.message);
  }
}

function calculateScore(leadData) {
  let score = 0;

  // Prazo de compra
  const prazo = (leadData.Prazo_Compra || '').toLowerCase();
  if (prazo.includes('imediato') || prazo.includes('urgente')) score += 50;
  else if (prazo.includes('30 dias') || prazo.includes('curto')) score += 30;
  else if (prazo.includes('90 dias') || prazo.includes('médio')) score += 15;

  // Orçamento definido
  if (leadData.Faixa_Preco_Min && leadData.Faixa_Preco_Max) score += 30;

  // Modelo específico
  if (leadData.Modelo_Interesse) score += 10;

  // Versão específica
  if (leadData.Versao_Interesse) score += 20;

  // Forma de pagamento
  const pagamento = (leadData.Forma_Pagamento || '').toLowerCase();
  if (pagamento.includes('vista') || pagamento.includes('à vista')) score += 40;
  else if (pagamento.includes('financ')) score += 20;
  else if (pagamento.includes('consórcio')) score += 10;

  // Tem carro para troca
  if (leadData.Tem_Carro_Troca === 'sim') score += 25;

  return score;
}

function classifyLead(score) {
  if (score >= 100) return 'quente';
  if (score >= 60) return 'morno';
  if (score >= 30) return 'frio';
  return 'muito_frio';
}

async function notifyVendedor(leadData) {
  if (!twilioClient || !VENDEDOR_WHATSAPP || !TWILIO_WHATSAPP_FROM) {
    log('⚠️ Notificação de vendedor desabilitada (faltam credenciais Twilio)');
    return;
  }

  try {
    const mensagem = `
🔥 LEAD QUENTE! 🔥

Nome: ${leadData.Nome || 'Não informado'}
Telefone: ${leadData.Telefone}
Interesse: ${leadData.Tipo_Interesse || 'Não especificado'}
Modelo: ${leadData.Modelo_Interesse || 'Não especificado'}
Prazo: ${leadData.Prazo_Compra || 'Não informado'}
Pontuação: ${leadData.Pontuacao}

Entre em contato AGORA!
    `.trim();

    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${VENDEDOR_WHATSAPP}`,
      body: mensagem,
    });

    log('✅ Vendedor notificado:', VENDEDOR_WHATSAPP);
  } catch (error) {
    console.error('❌ Erro ao notificar vendedor:', error.message);
  }
}

// ============= WORKFLOW HELPERS =============

function extractText(obj) {
  try {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (obj.output_text) return String(obj.output_text);
    const first = obj.output?.[0]?.content?.[0];
    if (first?.text) return String(first.text);
    return JSON.stringify(obj).slice(0, 800);
  } catch {
    return '';
  }
}

function conversationIdFor(from) {
  const onlyDigits = (from || '').replace(/\D+/g, '');
  return `wa_${onlyDigits || 'unknown'}`;
}

async function runWorkflowMultiEndpoints({ userText }) {
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const payload = {
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    ],
  };

  const attempts = [
    {
      label: 'runs-path',
      url: `https://api.openai.com/v1/workflows/${WORKFLOW_ID}/runs`,
      body: payload,
    },
    {
      label: 'runs-body',
      url: `https://api.openai.com/v1/workflows/runs`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
    {
      label: 'run_workflow',
      url: `https://api.openai.com/v1/run_workflow`,
      body: { workflow_id: WORKFLOW_ID, ...payload },
    },
  ];

  const errors = [];

  for (const att of attempts) {
    try {
      log(`→ WF try: ${att.label} ${att.url}`);
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
        const prefix =
          DEBUG_ECHO === '1'
            ? `WF✅[${att.label}/${res.status}${reqId ? `/${reqId}` : ''}] `
            : '';
        log('✅ WF OK', { label: att.label, status: res.status, reqId, preview: extractText(data) });
        return { data, prefix };
      } else {
        const text = await res.text();
        log('❗ WF FAIL', { label: att.label, status: res.status, body: text.slice(0, 600) });
        errors.push({
          label: att.label,
          status: res.status,
          reqId,
          body: text,
        });
      }
    } catch (e) {
      errors.push({
        label: att.label,
        status: 'fetch-error',
        body: e?.message || String(e),
      });
    }
  }

  const compact = JSON.stringify(errors, null, 2);
  const err = new Error(compact);
  err._failures = errors;
  throw err;
}

async function runFallback(userText) {
  const r = await openai.responses.create({
    model: FALLBACK_MODEL,
    input: userText,
  });
  const text =
    r?.output_text ??
    r?.output?.[0]?.content?.[0]?.text ??
    'Certo! Pode me contar um pouco mais?';
  const prefix = DEBUG_ECHO === '1' ? 'FB✅ ' : '';
  log('↩️ FB OK', { preview: text.slice(0, 200) });
  return { text, prefix };
}

// Função para extrair dados estruturados da resposta do workflow
function extractLeadData(userText, replyText) {
  const data = {};
  const lowerText = userText.toLowerCase();
  const lowerReply = replyText.toLowerCase();

  // Detectar tipo de interesse
  if (lowerText.includes('novo') || lowerText.includes('0km')) {
    data.tipo_interesse = 'carros_novos';
  } else if (lowerText.includes('seminovo') || lowerText.includes('usado')) {
    data.tipo_interesse = 'seminovos';
  } else if (lowerText.includes('financ')) {
    data.tipo_interesse = 'financiamento';
  }

  // Detectar modelos Fiat
  const modelos = ['mobi', 'argo', 'cronos', 'pulse', 'fastback', 'strada', 'toro', 'titano'];
  for (const modelo of modelos) {
    if (lowerText.includes(modelo)) {
      data.modelo_interesse = modelo.charAt(0).toUpperCase() + modelo.slice(1);
      break;
    }
  }

  // Detectar prazo
  if (lowerText.includes('urgente') || lowerText.includes('imediato') || lowerText.includes('agora')) {
    data.prazo_compra = 'imediato';
  } else if (lowerText.match(/\d+\s*dias?/)) {
    data.prazo_compra = 'curto';
  }

  // Detectar forma de pagamento
  if (lowerText.includes('vista') || lowerText.includes('à vista')) {
    data.forma_pagamento = 'à vista';
  } else if (lowerText.includes('financ') || lowerText.includes('parcela')) {
    data.forma_pagamento = 'financiado';
  } else if (lowerText.includes('consórcio')) {
    data.forma_pagamento = 'consórcio';
  }

  // Detectar faixa de preço
  const precoMatch = lowerText.match(/(\d+)\s*mil/);
  if (precoMatch) {
    const valor = parseInt(precoMatch[1]) * 1000;
    data.faixa_preco_max = valor;
    data.faixa_preco_min = Math.max(0, valor - 20000);
  }

  // Detectar carro na troca
  if (lowerText.includes('troca') || lowerText.includes('trocar')) {
    data.tem_carro_troca = 'sim';
  }

  return data;
}

// ============= WEBHOOK HANDLER =============

app.post('/twilio/whatsapp', twilioWebhook, async (req, res) => {
  const from = req.body.From || '';
  const userText = (req.body.Body || '').trim();
  const convId = conversationIdFor(from);
  const phone = from.replace('whatsapp:', '');

  log('📩 IN', { from, userText, convId });

  const hist = sessions.get(from) ?? [];
  hist.push({ role: 'user', content: userText });

  let replyText = '';
  let prefix = '';
  let diagLine = '';
  let agentName = 'Sistema';

  try {
    // 1. BUSCAR OU CRIAR LEAD
    let lead = await getLeadByPhone(phone);
    let leadId = lead ? lead.get('ID') : null;

    if (!lead) {
      log('✨ Criando novo lead para', phone);
      leadId = await createLead({ telefone: phone, nome: 'Novo Contato' });
      lead = await getLeadByPhone(phone);
    }

    // 2. REGISTRAR MENSAGEM DE ENTRADA
    await logInteraction(leadId, phone, 'entrada', 'Cliente', userText, '');

    // 3. EXECUTAR WORKFLOW OU FALLBACK
    if (FORCE_FALLBACK === '1') {
      const fb = await runFallback(userText);
      replyText = fb.text;
      prefix = fb.prefix;
      agentName = 'Fallback';
    } else {
      try {
        const wf = await runWorkflowMultiEndpoints({ userText });
        replyText = extractText(wf.data) || 'Tudo certo! Pode me contar mais?';
        prefix = wf.prefix;
        agentName = 'Workflow';
      } catch (wfErr) {
        // Montar diagnóstico
        let first = '';
        if (wfErr?._failures?.length) {
          const f = wfErr._failures[0];
          const status = f.status || '';
          const label = f.label || '';
          let msg = '';
          try {
            const parsed = JSON.parse(f.body);
            msg = parsed?.error?.message || parsed?.message || f.body;
          } catch {
            msg = f.body || String(wfErr.message || wfErr);
          }
          msg = String(msg).replace(/\s+/g, ' ').slice(0, 280);
          first = `WF❌[${status}/${label}] ${msg}`;
        } else {
          first = `WF❌ ${String(wfErr.message || wfErr).slice(0, 280)}`;
        }
        diagLine = DEBUG_ECHO === '1' ? `${first}\n` : '';

        // Fallback
        const fb = await runFallback(userText);
        replyText = fb.text;
        prefix = fb.prefix;
        agentName = 'Fallback';
      }
    }

    // 4. EXTRAIR DADOS DA CONVERSA E ATUALIZAR LEAD
    const extractedData = extractLeadData(userText, replyText);
    if (Object.keys(extractedData).length > 0) {
      await updateLead(phone, extractedData);
      lead = await getLeadByPhone(phone); // Recarregar
    }

    // 5. CALCULAR PONTUAÇÃO E CLASSIFICAÇÃO
    const leadData = {
      Prazo_Compra: lead.get('Prazo_Compra'),
      Faixa_Preco_Min: lead.get('Faixa_Preco_Min'),
      Faixa_Preco_Max: lead.get('Faixa_Preco_Max'),
      Modelo_Interesse: lead.get('Modelo_Interesse'),
      Versao_Interesse: lead.get('Versao_Interesse'),
      Forma_Pagamento: lead.get('Forma_Pagamento'),
      Tem_Carro_Troca: lead.get('Tem_Carro_Troca'),
    };

    const score = calculateScore(leadData);
    const classification = classifyLead(score);

    await updateLead(phone, {
      Pontuacao: score,
      Classificacao: classification,
    });

    log(`📊 Lead atualizado: Pontuação=${score}, Classificação=${classification}`);

    // 6. NOTIFICAR VENDEDOR SE LEAD QUENTE
    if (classification === 'quente' && lead.get('Status') !== 'contatado') {
      await updateLead(phone, { Status: 'quente_pendente' });
      await notifyVendedor({
        Nome: lead.get('Nome'),
        Telefone: phone,
        Tipo_Interesse: lead.get('Tipo_Interesse'),
        Modelo_Interesse: lead.get('Modelo_Interesse'),
        Prazo_Compra: lead.get('Prazo_Compra'),
        Pontuacao: score,
      });
    }

    // 7. REGISTRAR RESPOSTA DO BOT
    await logInteraction(leadId, phone, 'saida', agentName, '', replyText);

    // 8. ENVIAR RESPOSTA
    hist.push({ role: 'assistant', content: replyText });
    sessions.set(from, hist);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`${diagLine}${prefix}${replyText}`);
    res.type('text/xml').send(twiml.toString());

    log('📤 OUT', { to: from, sentPreview: replyText.slice(0, 200) });
  } catch (err) {
    console.error('❌ Handler error', err?.message || err);
    const twiml = new twilio.twiml.MessagingResponse();
    const msg =
      DEBUG_ECHO === '1'
        ? `ERR❌ ${String(err?.message || err).slice(0, 800)}`
        : 'Tive um probleminha agora 😅. Pode tentar de novo?';
    twiml.message(msg);
    res.type('text/xml').send(twiml.toString());
  }
});

// ============= HEALTH CHECKS =============

app.get('/', (_, res) => res.send('OK - Twilio webhook ativo'));
app.get('/health', (_, res) => res.json({ ok: true }));

// ============= INICIALIZAÇÃO =============

async function startServer() {
  console.log('🚀 Inicializando servidor...');

  // Conectar ao Google Sheets
  const sheetsOk = await initializeGoogleSheets();
  if (!sheetsOk) {
    console.error('❌ Falha ao conectar Google Sheets. Servidor não será iniciado.');
    process.exit(1);
  }

  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`   DEBUG_LOG=${DEBUG_LOG} DEBUG_ECHO=${DEBUG_ECHO} FORCE_FALLBACK=${FORCE_FALLBACK}`);
    console.log(`   Google Sheets: ${doc.title}`);
    console.log('---');
  });
}

startServer();
