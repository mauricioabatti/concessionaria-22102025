# 🤖 Twilio WhatsApp + OpenAI Agents SDK

Integração completa entre Twilio WhatsApp e OpenAI Agents SDK para criar um assistente virtual inteligente de concessionária automotiva.

## 📋 Sobre

Este projeto integra:
- **Twilio WhatsApp** para receber e enviar mensagens
- **OpenAI Agents SDK** com workflow personalizado do Agent Builder
- **Express.js** como servidor web

O workflow inclui múltiplos agentes especializados:
- 🎯 **Consultor**: Identifica a intenção do usuário e roteia para o agente correto
- 🚗 **Carros Novos**: Busca ofertas de carros 0km no site da concessionária
- 🚙 **Seminovos**: Busca carros seminovos multimarcas
- 💰 **Financiamento**: Simula financiamentos com taxas e parcelas
- 👋 **Saudação**: Atendimento inicial e apresentação dos serviços
- 📝 **Leads**: Captura dados de clientes interessados
- 🔧 **Revisão, Garantia, Test Drive**: Serviços adicionais

## 🚀 Como Usar

### 1. Clonar/Baixar o Projeto

```bash
git clone <seu-repositorio>
cd twilio-agents-sdk-webhook
```

### 2. Instalar Dependências

```bash
npm install
```

### 3. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

Edite o `.env` e adicione sua API key:

```env
OPENAI_API_KEY=sk-sua-chave-aqui
PORT=3000
```

**⚠️ IMPORTANTE:** Use uma API key que comece com `sk-` (não `sk-proj-`)

### 4. Executar Localmente

```bash
npm start
```

O servidor estará rodando em `http://localhost:3000`

### 5. Testar o Health Check

Abra no navegador:
```
http://localhost:3000/health
```

Deve retornar: `{"ok":true}`

## 🌐 Deploy no Railway

### Passo 1: Criar Repositório no GitHub

1. Crie um novo repositório no GitHub (pode ser privado)
2. Faça upload dos arquivos:
   - `server.ts`
   - `workflow.ts`
   - `package.json`
   - `.gitignore`
   - `README.md`
   - `.env.example` (NÃO envie o `.env`)

### Passo 2: Conectar ao Railway

1. Acesse [railway.app](https://railway.app)
2. Clique em "New Project"
3. Escolha "Deploy from GitHub repo"
4. Selecione seu repositório
5. Railway fará o deploy automaticamente

### Passo 3: Configurar Variáveis no Railway

No Railway, vá em **Variables** e adicione:

```
OPENAI_API_KEY=sk-sua-chave-aqui
PORT=3000
```

### Passo 4: Obter URL Pública

Após o deploy, o Railway fornecerá uma URL pública:
```
https://seu-projeto.up.railway.app
```

## 📱 Configurar Webhook no Twilio

### Passo 1: Acessar Console Twilio

1. Acesse [console.twilio.com](https://console.twilio.com)
2. Vá em **Messaging** > **Settings** > **WhatsApp Sandbox**

### Passo 2: Configurar Webhook

- **URL:** `https://seu-projeto.up.railway.app/twilio/whatsapp`
- **Método:** POST
- Salve as configurações

### Passo 3: Testar

Envie uma mensagem pelo WhatsApp para o número do sandbox e veja a resposta!

## 🧪 Testes Locais

### Teste 1: Health Check

```bash
curl http://localhost:3000/health
```

Resposta esperada:
```json
{"ok":true}
```

### Teste 2: Simular Webhook do Twilio

```bash
curl -X POST http://localhost:3000/twilio/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5511999999999" \
  -d "Body=Olá, quero saber sobre carros novos"
```

## 📊 Estrutura do Projeto

```
twilio-agents-sdk-webhook/
├── server.ts           # Servidor Express + integração Twilio
├── workflow.ts         # Workflow do Agents SDK (baixado do Agent Builder)
├── package.json        # Dependências e scripts
├── .env.example        # Exemplo de variáveis de ambiente
├── .gitignore          # Arquivos ignorados pelo Git
└── README.md           # Este arquivo
```

## 🔧 Arquivos para o GitHub

### ✅ INCLUIR (fazer upload):

- `server.ts`
- `workflow.ts`
- `package.json`
- `.gitignore`
- `README.md`
- `.env.example`

### ❌ NÃO INCLUIR:

- `.env` (contém sua API key!)
- `node_modules/` (muito grande, instalado automaticamente)
- `package-lock.json` (pode causar conflitos)

## 🎯 Fluxo de Funcionamento

1. **Usuário** envia mensagem pelo WhatsApp
2. **Twilio** recebe a mensagem e envia para o webhook
3. **Servidor** recebe a mensagem no endpoint `/twilio/whatsapp`
4. **Workflow** executa:
   - **Consultor** identifica a intenção (ex.: "carros novos")
   - **Agente específico** processa a mensagem (ex.: agente "Carros Novos")
   - Retorna a resposta
5. **Servidor** envia resposta via Twilio
6. **Usuário** recebe a resposta no WhatsApp

## 🐛 Troubleshooting

### Erro: "Cannot find module '@openai/agents'"

**Solução:** Instale as dependências:
```bash
npm install
```

### Erro: "OPENAI_API_KEY is not defined"

**Solução:** Configure a variável de ambiente no `.env` ou no Railway

### Erro: "Invalid API key"

**Solução:** Verifique se a API key:
- Começa com `sk-` (não `sk-proj-`)
- Está ativa e não expirada
- Foi copiada corretamente (sem espaços)

### Erro: "Port already in use"

**Solução:** Mude a porta no `.env`:
```env
PORT=3001
```

## 📝 Logs

O servidor mostra logs detalhados:

```
📩 IN { from: 'whatsapp:+5511999999999', userText: 'Olá' }
✅ WF OK { preview: 'Olá! Sou o consultor Fortes...' }
📤 OUT { to: 'whatsapp:+5511999999999', sentPreview: 'Olá! Sou o consultor...' }
```

## 🔒 Segurança

- **Nunca** compartilhe seu arquivo `.env`
- **Nunca** faça commit da API key no GitHub
- Use variáveis de ambiente no Railway
- Mantenha o `.gitignore` atualizado

## 📚 Documentação

- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk)
- [Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp)
- [Railway Docs](https://docs.railway.app/)

## 🆘 Suporte

Se tiver problemas:

1. Verifique os logs no Railway
2. Teste localmente primeiro
3. Confirme que a API key está correta
4. Verifique se o webhook está configurado no Twilio

## 📄 Licença

MIT

---

**Desenvolvido com ❤️ usando OpenAI Agents SDK + Twilio**

