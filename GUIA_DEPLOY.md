# 🚀 Guia Rápido de Deploy

## 📦 Arquivos para o GitHub

### ✅ Fazer Upload (6 arquivos):

1. **server.ts** - Servidor principal
2. **workflow.ts** - Workflow do Agents SDK
3. **package.json** - Dependências
4. **.gitignore** - Proteção de arquivos
5. **README.md** - Documentação
6. **.env.example** - Exemplo de configuração

### ❌ NÃO Fazer Upload:

- ❌ `.env` (contém sua API key!)
- ❌ `node_modules/` (muito grande)
- ❌ `package-lock.json` (conflitos)

---

## 🎯 Passo a Passo Completo

### 1️⃣ Criar Repositório no GitHub

1. Acesse [github.com](https://github.com)
2. Clique em **"New repository"**
3. Configure:
   - Nome: `twilio-agents-sdk-webhook`
   - Visibilidade: **Private** (recomendado)
   - **NÃO** marque "Initialize with README"
4. Clique em **"Create repository"**

### 2️⃣ Fazer Upload dos Arquivos

**Opção A - Interface Web (Mais Fácil):**

1. No repositório, clique em **"uploading an existing file"**
2. Arraste os 6 arquivos ✅ listados acima
3. Escreva uma mensagem: "Initial commit"
4. Clique em **"Commit changes"**

**Opção B - Git Command Line:**

```bash
cd /caminho/para/twilio-agents-sdk-webhook
git init
git add server.ts workflow.ts package.json .gitignore README.md .env.example
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/seu-usuario/twilio-agents-sdk-webhook.git
git push -u origin main
```

### 3️⃣ Deploy no Railway

1. Acesse [railway.app](https://railway.app)
2. Faça login (pode usar GitHub)
3. Clique em **"New Project"**
4. Escolha **"Deploy from GitHub repo"**
5. Selecione `twilio-agents-sdk-webhook`
6. Railway iniciará o deploy automaticamente

### 4️⃣ Configurar Variáveis no Railway

1. No Railway, clique no seu projeto
2. Vá na aba **"Variables"**
3. Clique em **"New Variable"**
4. Adicione:

```
OPENAI_API_KEY=sk-sua-chave-aqui
```

5. Clique em **"Add"**
6. Railway fará redeploy automaticamente

### 5️⃣ Obter URL Pública

1. No Railway, vá na aba **"Settings"**
2. Role até **"Domains"**
3. Clique em **"Generate Domain"**
4. Copie a URL gerada (ex.: `https://seu-projeto.up.railway.app`)

### 6️⃣ Testar o Deploy

Abra no navegador:
```
https://seu-projeto.up.railway.app/health
```

Deve retornar: `{"ok":true}`

### 7️⃣ Configurar Webhook no Twilio

1. Acesse [console.twilio.com](https://console.twilio.com)
2. Vá em **Messaging** > **Settings** > **WhatsApp Sandbox**
3. Configure:
   - **URL:** `https://seu-projeto.up.railway.app/twilio/whatsapp`
   - **Método:** POST
4. Salve

### 8️⃣ Testar no WhatsApp

1. Envie uma mensagem para o número do Twilio Sandbox
2. Aguarde a resposta do bot
3. ✅ Funcionou!

---

## 🔍 Verificação de Problemas

### ✅ Checklist de Deploy:

- [ ] Repositório criado no GitHub
- [ ] 6 arquivos enviados (sem `.env`)
- [ ] Projeto criado no Railway
- [ ] Conectado ao repositório GitHub
- [ ] `OPENAI_API_KEY` configurada no Railway
- [ ] Deploy concluído (status verde)
- [ ] URL pública gerada
- [ ] `/health` respondendo
- [ ] Webhook configurado no Twilio
- [ ] Teste enviado pelo WhatsApp
- [ ] Bot respondeu!

### ❌ Se Algo Falhar:

**Deploy falhou no Railway:**
- Veja os logs na aba "Deployments"
- Verifique se `package.json` está correto
- Confirme que todos os arquivos foram enviados

**Bot não responde:**
- Verifique se `OPENAI_API_KEY` está configurada
- Teste o endpoint `/health`
- Veja os logs no Railway
- Confirme que o webhook está configurado no Twilio

**Erro 404 no webhook:**
- Verifique se a URL está correta
- Deve terminar com `/twilio/whatsapp`
- Confirme que o servidor está rodando

---

## 💡 Dicas Importantes

### 1. API Key

**Use uma chave que comece com `sk-` (não `sk-proj-`)**

Como verificar:
1. Acesse [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Veja suas chaves
3. Se começar com `sk-proj-`, crie uma nova:
   - Clique em "Create new secret key"
   - Escolha "User" ou "Service Account"
   - Copie a chave (começa com `sk-`)

### 2. Segurança

**Nunca compartilhe:**
- ❌ Arquivo `.env`
- ❌ API key da OpenAI
- ❌ Credenciais do Twilio

**Sempre use:**
- ✅ Variáveis de ambiente no Railway
- ✅ Repositório privado no GitHub
- ✅ `.gitignore` para proteger arquivos

### 3. Logs

**Para ver o que está acontecendo:**

1. No Railway, vá na aba **"Logs"**
2. Envie uma mensagem pelo WhatsApp
3. Veja os logs em tempo real:
   ```
   📩 IN { from: '...', userText: '...' }
   ✅ WF OK { preview: '...' }
   📤 OUT { to: '...', sentPreview: '...' }
   ```

---

## 🎉 Pronto!

Seu bot está no ar e funcionando!

**Próximos passos:**
- Teste diferentes tipos de mensagens
- Monitore os logs no Railway
- Ajuste as instruções dos agentes se necessário
- Compartilhe o número do WhatsApp com clientes

---

## 📞 Contato

Se tiver dúvidas, consulte:
- **README.md** - Documentação completa
- **Railway Logs** - Para ver erros
- **Twilio Console** - Para configurações do WhatsApp

**Boa sorte! 🚀**

