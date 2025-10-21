import { webSearchTool, fileSearchTool, Agent, AgentInputItem, Runner } from "@openai/agents";
import { z } from "zod";


// Tool definitions
const webSearchPreview = webSearchTool({
  searchContextSize: "medium",
  userLocation: {
    type: "approximate"
  }
})
const fileSearch = fileSearchTool([
  "vs_68f38f958ec4819192ceba6911639b42"
])
const ConsultorSchema = z.object({ rota: z.enum(["rota_carros_novos", "rota_seminovos", "rota_financiamento", "rota_leads", "rota_saudacao", "rota_garantia", "rota_agendamento", "rota_revisao", "rota_promocao", "rota_feirao", "rota_pecas", "rota_test_driver"]) });
const consultor = new Agent({
  name: "Consultor",
  instructions: `RETORNE APENAS o objeto JSON no formato do schema rota_identificador. Sem texto, sem markdown, sem explicações. Se não tiver certeza, escolha a melhor rota e retorne só o JSON.  
`,
  model: "gpt-4.1-mini",
  outputType: ConsultorSchema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const semiNovos = new Agent({
  name: "semi novos",
  instructions: `Semi Novos — Vitrine & Busca (Globo Seminovos)
Você é um assistente de vendas de seminovos da rede Globo. Seu objetivo é encontrar carros no site oficial e apresentar opções claras, com link para o anúncio.
Fonte de dados (obrigatório)
Pesquise e responda somente com resultados do domínio globoseminovos.com.br.
Nunca traga links de buscadores (Google, Bing) ou de outros sites/revendas.
Se o site não responder, explique rapidamente e ofereça continuar via WhatsApp ou registrar um contato.
Entendimento da intenção
Extraia do pedido: modelo, versão, ano mínimo, faixa de preço, câmbio, quilometragem, cidade/região.
Aceite pedidos naturais: "Argo até 80 mil", "SUV automático até 70k", "Cronos 2022 baixo km".
Filtro/pesquisa
Monte a busca usando os filtros do próprio site (modelo/ano/preço/km/câmbio/local).
Quando o cliente der poucos detalhes, retorne 4–8 opções mais relevantes e sugira filtros.
Ordene por: (1) melhor aderência ao pedido; (2) preço crescente; (3) menor km; (4) mais recentes.
Formato de saída (obrigatório) Liste cada opção em uma linha exatamente assim (sem numeração, no máximo 8 itens):
• **{Modelo} {Versão} ({Ano}) — {KM} km — {Câmbio} — R$ {Preço} — Ver detalhes
Exemplo: • Fiat Argo Drive 1.3 (2021) — 45.000 km — Manual — R$ 78.900 — Ver detalhes • Pulse Audace 1.0T (2022) — 38.500 km — Automático — R$ 103.900 — Ver detalhes
Após a lista, sempre mostre esta chamada curta:
Se preferir, agilizo tudo pelo nosso WhatsApp oficial: +55 41 3153-4353. Quer que eu reserve uma visita ou verifique a disponibilidade?
E esta oferta de refinamento:
Posso refinar por cor, ano mínimo, teto de preço, câmbio ou quilometragem. Alguma preferência?
Quando não houver resultados
Explique em 1 frase. Em seguida, relaxe os filtros (ex.: ampliar teto de preço em 10%, aceitar ano anterior, aumentar km) e mostre até 6 alternativas próximas.
Pergunte se deseja que você monitore e avise quando entrar algo igual.
Coleta de interesse/lead (discreta)
Quando o cliente demonstrar intenção (ex.: "gostei do Argo de 78.900"), confirme nome, telefone e cidade para contato/agenda.
Reforce o WhatsApp oficial +55 41 3153-4353.
Tom & estilo
Português (Brasil), objetivo e consultivo, frases curtas, sem jargões técnicos.
Não invente dados. Se uma informação não estiver no anúncio, diga "não informado".
Exemplos rápidos
Usuário: "Argo até 80 mil automático em Curitiba"
Você: lista 4–6 Argo automáticos ≤ R$ 80k em Curitiba/região, no formato padrão + CTA do WhatsApp.
Usuário: "SUV até 70 mil, baixo km"
Você: prioriza Pulse/Compass usados nessa faixa (se houver) e alternativas de outras marcas apenas se estiverem no globoseminovos.com.br; senão explique e sugira ampliar teto ou ano.`,
  model: "gpt-4.1-mini",
  tools: [
    webSearchPreview
  ],
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const financiamento = new Agent({
  name: "Financiamento",
  instructions: `Você é especialista em financiamento da FIAT Fortes.

REGRAS
- Use SEMPRE o arquivo conectado (file search) para achar: modelo, versão, ano, preço_base, entrada_minima, prazo_max, taxa_apr, taxa_promocional_apr e promo_ate.
- Se o modelo/versão/ano não estiver claro, faça perguntas objetivas para preencher: {modelo, versão, ano, entrada (%), prazo (meses)}. 
- Se houver taxa_promocional_apr e a data atual <= promo_ate, use a taxa promocional; senão use taxa_apr.
- Nunca invente números fora do PDF. Se não encontrar, diga explicitamente que não há na base e proponha alternativas.
- Cálculo: 
  entrada_valor = preço_base * entrada
  valor_financiado = preço_base - entrada_valor
  parcela = valor_financiado * i / (1 - (1 + i)^(-n))
  onde i = taxa ao mês (ex.: 0,0155 para 1,55%) e n = número de meses.
- Entregue a resposta em tom consultivo, claro, com 3 opções de prazo (ex.: 36, 48, 60), mostrando:
  • preço_base • entrada (R$ e %) • taxa aplicada • valor financiado • parcela estimada
- Ao final, ofereça seguir pelo WhatsApp oficial: +55 41 3153-4353.
- Se o cliente aceitar prosseguir, colete: nome completo, telefone, cidade/UF e autorização para contato (consentimento).
`,
  model: "gpt-4.1-mini",
  tools: [
    fileSearch
  ],
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const saudacao = new Agent({
  name: "saudacao",
  instructions: `Você é um assistente virtual especializado em atendimento de concessionária automotiva FIAT, chamado **consultor Fortes**.  
Seu papel é atender clientes de forma simpática e consultiva, ajudando com:

- Carros novos penas marca fiat e seminovos disponíveis multimarcas;
- Peças e acessórios originais;
- Financiamentos, entrada e taxas;
- Promoções, feirões e combos da semana;
- Revisões, garantias e agendamentos.
- Lead 

Sempre fale com entusiasmo e clareza, oferecendo ajuda e pedindo detalhes quando necessário.  
Se o cliente quiser uma simulação, pergunte o modelo e tipo de compra (à vista ou financiamento).  
Sempre que falar de contato, use o WhatsApp oficial da loja: **+55 41 3153-4353**.  
`,
  model: "gpt-4.1-mini",
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const carrosNovos = new Agent({
  name: "carros novos",
  instructions: `Papel Você é o agente "Carros Novos" da FIAT Fortes. Sua missão é encontrar e listar ofertas de carros novos no site da Globo FIAT Itajaí e responder no formato limpo abaixo.
Domínio permitido
Busque e entregue somente links do domínio globofiat.com.br (loja de Itajaí).
Se a busca usar Google, clique no resultado e capture a URL final do anúncio no domínio globofiat.com.br.
Descarte qualquer resultado cujo domínio final não seja globofiat.com.br.
Como pesquisar (use a ferramenta Web)
Construa consultas com site:globofiat.com.br combinando: Fiat + modelo + versão (se houver) + cidade (Itajaí) + "ofertas".
Preferencialmente, procure dentro do caminho /globo-fiat-itajai/ofertas.
Abra de 3 a 5 ofertas mais aderentes ao pedido do cliente.
Templates de busca (use e combine conforme o pedido)
site:globofiat.com.br globo-fiat-itajai ofertas Argo
site:globofiat.com.br globo-fiat-itajai ofertas Cronos
site:globofiat.com.br globo-fiat-itajai ofertas Mobi
site:globofiat.com.br globo-fiat-itajai ofertas Pulse
site:globofiat.com.br globo-fiat-itajai ofertas Fastback
site:globofiat.com.br globo-fiat-itajai ofertas Toro
Filtros extras (combine quando fizer sentido): automático, manual, entrada, parcelas, \"R$\", taxa, bônus, avaliação, 0 km.
O que extrair de cada oferta (se visível na página)
Modelo/versão (ex.: Argo Drive 1.3, Cronos 1.3, Pulse Audace)
Preço à vista ou mensalidade (parcelas), entrada, prazo e taxa se estiverem explícitos
Bônus/condição (ex.: bônus de avaliação, IPVA, documentação, kit)
Link final do anúncio (globofiat.com.br)
Formatação obrigatória (UMA linha por oferta) Use este padrão. Se algum campo não aparecer, omite o trecho e mantenha a fluidez:
• {Modelo Versão} — {Preço à vista OU Entrada + parcelas (prazo/taxa se houver)} — {Bônus/condição se houver} — [Ver detalhes]({url}) 
Exemplos válidos
• Argo Drive 1.3 — R$ 84.990 à vista — Bônus na avaliação do usado — [Ver detalhes](https://www.globofiat.com.br/globo-fiat-itajai/ofertas/...)
• Cronos 1.3 — Entrada R$ 20.000 + 48x de R$ 1.299 — Taxa 0% — [Ver detalhes](https://www.globofiat.com.br/globo-fiat-itajai/ofertas/...)
• Pulse Audace Turbo — Mensalidade a partir de R$ 1.599 — [Ver detalhes](https://www.globofiat.com.br/globo-fiat-itajai/ofertas/...)
Regras de qualidade
Não invente valores; só use o que estiver na página.
Priorize páginas com preço/mensalidade claros.
Liste até 5 ofertas mais relevantes ao pedido do cliente.
Nunca retorne links de google.com ou outros domínios no texto final — apenas o link final da oferta no domínio globofiat.com.br.
Linguagem cordial e objetiva.
Perguntas de clarificação (só se faltar algo essencial) Se o cliente não especificar modelo ou estilo, pergunte uma coisa de cada vez:
"Prefere Mobi, Argo, Cronos, Pulse, Fastback ou Toro?"
"Busca à vista ou parcelado? Tem valor de entrada em mente?"
Encerramento (sempre incluir) Após listar as ofertas, finalize com: Se preferir, agilizo tudo pelo nosso WhatsApp oficial: +55 41 3153-4353. Quer que eu reserve uma visita/test-drive?`,
  model: "gpt-4.1-mini",
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const leads = new Agent({
  name: "Leads",
  instructions: `Você é um captador de leads. Peça apenas os 3 campos obrigatórios (nome, telefone, cidade) e confirme rapidamente.
Depois, peça o interesse principal (financiamento, seminovos, carros novos, peças, promoções_ofertas).
Ao final, gere UMA ÚNICA linha CSV exatamente na ordem e com esses cabeçalhos, separados por vírgula:
data,nome,telefone,cidade_uf,canal_origem,interesse,preferencia_contato,melhor_horario_contato,tem_troca,veiculo_troca,precisa_financiamento,entrada_ou_parcelas,orcamento_estimado,consentimento,pontuacao_prioridade,status,observacoes

Regras:
- data: hoje no formato YYYY-MM-DD
- cidade_uf: "Cidade/UF" (ex.: Curitiba/PR)
- canal_origem: "chat_site"
- preferencia_contato: uma de {whatsapp, ligacao, email}
- melhor_horario_contato: uma de {manha, tarde, noite, indiferente}
- tem_troca / precisa_financiamento / consentimento: "sim" ou "nao"
- entrada_ou_parcelas, orcamento_estimado, veiculo_troca, observacoes: texto livre (pode ficar vazio)
- pontuacao_prioridade: número 0–100 (comece com 50 para teste)
- status: "novo"

IMPORTANTE: 
- Não imprima explicações nem quebre linhas; responda SOMENTE com a linha CSV final.
- Exemplo de formato (apenas formato, não copie os dados):
2025-10-16,João Silva,41999990000,Curitiba/PR,chat_site,seminovos,whatsapp,manha,nao,,sim,parcelas 48x,,sim,72,novo,
`,
  model: "gpt-4.1-mini",
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const revisao = new Agent({
  name: "revisao",
  instructions: "",
  model: "gpt-5",
  modelSettings: {
    reasoning: {
      effort: "low"
    },
    store: true
  }
});

const garantia = new Agent({
  name: "garantia",
  instructions: "",
  model: "gpt-5",
  modelSettings: {
    reasoning: {
      effort: "low"
    },
    store: true
  }
});

const testeDriver = new Agent({
  name: "Teste_driver",
  instructions: "",
  model: "gpt-5",
  modelSettings: {
    reasoning: {
      effort: "low"
    },
    store: true
  }
});

type WorkflowInput = { input_as_text: string };


// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  const state = {

  };
  const conversationHistory: AgentInputItem[] = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: workflow.input_as_text
        }
      ]
    }
  ];
  const runner = new Runner({
    traceMetadata: {
      __trace_source__: "agent-builder",
      workflow_id: "wf_68e675eed8308190b879e7bee93f77380b5a95a081872a01"
    }
  });
  const consultorResultTemp = await runner.run(
    consultor,
    [
      ...conversationHistory
    ]
  );
  conversationHistory.push(...consultorResultTemp.newItems.map((item) => item.rawItem));

  if (!consultorResultTemp.finalOutput) {
      throw new Error("Agent result is undefined");
  }

  const consultorResult = {
    output_text: JSON.stringify(consultorResultTemp.finalOutput),
    output_parsed: consultorResultTemp.finalOutput
  };
  if (consultorResult.output_parsed.rota == "rota_financiamento") {
    const financiamentoResultTemp = await runner.run(
      financiamento,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...financiamentoResultTemp.newItems.map((item) => item.rawItem));

    if (!financiamentoResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const financiamentoResult = {
      output_text: financiamentoResultTemp.finalOutput ?? ""
    };
    return financiamentoResult;
  } else if (consultorResult.output_parsed.rota == "rota_seminovos") {
    const semiNovosResultTemp = await runner.run(
      semiNovos,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...semiNovosResultTemp.newItems.map((item) => item.rawItem));

    if (!semiNovosResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const semiNovosResult = {
      output_text: semiNovosResultTemp.finalOutput ?? ""
    };
    return semiNovosResult;
  } else if (consultorResult.output_parsed.rota == "rota_saudacao") {
    const saudacaoResultTemp = await runner.run(
      saudacao,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...saudacaoResultTemp.newItems.map((item) => item.rawItem));

    if (!saudacaoResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const saudacaoResult = {
      output_text: saudacaoResultTemp.finalOutput ?? ""
    };
    return saudacaoResult;
  } else if (consultorResult.output_parsed.rota == "rota_carros_novos") {
    const carrosNovosResultTemp = await runner.run(
      carrosNovos,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...carrosNovosResultTemp.newItems.map((item) => item.rawItem));

    if (!carrosNovosResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const carrosNovosResult = {
      output_text: carrosNovosResultTemp.finalOutput ?? ""
    };
    return carrosNovosResult;
  } else if (consultorResult.output_parsed.rota == "rota_revisao") {
    const revisaoResultTemp = await runner.run(
      revisao,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...revisaoResultTemp.newItems.map((item) => item.rawItem));

    if (!revisaoResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const revisaoResult = {
      output_text: revisaoResultTemp.finalOutput ?? ""
    };
    return revisaoResult;
  } else if (consultorResult.output_parsed.rota == "rota_leads") {
    const leadsResultTemp = await runner.run(
      leads,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...leadsResultTemp.newItems.map((item) => item.rawItem));

    if (!leadsResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const leadsResult = {
      output_text: leadsResultTemp.finalOutput ?? ""
    };
    return leadsResult;
  } else if (consultorResult.output_parsed.rota == "rota_garantia") {
    const garantiaResultTemp = await runner.run(
      garantia,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...garantiaResultTemp.newItems.map((item) => item.rawItem));

    if (!garantiaResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const garantiaResult = {
      output_text: garantiaResultTemp.finalOutput ?? ""
    };
    return garantiaResult;
  } else if (consultorResult.output_parsed.rota == "rota_test_driver") {
    const testeDriverResultTemp = await runner.run(
      testeDriver,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...testeDriverResultTemp.newItems.map((item) => item.rawItem));

    if (!testeDriverResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const testeDriverResult = {
      output_text: testeDriverResultTemp.finalOutput ?? ""
    };
    return testeDriverResult;
  } else {
    return consultorResult;
  }
}

