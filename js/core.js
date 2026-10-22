// core.js — busca posições abertas dos traders e decide se dá para copiar AGORA.
// Usado pelo site (navegador) e pela GitHub Action (scripts/snapshot.mjs), então
// não pode tocar no DOM.

export const HOSTS = {
  data: "https://data-api.polymarket.com",
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
  espn: "https://site.api.espn.com", // placar do futebol (Under) e NBA (props.html)
};
// Hosts que nunca passam pelo relay. A ESPN tem CORS aberto, mas em 20/10/2026 o navegador recusou
// site.api.espn.com ("Failed to fetch") enquanto o relay funcionava: com relay, ela passa por ele.
const DIRETO = new Set();

// Regras de cópia (mesmas do backtest): teto de 2 centavos acima do preço dele,
// nada depois do início do jogo, nada acima de 97 centavos (sem margem).
// Em azarões o teto é proporcional (no máximo 10% do preço): 2¢ sobre um preço de 2¢
// dobraria o preço (odd 47 → 24).
export const PADRAO = { tetoCentavos: 2, tetoRelativo: 0.10, toleranciaCentavos: 5, toleranciaRelativa: 0.25, precoMax: 0.97, pisoCentavos: 10 };
// Piso: se o preço caiu mais de 10¢ desde a entrada dele (a odd subiu muito), o cenário mudou
// (ex.: gol contra) e copiar é outra aposta. Na auditoria, essas cópias ao vivo deram -22% de ROI.
export const pisoDe = (preco, r = PADRAO) => preco - (r.pisoCentavos ?? 10) / 100;

// TRADER QUE VENDE ANTES DO FIM (trader.saida, de polymarket_traders/saidas_analise.py): segurar até o fim
// rendeu pelo menos 2 pontos a mais que sair junto com ele -> o alerta SAIR é só informativo.
export const seguraMelhor = (sd) => sd?.roi_segurando != null && sd?.roi_saida != null && sd.roi_segurando >= sd.roi_saida + 2;

// TAMANHO DA APOSTA DELE: quanto ele pôs neste mercado (total, não só o 1º minuto) contra a
// aposta típica dele (mediana, data/indices.json). Profissional que marca entrada com $1 para
// conferir depois não está apostando: isso não é sinal.
//   simbólica = menos de $20 ou menos de 10% da mediana -> não vira sinal
//   pequena   = menos de 50% da mediana                 -> só aviso (no histórico não rendeu menos)
// Histórico (5.443 entradas, total por mercado): < $20 copiando -15%; < 10% do normal -2%;
// 10–50% +7,7%; normal +2,7%; > 2x +5,6% (acerto 66%).
export const APOSTA = { minUsd: 20, simbolica: 0.10, pequena: 0.5, grande: 2 };
const usdTxt = (v) => "$" + Math.round(v).toLocaleString("pt-BR");
export function tamanhoAposta(valor, mediana) {
  if (valor == null || !(valor >= 0)) return null;
  const r = mediana ? valor / mediana : null;
  const classe = valor < APOSTA.minUsd || (r != null && r < APOSTA.simbolica) ? "simbolica"
    : r == null ? "sem-ref" : r < APOSTA.pequena ? "pequena" : r <= APOSTA.grande ? "normal" : "grande";
  const rel = r == null ? "" : r < 0.995 ? (r < 0.01 ? "menos de 1%" : `${Math.round(100 * r)}%`) + " da aposta típica dele" : `${r.toFixed(1).replace(".", ",")}× a aposta típica dele`;
  const ref = mediana ? ` (${usdTxt(mediana)})` : "";
  const rot = { simbolica: "aposta simbólica", pequena: "aposta pequena para ele", normal: "aposta normal dele", grande: "aposta grande, acima do normal dele", "sem-ref": "sem histórico para comparar" }[classe];
  return { valor, mediana: mediana || null, razao: r, classe, rotulo: rot, texto: `${usdTxt(valor)}${rel ? ` = ${rel}${ref}` : ""}` };
}
// Taxa de taker do Polymarket: 5% x p x (1 - p) por cota (quem compra do livro paga; quem deixa
// ordem parada no livro e é executado não paga). Medida na auditoria de out/2026.
export const taxa = (p) => 0.05 * p * (1 - p);
export const custoCopia = (p) => p + taxa(p);
export const tetoDe = (preco, r = PADRAO) => Math.min(preco + Math.min(r.tetoCentavos / 100, preco * (r.tetoRelativo ?? 1)), r.precoMax);
const toleranciaDe = (preco, r = PADRAO) => preco + Math.min(r.toleranciaCentavos / 100, preco * (r.toleranciaRelativa ?? 1));

export function criarApi({ relay = "", fetchFn = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = (host) => (relay && !DIRETO.has(host) ? `${relay.replace(/\/$/, "")}/${host}` : HOSTS[host]);
  async function get(host, path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchFn(base(host) + path, { signal: ctrl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${host}${path.split("?")[0]} respondeu ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
  return { get };
}

// "nfl-chi-atl-2026-10-18" -> "nfl"; slugs antigos sem esse formato caem nas tags do evento
const SLUG_JOGO = /^([a-z0-9]+)-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}/;
const TAGS = [
  ["counter-strike", "CS2"], ["cs2", "CS2"], ["league-of-legends", "LoL"], ["dota", "Dota 2"], ["valorant", "Valorant"],
  ["soccer", "Futebol"], ["basketball", "Basquete"], ["nba", "Basquete"], ["tennis", "Tenis"], ["nfl", "Futebol Americano"],
  ["baseball", "Beisebol"], ["mlb", "Beisebol"], ["hockey", "Hoquei"], ["nhl", "Hoquei"], ["ufc", "MMA/Boxe"], ["mma", "MMA/Boxe"],
  ["boxing", "MMA/Boxe"], ["cricket", "Criquete"], ["golf", "Golfe"], ["f1", "F1"], ["esports", "eSports"],
];

export function esporte(slug, evento, prefixos) {
  const m = SLUG_JOGO.exec(slug || "");
  if (m && prefixos[m[1]]) return prefixos[m[1]];
  const tags = (evento?.tags || []).map((t) => (t.slug || "").toLowerCase());
  for (const [k, nome] of TAGS) if (tags.includes(k)) return nome;
  return m ? m[1].toUpperCase() : FORA;
}

export const FORA = "Fora de esporte";

// Trader com "expira" (ISO) some sozinho depois do horário (usado para testes).
export const vigentes = (traders, agora = Date.now()) => (traders || []).filter((t) => !t.expira || Date.parse(t.expira) > agora);

// Nicho = esporte + tipo de mercado + momento. Um trader pode ter "esportes" (qualquer
// mercado daquele esporte) e/ou "nichos" (só aquele tipo de mercado, naquele momento).
export const NOME_TIPO = {
  moneyline: "vencedor", spreads: "handicap", totals: "total (mais/menos)", child_moneyline: "vencedor do mapa",
  map_handicap: "handicap de mapas", team_totals: "total do time", both_teams_to_score: "ambos marcam",
  points: "pontos do jogador", rebounds: "rebotes do jogador", assists: "assistências do jogador", threes: "cestas de 3 do jogador",
};
export const rotuloTipo = (t) => NOME_TIPO[t] || t || "outro";
export const rotuloNicho = (n) => [rotuloEsporte(n.area), n.tipo ? rotuloTipo(n.tipo) : null, n.momento || null].filter(Boolean).join(" · ");

function volumeMercado(evento, slug) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug);
  return Number(mk?.volumeNum ?? mk?.volume ?? 0) || 0;
}

// Preço médio negociado (no lado dele) nos 2 min antes da entrada, sem as ordens dele.
// Serve para saber se ele "absorveu" (pagou no/acima do mercado) ou "pescou" preço abaixo.
export async function nivelAntes(api, cond, asset, carteira, t0seg) {
  if (!cond || !t0seg) return null;
  const tr = await api.get("data", `/trades?market=${cond}&limit=500&start=${t0seg - 120}&end=${t0seg - 5}`).catch(() => null);
  let s = 0, u = 0;
  for (const x of tr || []) {
    if ((x.proxyWallet || "").toLowerCase() === carteira.toLowerCase()) continue;
    const q = x.asset === asset ? x.price : 1 - x.price;
    const usd = x.size * x.price;
    s += q * usd; u += usd;
  }
  return u > 0 ? s / u : null;
}

function tipoMercado(evento, slug) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug);
  return mk?.sportsMarketType || "";
}
// esportes em que vale gastar consulta (filtro rápido pelo slug)
const areasDo = (trader) => new Set([...(trader.esportes || []), ...(trader.nichos || []).map((n) => n.area)]);
function liberado(trader, sp, tipo, momento) {
  if ((trader.esportes || []).includes(sp)) return { ok: true, nicho: null };
  const n = (trader.nichos || []).find((x) => x.area === sp && (!x.tipo || x.tipo === tipo) && (!x.momento || x.momento === momento));
  return n ? { ok: true, nicho: n } : { ok: false, nicho: null };
}
// Como o trader se sai num mercado (data/mercados_trader.json, de polymarket_traders/mercados_trader.py):
// o recorte mais específico com amostra suficiente (esporte·tipo·momento > esporte·tipo > esporte·momento > esporte)
export function historicoNoMercado(mt, carteira, sp, tipo, momento) {
  const R = mt?.traders?.[carteira];
  if (!R) return null;
  const chaves = [`${sp}|${tipo}|${momento}`, `${sp}|${tipo}|*`, `${sp}|*|${momento}`, `${sp}|*|*`];
  const min = mt.jogos_min || 15;
  for (const k of chaves) if (R[k]?.jogos >= min) return { chave: k, ...R[k] };
  for (const k of chaves) if (R[k]) return { chave: k, ...R[k] };
  return null;
}
// momento em que ELE entrou (para o recorte certo do histórico)
export const momentoDaEntrada = (x) => (x.entrouEm && x.inicio ? (x.entrouEm >= x.inicio ? "ao vivo" : "pré-jogo") : x.momento || "pré-jogo");

export const NOME_ESPORTE = { Tenis: "Tênis", Hoquei: "Hóquei" };
export const rotuloEsporte = (s) => NOME_ESPORTE[s] || s;

function inicioDoJogo(evento, slug) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug) || evento?.markets?.[0];
  const s = mk?.gameStartTime || evento?.startTime;
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isFinite(t) ? t : null;
}

function melhorAsk(book) {
  const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
  const bids = (book?.bids || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => b.p - a.p);
  return { asks, ask: asks[0]?.p ?? null, bid: bids[0]?.p ?? null };
}

// Veredito de uma posição aberta: COPIAR / ESPERAR / NAO
export function avaliar({ pos, evento, book, trader, agora, regras = PADRAO, prefixos }) {
  const sp = esporte(pos.eventSlug || pos.slug, evento, prefixos);
  const inicio = inicioDoJogo(evento, pos.slug);
  const { asks, ask, bid } = melhorAsk(book);
  const preco = pos.avgPrice;
  const teto = tetoDe(preco, regras);
  const motivos = [];
  let status = "COPIAR";
  const piora = (s) => {
    if (s === "NAO" || (s === "ESPERAR" && status === "COPIAR")) status = s;
  };

  const encerrado = !book || evento?.closed || evento?.ended;
  // "period" varia por esporte (NS, 0/3, Q1...), então vale a flag ao vivo + o horário
  const comecou = evento?.live === true || evento?.ended === true || (inicio != null && agora >= inicio);
  if (encerrado) { piora("NAO"); motivos.push("mercado fechado para ordens"); }
  else if (comecou) { piora("NAO"); motivos.push("jogo já começou — regra: nunca copiar ao vivo"); }

  const tipo = tipoMercado(evento, pos.slug);
  const lib = liberado(trader, sp, tipo, "pré-jogo");
  const daEspecialidade = lib.ok;
  if (!daEspecialidade) {
    piora("NAO");
    motivos.push(areasDo(trader).has(sp) ? `${rotuloEsporte(sp)} · ${rotuloTipo(tipo)} não é o nicho dele` : `${rotuloEsporte(sp)} não é a especialidade dele`);
  }

  if (!encerrado) {
    if (ask == null) { piora("NAO"); motivos.push("sem ofertas de venda no livro"); }
    else if (ask < pisoDe(preco, regras)) { piora("NAO"); motivos.push(`o cenário mudou: a odd subiu de ${odd(preco)} para ${odd(ask)} desde a entrada dele`); }
    else if (ask >= regras.precoMax) { piora("NAO"); motivos.push(`odd ${odd(ask)} — sem margem`); }
    else if (ask > toleranciaDe(preco, regras)) { piora("NAO"); motivos.push(`odd caiu: ${odd(ask)} vs ${odd(preco)} dele`); }
    else if (ask > teto) { piora("ESPERAR"); motivos.push(`odd ${odd(ask)} abaixo da mínima ${odd(teto)} — deixe ordem limitada`); }
  }
  if (status === "COPIAR") motivos.push(`aceite odd a partir de ${odd(teto)}`);

  // quanto dá para comprar até o teto sem subir o preço
  const liquidez = asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0);

  return {
    status, motivos, esporte: sp, tipo, nicho: lib.nicho, daEspecialidade, inicio,
    horasParaInicio: inicio ? (inicio - agora) / 3.6e6 : null,
    ask, bid, teto, liquidez, precoDele: preco,
    placar: evento?.score || null, periodo: evento?.period || null,
  };
}

// Odd decimal = 1 / preço: odd 2,00 paga $20 para uma aposta de $10.
export const odd = (p) => (p == null || p <= 0 ? "–" : (1 / p).toFixed(2).replace(".", ","));

export const cents = (p) => {
  if (p == null) return "–";
  const c = Math.round(p * 1000) / 10;
  return `${Number.isInteger(c) ? c : c.toFixed(1).replace(".", ",")}¢`;
};

async function emLotes(itens, n, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); }
  }));
  return out;
}

// VENDAS recentes do trader (para o alerta "SAIR"): agrupa por lado, com a fração vendida.
// restante[asset] = cotas que ele ainda tem (posições); sem isso, usa as compras da lista.
export function vendasRecentes(atividade, desdeSeg, restante = {}) {
  const por = new Map();
  for (const t of atividade || []) {
    if (t.side !== "SELL" || t.timestamp < desdeSeg) continue;
    const v = por.get(t.asset) || { asset: t.asset, cond: t.conditionId, titulo: t.title, lado: t.outcome, slug: t.slug, eventSlug: t.eventSlug, t: t.timestamp, cotas: 0, valor: 0 };
    v.t = Math.min(v.t, t.timestamp); v.cotas += t.size; v.valor += t.size * t.price;
    por.set(t.asset, v);
  }
  return [...por.values()].map((v) => {
    const comprou = (atividade || []).filter((t) => t.side === "BUY" && t.asset === v.asset).reduce((s, t) => s + t.size, 0);
    const base = restante[v.asset] != null ? restante[v.asset] + v.cotas : comprou;
    return { ...v, preco: v.valor / v.cotas, frac: base > 0 ? Math.min(1, v.cotas / base) : null, aposta: descreverAposta(v.titulo, v.lado) };
  });
}

// Busca tudo de um trader: posições abertas + primeira compra de cada uma + evento + livro
export async function carregarTrader(api, trader, { prefixos, regras = PADRAO, agora = Date.now(), cacheEventos = new Map(), limiteAtividade = 500, soEspecialidade = false, maxPosicoes = Infinity, comNivel = true, indices = null, comLivro = true } = {}) {
  const w = trader.carteira;
  const [posicoes, atividade] = await Promise.all([
    api.get("data", `/positions?user=${w}&sizeThreshold=1&redeemable=false&limit=200`),
    limiteAtividade ? api.get("data", `/activity?user=${w}&type=TRADE&limit=${limiteAtividade}`) : Promise.resolve([]),
  ]);
  const primeiraCompra = {}, usdEntrada = {};
  const ultimaAtividade = (atividade || []).reduce((m, t) => Math.max(m, t.timestamp), 0);
  for (const t of atividade || []) {
    if (t.side !== "BUY") continue;
    primeiraCompra[t.asset] = Math.min(primeiraCompra[t.asset] ?? Infinity, t.timestamp);
  }
  // valor da primeira entrada (compras no 1º minuto), mesma base do modelo da nota
  for (const t of atividade || []) {
    if (t.side === "BUY" && t.timestamp <= primeiraCompra[t.asset] + 60) usdEntrada[t.asset] = (usdEntrada[t.asset] || 0) + t.usdcSize;
  }
  const maisAntigo = (atividade || []).length ? Math.min(...atividade.map((t) => t.timestamp)) : Infinity;
  let abertas = (posicoes || []).filter((p) => !p.redeemable && p.curPrice > 0.005 && p.curPrice < 0.995);
  // modo econômico (Worker): o esporte sai do slug, sem gastar consulta com o que nunca seria "Copiar"
  if (soEspecialidade) abertas = abertas.filter((p) => areasDo(trader).has(esporte(p.eventSlug || p.slug, null, prefixos)));
  if (abertas.length > maxPosicoes) abertas = abertas.sort((x, y) => (y.initialValue || 0) - (x.initialValue || 0)).slice(0, maxPosicoes);
  // dois lados no mesmo mercado = proteção/arbitragem: o lado menor nunca é sinal e o maior
  // só é se a posição líquida for relevante (lado menor < 50% das cotas do maior)
  const ladosPorMercado = {};
  for (const p of posicoes || []) if (!p.redeemable && p.size > 0) (ladosPorMercado[p.conditionId] ||= []).push(p);
  const itens = await emLotes(abertas, 4, async (pos) => {
    let ev = cacheEventos.get(pos.eventSlug);
    if (ev === undefined) {
      const r = await api.get("gamma", `/events?slug=${encodeURIComponent(pos.eventSlug)}`).catch(() => null);
      ev = r?.[0] || null;
      cacheEventos.set(pos.eventSlug, ev);
    }
    // sem livro (só para mostrar onde ele está): economiza uma consulta por posição
    const book = comLivro ? await api.get("clob", `/book?token_id=${pos.asset}`).catch(() => null) : null;
    const v = avaliar({ pos, evento: ev, book, trader, agora, regras, prefixos });
    const outros = (ladosPorMercado[pos.conditionId] || []).filter((o) => o.asset !== pos.asset);
    if (outros.length) {
      const maior = Math.max(...outros.map((o) => o.size));
      if (maior >= pos.size) { v.status = "NAO"; v.motivos = ["ele tem mais cotas no outro lado deste mercado", ...v.motivos.filter((m) => !m.startsWith("aceite"))]; }
      else if (maior >= 0.5 * pos.size) { v.status = "NAO"; v.motivos = [`posição quase neutra: ele também tem ${Math.round(100 * maior / pos.size)}% disso no outro lado`, ...v.motivos.filter((m) => !m.startsWith("aceite"))]; }
      else if (maior >= 0.05 * pos.size) v.motivos.push(`ele também tem ${Math.round(100 * maior / pos.size)}% disso no outro lado (aposta líquida continua neste)`);
    }
    // "SIM, A vence" + "SIM, B vence" no mesmo jogo é proteção, não palpite (só vale o maior, se dominar)
    const vence = (p) => /^yes$/i.test(p.outcome) && /^Will .+ win/i.test(p.title || "");
    if (vence(pos)) {
      const rivais = (posicoes || []).filter((o) => o.asset !== pos.asset && o.eventSlug === pos.eventSlug && !o.redeemable && vence(o));
      const maiorRival = rivais.length ? Math.max(...rivais.map((o) => o.initialValue || 0)) : 0;
      if (rivais.length && maiorRival * 2 > (pos.initialValue || 0)) {
        v.status = "NAO";
        v.motivos = ["ele apostou na vitória dos dois times deste jogo (proteção)", ...v.motivos.filter((m) => !m.startsWith("aceite"))];
      }
    }
    // aposta simbólica (ex.: $1 só para marcar a entrada) não é sinal
    const tamanho = tamanhoAposta(pos.initialValue, indices?.mediana_total?.[w]);
    if (tamanho?.classe === "simbolica") {
      v.status = "NAO";
      v.motivos = [`aposta simbólica: ${tamanho.texto}`, ...v.motivos.filter((m) => !m.startsWith("aceite"))];
    }
    // a primeira compra só é confiável se aconteceu depois do início da lista de atividade
    const t0 = primeiraCompra[pos.asset] && primeiraCompra[pos.asset] > maisAntigo ? primeiraCompra[pos.asset] : null;
    const antes = comNivel && t0 && v.status !== "NAO" ? await nivelAntes(api, pos.conditionId, pos.asset, w, t0) : null;
    return {
      titulo: pos.title, lado: pos.outcome, slug: pos.slug, eventSlug: pos.eventSlug, asset: pos.asset, cond: pos.conditionId, oi: pos.outcomeIndex,
      valorDele: pos.initialValue, cotasDele: pos.size, pnlDele: pos.cashPnl, tamanho, precoAtual: pos.curPrice,
      entrouEm: primeiraCompra[pos.asset] ? primeiraCompra[pos.asset] * 1000 : null,
      usdEntrada: t0 ? usdEntrada[pos.asset] : null, momento: "pré-jogo", antes, volMercado: volumeMercado(ev, pos.slug),
      tituloEvento: ev?.title || pos.title, pergunta: pos.title, aposta: descreverAposta(pos.title, pos.outcome), ...v,
    };
  });
  const ordem = { COPIAR: 0, ESPERAR: 1, NAO: 2 };
  itens.sort((a, b) => ordem[a.status] - ordem[b.status] || (a.inicio ?? 9e15) - (b.inicio ?? 9e15));
  const restante = Object.fromEntries((posicoes || []).map((p) => [p.asset, p.size]));
  const vendas = vendasRecentes(atividade, agora / 1000 - 3600, restante);
  return { carteira: w, posicoes: itens, vendas, ultimaAtividade: ultimaAtividade ? ultimaAtividade * 1000 : null };
}

export async function carregarTodos(api, traders, opts = {}) {
  const cacheEventos = new Map();
  const res = await emLotes(traders, 3, async (t) => {
    try {
      return await carregarTrader(api, t, { ...opts, cacheEventos });
    } catch (e) {
      return { carteira: t.carteira, erro: String(e.message || e), posicoes: [] };
    }
  });
  return { geradoEm: Date.now(), traders: res };
}

// ---------------------------------------------------------------------------
// AO VIVO: sinais de entrada que ainda dá para replicar.
// Um sinal = primeira compra do trader num mercado com o jogo em andamento,
// feita há menos de `janelaSeg`, com a odd atual ainda perto da dele.
// Precisa de acesso em tempo real (direto ou relay); o retrato de 10 min não serve.
export async function carregarSinaisAoVivo(api, trader, { prefixos, agora = Date.now(), regras = PADRAO, cacheEventos = new Map(), historicoSeg = 900, limiteAtividade = 100, soCopiaveis = false, comNivel = true, indices = null } = {}) {
  const w = trader.carteira;
  const atividade = (await api.get("data", `/activity?user=${w}&type=TRADE&limit=${limiteAtividade}`)) || [];
  const corte = agora / 1000 - historicoSeg;
  // primeira compra de cada ativo dentro da lista (se já comprava antes da janela, não é entrada nova)
  const porAtivo = new Map();
  for (const t of [...atividade].sort((a, b) => a.timestamp - b.timestamp)) {
    if (t.side !== "BUY") continue;
    const e = porAtivo.get(t.asset) || { t0: t.timestamp, usd: 0, cotas: 0, valor: 0, usdTotal: 0, ex: t };
    // usd inclui a taxa (se ele foi taker); valor = cotas x preço de mercado (sem taxa)
    if (t.timestamp <= e.t0 + 60) { e.usd += t.usdcSize; e.cotas += t.size; e.valor += t.size * t.price; }
    e.usdTotal += t.usdcSize; // tudo o que ele pôs neste lado até agora
    porAtivo.set(t.asset, e);
  }
  const maisAntigo = atividade.length ? Math.min(...atividade.map((t) => t.timestamp)) : 0;
  let novos = [...porAtivo.values()].filter((e) => e.t0 >= corte && e.t0 > maisAntigo && e.usd >= (trader.minUsd || 0));
  // modo econômico (Worker): só gasta consulta com entrada da especialidade e ainda dentro da janela
  if (soCopiaveis) {
    novos = novos.filter((e) => agora / 1000 - e.t0 <= trader.janelaSeg
      && areasDo(trader).has(esporte(e.ex.eventSlug || e.ex.slug, null, prefixos)));
  }
  const sinais = await emLotes(novos, 4, async (e) => {
    const t = e.ex;
    let ev = cacheEventos.get(t.eventSlug);
    if (ev === undefined) {
      const r = await api.get("gamma", `/events?slug=${encodeURIComponent(t.eventSlug)}`).catch(() => null);
      ev = r?.[0] || null;
      cacheEventos.set(t.eventSlug, ev);
    }
    const book = await api.get("clob", `/book?token_id=${t.asset}`).catch(() => null);
    const sp = esporte(t.eventSlug || t.slug, ev, prefixos);
    const inicio = inicioDoJogo(ev, t.slug);
    const { asks, ask } = melhorAsk(book);
    const preco = e.valor / e.cotas; // preço de mercado da entrada dele (sem taxa)
    const teto = tetoDe(preco, regras);
    const idadeSeg = agora / 1000 - e.t0;
    const aoVivo = ev?.live === true || (inicio != null && e.t0 * 1000 >= inicio);
    const motivos = [];
    let status = "COPIAR";
    const nao = (m) => { status = "NAO"; motivos.push(m); };
    if (!aoVivo) nao("entrada antes do jogo (aparece na aba pré-jogo)");
    const tipo = tipoMercado(ev, t.slug);
    const lib = liberado(trader, sp, tipo, "ao vivo");
    if (!lib.ok) nao(areasDo(trader).has(sp) ? `${rotuloEsporte(sp)} · ${rotuloTipo(tipo)} não é o nicho dele` : `${rotuloEsporte(sp)} não é a especialidade dele`);
    if (!book || ev?.closed || ev?.ended) nao("mercado fechado");
    else if (ask == null) nao("sem ofertas no livro");
    else if (ask < pisoDe(preco, regras)) nao(`o cenário mudou: a odd subiu de ${odd(preco)} para ${odd(ask)} desde a entrada dele`);
    else if (ask > teto) nao(`odd caiu: ${odd(ask)} vs ${odd(preco)} dele`);
    if (idadeSeg > trader.janelaSeg) nao(`passou da janela de ${Math.round(trader.janelaSeg / 60)} min`);
    const outroLado = atividade.some((a) => a.side === "BUY" && a.conditionId === t.conditionId && a.asset !== t.asset);
    if (outroLado) nao("ele também comprou o outro lado deste mercado (proteção, não é aposta direcional)");
    const tamanho = tamanhoAposta(e.usdTotal, indices?.mediana_total?.[w]);
    if (tamanho?.classe === "simbolica") nao(`aposta simbólica: ${tamanho.texto}`);
    if (status === "COPIAR") motivos.push(`aceite odd a partir de ${odd(teto)}`);
    const antes = comNivel && status === "COPIAR" ? await nivelAntes(api, t.conditionId, t.asset, w, e.t0) : null;
    return {
      cond: t.conditionId, oi: t.outcomeIndex, usdEntrada: e.usd, momento: "ao vivo", antes, volMercado: volumeMercado(ev, t.slug), inicio,
      carteira: w, asset: t.asset, titulo: t.title, lado: t.outcome, slug: t.slug, eventSlug: t.eventSlug,
      tituloEvento: ev?.title || t.title, pergunta: t.title, aposta: descreverAposta(t.title, t.outcome),
      esporte: sp, tipo, nicho: lib.nicho, placar: ev?.score || null, periodo: ev?.period || null,
      entrouEm: e.t0 * 1000, idadeSeg, restanteSeg: trader.janelaSeg - idadeSeg, valorDele: e.usdTotal, tamanho, precoDele: preco,
      ask, teto, liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0), status, motivos,
    };
  });
  sinais.sort((a, b) => (a.status === b.status ? b.entrouEm - a.entrouEm : a.status === "COPIAR" ? -1 : 1));
  return { carteira: w, sinais, vendas: vendasRecentes(atividade, corte), ultimaAtividade: atividade[0]?.timestamp ? atividade[0].timestamp * 1000 : null };
}

export async function carregarAoVivo(api, traders, opts = {}) {
  const cacheEventos = opts.cacheEventos || new Map();
  const res = await emLotes(traders, 4, async (t) => {
    try { return await carregarSinaisAoVivo(api, t, { ...opts, cacheEventos }); }
    catch (e) { return { carteira: t.carteira, erro: String(e.message || e), sinais: [] }; }
  });
  return { geradoEm: Date.now(), traders: res };
}

// ---------------------------------------------------------------------------
// INÍCIO CONFIRMADO (auditoria de 18/10/2026): em ~5% dos jogos o horário oficial está adiantado (início
// atrasado) e o "minuto 10" ainda é pré-jogo. Ao vivo o preço mexe muito mais que antes: só vale o sinal se
// a soma das variações minuto a minuto nos 10 min depois do início for >= 3x a dos 10 min antes.
// Na auditoria: futebol (contra) com início confirmado +8,7% (355 jogos, P 0,00); basquete (seguir) +20% a +27%.
// preço do lado 0 no instante t (último ponto até t, se não for mais velho que velhoSeg)
const precoEm = (hist, t, velhoSeg = 900) => {
  let p = null, tt = null;
  for (const x of hist) { if (x.t <= t) { p = x.p; tt = x.t; } else break; }
  return p != null && t - tt <= velhoSeg ? p : null;
};
const variacao = (hist, a, b) => {
  let s = 0, ant = null;
  for (let t = a; t <= b; t += 60) { const p = precoEm(hist, t, 300); if (p != null && ant != null) s += Math.abs(p - ant); if (p != null) ant = p; }
  return s;
};
export function inicioConfirmado(hists, inicioSeg, agoraSeg) {
  const fim = Math.min(agoraSeg, inicioSeg + 600);
  const antes = hists.reduce((s, h) => s + variacao(h, inicioSeg - 600, inicioSeg), 0);
  const depois = hists.reduce((s, h) => s + variacao(h, inicioSeg, fim), 0);
  return depois >= 3 * antes + 0.01;
}

// ---------------------------------------------------------------------------
// BASQUETE AO VIVO, SEGUIR QUEM DISPAROU (polymarket_traders/basquete_vivo_real.py, 18/10/2026)
// Aos 20 ou 30 min de jogo, o preço de um time subiu >= 5% (odd caiu) desde o início -> comprar esse time.
// Base completa (918 jogos, 90 dias, sem filtro de volume), 1º negócio real + taxa: só FORA da NBA/WNBA:
// Euroliga/Eurocup +33% a +46% (30-46 jogos), outras ligas +13% a +19% (113-180), metades positivas;
// NBA/WNBA -11% a +2,5% (preço eficiente). Mercados rasos ($10-170 perto do preço): EM OBSERVAÇÃO.
export const SEGUIR_BKT = { checagens: [20, 30], janelaMin: 2, forte: 0.10, moderado: 0.05, fora: ["nba", "wnba"], nivel: "observar" };
// hist = [{t, p}] do lado 0 (ordenado); devolve o lado que disparou ou null
export function avaliarSeguirBkt(hist, inicioSeg, agoraSeg) {
  if (!inicioConfirmado([hist], inicioSeg, agoraSeg)) return null;
  const p0 = precoEm(hist, inicioSeg, 900), pN = precoEm(hist, agoraSeg, 900);
  if (p0 == null || pN == null || !(p0 > 0.05 && p0 < 0.95 && pN > 0.05 && pN < 0.95) || pN === p0) return null;
  const lado = pN > p0 ? 0 : 1;
  const var_ = lado === 0 ? p0 / pN - 1 : (1 - p0) / (1 - pN) - 1; // variação da odd do lado (negativa = caiu)
  if (var_ > -SEGUIR_BKT.moderado) return null;
  return { lado, p0: lado === 0 ? p0 : 1 - p0, preco: lado === 0 ? pN : 1 - pN, var: var_, forca: var_ <= -SEGUIR_BKT.forte ? "forte" : "moderado" };
}

// ---------------------------------------------------------------------------
// FUTEBOL UNDER AO VIVO (polymarket_traders/fut_under_placar.py; 19/10/2026)
// 0x0 entre 28' e 33' (placar da ESPN) -> Under 0,5 do 1º tempo. Negócio real (1º negócio de compra + taxa),
// 60 dias: +16% (385 jogos, P 0,00), positivo nos dois períodos de 30 dias; odd 1,60-2,10: +12%.
// Mecanismo: o 0x0 sai mais do que o modelo de Poisson simples prevê.
// O Under PRÉ-JOGO (1º tempo e Under 1,5 a 0,25-0,40, 10-30 min antes; backtest +11% a +13%) foi RETIRADO em
// 19/10/2026 a pedido do usuário: nos sinais reais deu 34, -26% (1º tempo) e 22, -19,5% (Under 1,5).
// Os sinais antigos ficam no registro com a regra "pre".
// (O "contra o movimento" do futebol foi retirado em 19/10/2026 a pedido do usuário.)
// Os mercados do 1º tempo e as linhas extras ficam no evento "<jogo>-more-markets" (tag soccer, mesmo horário).
export const UNDER_FUT = {
  vivo: { minDe: 28, minAte: 33, precoMin: 0.30, precoMax: 0.77, mercado: ["first_half_totals", 0.5] },
  nivel: "observar",
};
const ESPN_PLACAR = "/apis/site/v2/sports/soccer/all/scoreboard";
const PALAVRAS_FORA = new Set(["fc", "cf", "sc", "afc", "ac", "club", "cd", "sk", "fk", "the", "de", "ca", "sv", "as", "us", "if", "bk", "ssc", "rc", "cp", "ud", "sd", "rcd", "vfb", "vfl", "tsg", "fsv", "1", "04", "05", "1899", "1909"]);
const palavras = (s) => new Set(String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !PALAVRAS_FORA.has(w)) || []);
// semelhança entre um nome do Polymarket e os nomes de um time da ESPN (0-1; mesma regra do fut_under_placar.py)
export function semelhanca(nome, nomes) {
  const A = palavras(nome);
  let melhor = 0;
  for (const n of nomes) {
    const B = palavras(n);
    if (!A.size || !B.size) continue;
    let comum = 0;
    for (const w of A) if (B.has(w)) comum++;
    melhor = Math.max(melhor, comum / Math.min(A.size, B.size));
  }
  return melhor;
}
const tituloJogo = (t) => String(t || "").replace(/\s*-\s*More Markets$/i, "");
export const timesDe = (txt) => { const a = String(txt || "").split(":")[0].split(/\s+vs\.?\s+/i); return a.length === 2 ? a.map((s) => s.trim()) : null; };

function underDe(ev, tipo, linha) {
  for (const m of ev.markets || []) {
    if (m.sportsMarketType !== tipo || !m.clobTokenIds || m.closed || /corner/i.test(m.question || "")) continue;
    if (!(Math.abs(+m.line - linha) < 1e-6)) continue;
    const ku = JSON.parse(m.outcomes || "[]").findIndex((o) => /^under/i.test(o));
    if (ku >= 0) return { m, ku, tok: JSON.parse(m.clobTokenIds) };
  }
  return null;
}

async function eventosFutebol(api, deMs, ateMs) {
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  const out = [];
  for (let off = 0; off < 400; off += 100) {
    const p = (await api.get("gamma", `/events?tag_slug=soccer&closed=false&active=true&start_time_min=${iso(deMs)}&start_time_max=${iso(ateMs)}&limit=100&offset=${off}`).catch(() => null)) || [];
    out.push(...p);
    if (p.length < 100) break;
  }
  return out;
}

// Sinais de Under agora. checar(m, regra) (opcional, assíncrono) decide se vale consultar o livro desse mercado
// (o Worker usa para não repetir o mesmo mercado a cada minuto). Cada livro consultado = 1 consulta.
export async function buscarUnderFut(api, agoraMs = Date.now(), { maxLivros = 40, checar = null } = {}) {
  const out = [];
  let livros = 0;
  const avaliar = async (ev, u, regra, extra = {}) => {
    if (livros >= maxLivros || (checar && !(await checar(u.m, regra)))) return;
    livros++;
    const R = UNDER_FUT[regra];
    const book = await api.get("clob", `/book?token_id=${u.tok[u.ku]}`).catch(() => null);
    const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
    const ask = asks[0]?.p;
    if (ask == null || ask < R.precoMin || ask > R.precoMax) return;
    const teto = Math.min(ask + 0.01, R.precoMax);
    const ht = u.m.sportsMarketType.startsWith("first_half");
    out.push({
      regra, asset: u.tok[u.ku], cond: u.m.conditionId, oi: u.ku, slug: u.m.slug, eventSlug: ev.slug, tituloEvento: tituloJogo(ev.title),
      pergunta: u.m.question, lado: "Under", aposta: `${ht ? "1º tempo" : "Jogo"}: menos de ${num(+u.m.line)} gol${+u.m.line > 1 ? "s" : ""} (Under ${num(+u.m.line)})`,
      esporte: "Futebol", tipo: u.m.sportsMarketType, liga: ev.slug.split("-")[0].toUpperCase(),
      inicio: Date.parse(u.m.gameStartTime || ev.startTime), entrouEm: agoraMs, precoDele: ask, ask, teto,
      liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0), vol: +(u.m.volumeNum || 0), ...extra,
    });
  };
  // AO VIVO: jogos que começaram há 20-60 min com Under 0,5 do 1º tempo; placar e minuto pela ESPN
  const vivo = (await eventosFutebol(api, agoraMs - 60 * 60e3, agoraMs - 20 * 60e3)).map((ev) => ({ ev, u: underDe(ev, ...UNDER_FUT.vivo.mercado) })).filter((x) => x.u);
  if (vivo.length) {
    const esp = await api.get("espn", ESPN_PLACAR).catch(() => null);
    const nomes = (t) => [t?.displayName, t?.shortDisplayName, t?.name, t?.abbreviation].filter(Boolean);
    const jogos = (esp?.events || []).filter((e) => e.status?.type?.state === "in" && e.status?.period === 1).map((e) => {
      const cs = Object.fromEntries((e.competitions?.[0]?.competitors || []).map((c) => [c.homeAway, c]));
      return { ini: Date.parse(e.date), min: (+e.status.clock || 0) / 60, gc: +(cs.home?.score ?? -1), gf: +(cs.away?.score ?? -1), casa: nomes(cs.home?.team), fora: nomes(cs.away?.team) };
    }).filter((j) => j.min >= UNDER_FUT.vivo.minDe && j.min <= UNDER_FUT.vivo.minAte && j.gc === 0 && j.gf === 0);
    for (const { ev, u } of vivo) {
      const times = timesDe(u.m.question) || timesDe(tituloJogo(ev.title));
      if (!times || !jogos.length) continue;
      const ini = Date.parse(u.m.gameStartTime || ev.startTime);
      let melhor = null;
      for (const j of jogos) {
        if (Math.abs(j.ini - ini) > 2 * 3600e3) continue;
        const s = semelhanca(times[0], j.casa) + semelhanca(times[1], j.fora);
        if (s >= 1.3 && (!melhor || s > melhor.s)) melhor = { s, j };
      }
      if (melhor) await avaliar(ev, u, "vivo", { minuto: Math.round(melhor.j.min), placar: "0x0" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PROPS DA NBA NA DRAFTKINGS (API pública da ESPN, 20/10/2026; página props.html e Worker)
// sports.core.api.espn.com/.../events/<id>/competitions/<id>/odds/100/propBets: DraftKings (provedor 100),
// ~1.200 itens por jogo, com linha e odd ATUAIS e de ABERTURA (pontos, rebotes, assistências, cestas de 3 e PRA). A ESPN responde 403 ao Cloudflare (Worker); o
// navegador e a Action (scripts/linhas_dk.mjs, que grava o histórico) leem normalmente. Em "Total Points/Rebounds/Assists" cada jogador
// tem 2 itens na mesma linha: o 1º é o Over (conferido contra o Polymarket: 11/11). O nome do jogador vem do
// elenco do time (site.api.espn.com/.../teams/<id>/roster), pelo id do atleta.
export const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
export const PROPS_DK = {
  "Total Points": "points", "Total Rebounds": "rebounds", "Total Assists": "assists",
  "Total 3-Point Field Goals": "threes", "Total Points, Rebounds, and Assists": "pra",
};
// datas (AAAAMMDD, horário de Nova York, que é o dia do jogo para a ESPN) de hoje e de amanhã
export const datasNba = (agoraMs = Date.now()) => [0, 1].map((d) => new Date(agoraMs + d * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replaceAll("-", ""));
// chance do Over sem a margem da casa, a partir das duas odds decimais
export const semMargem = (over, under) => (over > 1 && under > 1 ? (1 / over) / (1 / over + 1 / under) : null);
// itens do propBets -> { "<idAtleta>|<tipo>": { atleta, tipo, linha, linhaAb, over, under, overAb, underAb, p, pAb, em } }
export function lerPropsDk(itens) {
  const grupos = new Map();
  for (const x of itens || []) {
    const tipo = PROPS_DK[x.type?.name];
    const atleta = (x.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1];
    if (!tipo || !atleta) continue;
    const k = `${atleta}|${tipo}`;
    (grupos.get(k) || grupos.set(k, []).get(k)).push(x);
  }
  const out = {};
  for (const [k, L] of grupos) {
    if (L.length !== 2) continue; // Over e Under na mesma linha
    const [o, u] = L;
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
    const r = {
      atleta: k.split("|")[0], tipo: k.split("|")[1],
      linha: num(o.current?.target?.value), linhaAb: num(o.open?.target?.value),
      over: num(o.odds?.decimal?.value), under: num(u.odds?.decimal?.value),
      overAb: num(o.odds?.decimal?.open), underAb: num(u.odds?.decimal?.open), em: o.lastUpdated || null,
    };
    if (r.linha == null) continue;
    r.p = semMargem(r.over, r.under);
    r.pAb = semMargem(r.overAb, r.underAb);
    out[k] = r;
  }
  return out;
}
// MERCADOS DO JOGO na DraftKings: vencedor, handicap e total vêm de .../odds (abertura e agora); total do
// 1º tempo e de cada quarto vêm do propBets (itens sem atleta; 1º item = Over, como nos props: conferido
// contra o Polymarket no 1º tempo de 3 jogos). porLinha = quanto 1 ponto de linha muda a chance perto do
// meio (normal com o desvio típico: jogo ~18 pts, 1º tempo ~12,5, quarto ~8,5, margem do jogo ~13).
export const MERCADOS_JOGO = {
  ml: { nome: "Vencedor", ordem: 1 },
  spread: { nome: "Handicap", ordem: 2, porLinha: 0.031 },
  total: { nome: "Total do jogo", ordem: 3, porLinha: 0.022 },
  h1: { nome: "Total do 1º tempo", ordem: 4, porLinha: 0.032, prop: "1st Half Total" },
  q1: { nome: "Total do 1º quarto", ordem: 5, porLinha: 0.047, prop: "1st Quarter Total" },
  q2: { nome: "Total do 2º quarto", ordem: 6, porLinha: 0.047, prop: "2nd Quarter Total" },
  q3: { nome: "Total do 3º quarto", ordem: 7, porLinha: 0.047, prop: "3rd Quarter Total" },
  q4: { nome: "Total do 4º quarto", ordem: 8, porLinha: 0.047, prop: "4th Quarter Total" },
};
const decimalDe = (x) => {
  if (x == null) return null;
  const d = parseFloat(x.decimal ?? x.value);
  if (Number.isFinite(d) && d > 1) return d;
  const a = parseFloat(x.american ?? x);
  return Number.isFinite(a) && a !== 0 ? (a > 0 ? 1 + a / 100 : 1 + 100 / -a) : null;
};
const numDe = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// item de .../odds + itens do propBets -> { "jogo|<k>": { k, linha, linhaAb, a, b, aAb, bAb, p, pAb } }
// a/b = odds decimais: Over/Under nos totais; visitante/mandante no vencedor e no handicap (linha = do visitante)
export function lerJogoDk(odd, itens) {
  const out = {};
  const por = (k, r) => {
    if (r.a == null || r.b == null) return;
    r.p = semMargem(r.a, r.b); r.pAb = semMargem(r.aAb, r.bAb);
    out[`jogo|${k}`] = { k, ...r };
  };
  if (odd) {
    const fo = odd.awayTeamOdds || {}, ca = odd.homeTeamOdds || {};
    por("ml", { linha: null, linhaAb: null, a: decimalDe(fo.current?.moneyLine), b: decimalDe(ca.current?.moneyLine), aAb: decimalDe(fo.open?.moneyLine), bAb: decimalDe(ca.open?.moneyLine) });
    por("spread", { linha: numDe(fo.current?.pointSpread?.american), linhaAb: numDe(fo.open?.pointSpread?.american),
      a: decimalDe(fo.current?.spread), b: decimalDe(ca.current?.spread), aAb: decimalDe(fo.open?.spread), bAb: decimalDe(ca.open?.spread) });
    por("total", { linha: numDe(odd.current?.total?.american ?? odd.overUnder), linhaAb: numDe(odd.open?.total?.american),
      a: decimalDe(odd.current?.over), b: decimalDe(odd.current?.under), aAb: decimalDe(odd.open?.over), bAb: decimalDe(odd.open?.under) });
  }
  for (const [k, m] of Object.entries(MERCADOS_JOGO)) {
    if (!m.prop) continue;
    const L = (itens || []).filter((x) => !x.athlete && x.type?.name === m.prop);
    if (L.length !== 2) continue;
    const [o, u] = L;
    por(k, { linha: numDe(o.current?.target?.value), linhaAb: numDe(o.open?.target?.value),
      a: numDe(o.odds?.decimal?.value), b: numDe(u.odds?.decimal?.value), aAb: numDe(o.odds?.decimal?.open), bAb: numDe(u.odds?.decimal?.open) });
  }
  return out;
}

// tudo da DraftKings de um jogo: props dos jogadores + mercados do jogo (1 consulta a .../odds + páginas do propBets)
export async function buscarDk(getJson, idEspn) {
  const comp = `${ESPN_CORE}/events/${idEspn}/competitions/${idEspn}`;
  const base = `${comp}/odds/100/propBets?lang=en&region=us&limit=1000`;
  const [p1, odds] = await Promise.all([getJson(`${base}&page=1`), getJson(`${comp}/odds`).catch(() => null)]);
  const itens = [...(p1?.items || [])];
  for (let pg = 2; pg <= Math.min(p1?.pageCount || 1, 4); pg++) itens.push(...((await getJson(`${base}&page=${pg}`))?.items || []));
  const odd = (odds?.items || []).find((o) => String(o.provider?.id) === "100") || null;
  return { props: lerPropsDk(itens), jogo: lerJogoDk(odd, itens) };
}

// PROJEÇÃO × LINHA (aba Edge e acompanhamento das apostas do Edgely, 21/10/2026)
// chance do Over pela projeção (aproximação ainda não calibrada com resultados): pontos e PRA ~ normal com desvio
// 1,4·√projeção (25 pts → ~7, 10 → ~4,4); rebotes, assistências e cestas de 3 ~ binomial negativa com variância
// 1,25 × a média (contagem: Over 6,5 = 7 ou mais; linha inteira devolve no empate).
const fiNormal = (z) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - q : q;
};
export function chanceOver(tipo, media, linha) {
  if (media == null || linha == null || media <= 0) return null;
  if (tipo === "points" || tipo === "pra") return 1 - fiNormal((linha - media) / (1.4 * Math.sqrt(media)));
  const q = 1 / 1.25, r = (media * q) / (1 - q); // p(0) = q^r; p(k+1) = p(k)·(k+r)/(k+1)·(1−q)
  const k0 = Math.floor(linha);
  let pk = q ** r, abaixo = 0;
  for (let k = 0; k < k0; k++) { abaixo += pk; pk *= ((k + r) / (k + 1)) * (1 - q); }
  return Number.isInteger(linha) ? (1 - abaixo - pk) / (1 - pk) : 1 - abaixo - pk;
}
// lado com o maior valor esperado nas odds dadas: { dif, lado, odd, chance, mercado, ev }
export function edgeProp(tipo, proj, linha, over, under) {
  if (proj == null || linha == null || !over || !under) return null;
  const po = chanceOver(tipo, proj, linha);
  if (po == null) return null;
  const evO = po * over - 1, evU = (1 - po) * under - 1, ehOver = evO >= evU, p = semMargem(over, under);
  return { dif: proj - linha, lado: ehOver ? "Over" : "Under", odd: ehOver ? over : under, chance: ehOver ? po : 1 - po,
    mercado: p == null ? null : ehOver ? p : 1 - p, ev: ehOver ? evO : evU };
}
// quanto 1 ponto de linha muda a chance do Over perto do meio (normal com o desvio típico de cada estatística:
// pontos ~6, rebotes ~2,8, assistências ~2,3, cestas de 3 ~1,5, PRA ~8). Serve para comparar a chance em linhas diferentes.
export const POR_LINHA_PROPS = { points: 0.065, rebounds: 0.14, assists: 0.17, threes: 0.25, pra: 0.05 };
// movimento EQUIVALENTE de uma prop desde a abertura, em chance do Over na linha de abertura (mudança de linha + de odd)
export const movimentoProp = (tipo, linhaAb, linha, pAb, p) =>
  linhaAb == null || linha == null || p == null || pAb == null ? null : (linha - linhaAb) * POR_LINHA_PROPS[tipo] + (p - pAb);
// nome para casar jogadores entre fontes (sem acento, sufixo nem pontuação)
export const nomeChave = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z]/g, "");
// valor da estatística no box score da ESPN (summary → boxscore.players[].statistics[0]: keys + athletes[].stats)
export function estatisticaBox(keys, stats, tipo) {
  const v = (k) => { const i = keys.indexOf(k); return i < 0 ? null : parseFloat(String(stats[i]).split("-")[0]); };
  const n = { points: v("points"), rebounds: v("rebounds"), assists: v("assists"), threes: v("threePointFieldGoalsMade-threePointFieldGoalsAttempted") };
  if (tipo === "pra") return [n.points, n.rebounds, n.assists].some((x) => x == null || Number.isNaN(x)) ? null : n.points + n.rebounds + n.assists;
  return Number.isFinite(n[tipo]) ? n[tipo] : null;
}

// ---------------------------------------------------------------------------
// NOTA DA ENTRADA (modelo de polymarket_traders/modelo_entrada.py, data/indices.json)
// Vantagem esperada de quem copia, somando o efeito de fatores que se repetiram no tempo:
//   trader  = convicção (aposta vs mediana dele) + como entrou (absorveu ou "pescou" preço)
//   mercado = ao vivo / pré-jogo + liquidez do mercado
//   odd     = faixa de odd + quanto a odd andou desde a entrada dele + antecedência
// Índice = 50 + 6 × efeito (em pontos de probabilidade); nota = 50 + 6 × vantagem esperada.
const faixaDe = (v, faixas) => (faixas.find(([a, b]) => v >= a && v < b) || faixas[faixas.length - 1])[2];

export const ROTULO_FATOR = {
  conviccao: "Tamanho da aposta dele", entrada: "Como ele entrou", momento: "Momento", liquidez: "Liquidez do mercado",
  faixa_odd: "Faixa de odd", deriva: "Odd desde a entrada dele", antecedencia: "Antecedência", mercado_dele: "Mercado da aposta", perfil_dele: "Perfil dele",
};

export function notaEntrada(x, trader, ind, mt = null) {
  if (!ind?.efeitos) return null;
  const med = ind.mediana_usd?.[trader.carteira];
  const dEntrada = x.antes != null ? (x.precoDele - x.antes) * 100 : null;
  const dDeriva = x.ask != null ? (x.ask - x.precoDele) * 100 : null;
  const faixas = {
    conviccao: med && x.usdEntrada ? (x.usdEntrada / med < 0.5 ? "aposta < metade da mediana dele" : x.usdEntrada / med <= 2 ? "aposta normal" : "aposta > 2x a mediana dele") : null,
    entrada: dEntrada == null ? null : dEntrada < -1 ? "pagou abaixo do mercado (>1¢)" : dEntrada <= 1 ? "pagou no nível do mercado" : "pagou acima do mercado (>1¢)",
    momento: x.momento || null,
    liquidez: x.volMercado ? (x.volMercado < 5e4 ? "mercado < $50 mil" : x.volMercado < 5e5 ? "$50–500 mil" : "> $500 mil") : null,
    faixa_odd: faixaDe(x.precoDele, ind.faixas_odd),
    deriva: dDeriva == null ? null : dDeriva < -0.5 ? "odd melhorou (preço caiu)" : dDeriva <= 0.5 ? "igual (±0,5¢)" : "odd piorou até 2¢",
    antecedencia: x.momento === "pré-jogo" && x.inicio && x.entrouEm ? faixaDe((x.inicio - x.entrouEm) / 3.6e6, ind.faixas_lead) : null,
  };
  const soma = { trader: 0, mercado: 0, odd: 0 };
  const fatores = [];
  for (const [nome, faixa] of Object.entries(faixas)) {
    if (!ind.grupos[nome]) continue; // fator testado e deixado fora do modelo
    const e = faixa ? ind.efeitos[nome]?.[faixa]?.efeito ?? 0 : 0;
    soma[ind.grupos[nome]] += e;
    fatores.push({ nome, rotulo: ROTULO_FATOR[nome], grupo: ind.grupos[nome], faixa, efeito: e });
  }
  // MERCADO DA APOSTA (data/mercados_trader.json): fora do nicho, a vantagem esperada vai para a
  // média medida fora do nicho (~0) e só se move para o histórico dele ali com peso jogos/(jogos+K);
  // K alto porque o histórico fora do nicho quase não se repetiu na validação.
  if (mt && x.esporte && x.esporte !== FORA) {
    const mom = momentoDaEntrada(x);
    let efeito = 0, faixa = "no nicho dele";
    if (!liberado(trader, x.esporte, x.tipo, mom).ok) {
      const h = historicoNoMercado(mt, trader.carteira, x.esporte, x.tipo, mom);
      const peso = h?.edge != null ? h.jogos / (h.jogos + (mt.k_fora || 80)) : 0;
      // comparado à vantagem de uma aposta DENTRO do nicho (não à média geral do modelo)
      efeito = (1 - peso) * (mt.edge_fora ?? 0) + peso * (h?.edge ?? 0) - (mt.edge_nicho ?? 0.05);
      faixa = h?.edge != null
        ? `fora do nicho · histórico dele aqui ${h.roi_copia >= 0 ? "+" : "−"}${Math.abs(h.roi_copia).toFixed(0)}% em ${h.jogos} jogos (peso ${Math.round(100 * peso)}%)`
        : "fora do nicho · sem histórico dele aqui";
    }
    soma.trader += efeito;
    fatores.push({ nome: "mercado_dele", rotulo: ROTULO_FATOR.mercado_dele, grupo: "trader", faixa, efeito });
  }
  // PERFIL DELE (polymarket_traders/nota_trader.py, 18/10/2026): nível geral do trader + quanto ELE rende
  // nesta faixa de odd, encolhidos pela amostra (n/(n+K)). Na validação (60/40 no tempo, por trader) foi a
  // única peculiaridade pessoal que melhorou a nota; tamanho e antecedência por trader não se repetiram.
  const pf = ind.perfil?.[trader.carteira];
  if (pf && x.precoDele != null) {
    const fo = faixaDe(x.precoDele, ind.faixas_odd);
    const o = pf.odd?.[fo];
    // no máximo ±3 pts (18 pontos de nota): a validação deu 86% de chance de melhora, não o bastante para dominar
    const efeito = Math.max(-0.03, Math.min(0.03, (pf.base || 0) + (o?.efeito || 0)));
    const p1 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")}`;
    const faixa = `nível dele ${p1(pf.base || 0)} pts (${pf.n} apostas)` + (o ? ` · ${fo}: ${p1(o.efeito)} pts (${o.n} apostas dele)` : ` · ${fo}: sem histórico dele`);
    soma.trader += efeito;
    fatores.push({ nome: "perfil_dele", rotulo: ROTULO_FATOR.perfil_dele, grupo: "trader", faixa, efeito });
  }
  const pts = (v) => Math.max(0, Math.min(100, Math.round(50 + ind.escala * 100 * v)));
  const esperado = ind.media + soma.trader + soma.mercado + soma.odd;
  let nota = pts(esperado), aviso = null;
  // o modelo mede o tamanho em faixas largas; a regra abaixo garante que aposta pequena
  // nunca sai como "boa"/"forte" e que aposta simbólica sai como "fraca"
  const tamanho = x.tamanho || tamanhoAposta(x.valorDele, ind.mediana_total?.[trader.carteira]);
  if (tamanho?.classe === "simbolica") { nota = Math.min(nota, 49); aviso = `Aposta simbólica: ${tamanho.texto}. Não é sinal.`; }
  // aposta "pequena" (10–50% do normal) não rendeu menos no histórico (+7,7% copiando, n=588): só avisa
  else if (tamanho?.classe === "pequena") aviso = `Aposta pequena para ele: ${tamanho.texto}.`;
  return {
    trader: pts(soma.trader), mercado: pts(soma.mercado), odd: pts(soma.odd), nota, esperado, tamanho, aviso,
    rotulo: nota >= 66 ? "forte" : nota >= 58 ? "boa" : nota >= 50 ? "neutra" : "fraca", fatores,
  };
}


// ---------------------------------------------------------------------------
// O QUE APOSTAR, sem ambiguidade. No Polymarket muitos mercados são perguntas de sim/não
// ("Will Como 1907 win?" -> No = Como NÃO vence), handicaps ("Spread: A (-3.5)" -> lado B
// = B +3,5) e totais ("O/U 51.5" -> Over = mais de 51,5). Mostrar só o título do jogo e o
// lado ("No", "Over") faz apostar no mercado errado.
const num = (v) => String(v).replace(".", ",");
export function descreverAposta(pergunta, lado) {
  const q = String(pergunta || ""), l = String(lado || "");
  const sim = /^yes$/i.test(l), nao = /^no$/i.test(l);
  let m = q.match(/^Will (.+?) win(?: on [\d-]+)?\??$/i);
  if (m && (sim || nao)) return sim ? `${m[1]} vence` : `${m[1]} NÃO vence (empate ou derrota)`;
  m = q.match(/^Will (?:the )?(.+?) (?:end in a )?draw\b/i) || q.match(/^(.+?) end in a draw\??$/i);
  if (m && (sim || nao)) return sim ? "Empate" : "NÃO dá empate";
  m = q.match(/Spread:\s*(.+?)\s*\(([-+]?\d+(?:\.\d+)?)\)/i);
  if (m) {
    const linha = parseFloat(m[2]);
    if (l === m[1]) return `${l} ${linha > 0 ? "+" : "−"}${num(Math.abs(linha))} (handicap)`;
    return `${l} ${linha > 0 ? "−" : "+"}${num(Math.abs(linha))} (handicap)`;
  }
  m = q.match(/O\/U\s*(\d+(?:\.\d+)?)/i);
  if (m && /^(over|under)$/i.test(l)) return `${/^over$/i.test(l) ? "Mais" : "Menos"} de ${num(m[1])} (${l.toLowerCase()})`;
  if (sim || nao) return `${sim ? "SIM" : "NÃO"} para: ${q}`;
  return `${l} vence`;
}
export const linkMercado = (x) => `https://polymarket.com/event/${encodeURIComponent(x.eventSlug)}${x.slug && x.slug !== x.eventSlug ? `/${encodeURIComponent(x.slug)}` : ""}`;

// ---------------------------------------------------------------------------
// PLACAR: reconstruir entradas passadas e conferir resultados
// (mesma lógica de polymarket_traders/nichos_analise.py)

// 1/0 se o mercado já resolveu para esse lado; null se ainda não
export function resultadoMercado(evento, slug, oi) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug);
  if (!mk || !mk.closed) return null;
  let p;
  try { p = JSON.parse(mk.outcomePrices || "[]").map(Number); } catch { return null; }
  const v = p[oi];
  return v === 0 || v === 1 ? v : null;
}

// primeira compra em cada mercado (compras no 1º minuto) a partir da atividade
export function entradasDe(atividade) {
  const por = new Map();
  for (const t of [...atividade].sort((a, b) => a.timestamp - b.timestamp)) {
    if (t.side !== "BUY") continue;
    const e = por.get(t.asset) || { t0: t.timestamp, usd: 0, cotas: 0, valor: 0, usdTotal: 0, ex: t };
    if (t.timestamp <= e.t0 + 60) { e.usd += t.usdcSize; e.cotas += t.size; e.valor += t.size * t.price; }
    e.usdTotal += t.usdcSize;
    por.set(t.asset, e);
  }
  const maisAntigo = atividade.length ? Math.min(...atividade.map((t) => t.timestamp)) : 0;
  const lista = [...por.values()].filter((e) => e.t0 > maisAntigo && e.cotas > 0)
    // preco = preço de mercado (sem taxa); precoPago = custo dele (com a taxa, se foi taker)
    .map((e) => ({ ...e, preco: e.valor / e.cotas, precoPago: e.usd / e.cotas }));
  // dois lados do mesmo mercado: vale a PRIMEIRA entrada (a que viraria sinal), salvo proteção, ou seja,
  // o outro lado comprado até 15 min depois dela somando >= 50% do que ele pôs no primeiro nesse período.
  // Virar de lado mais tarde (vendeu e comprou o outro) não apaga a entrada original; a virada não conta.
  const PROTECAO_SEG = 900;
  const comprasAte = (asset, ate) => atividade.filter((t) => t.side === "BUY" && t.asset === asset && t.timestamp <= ate).reduce((s, t) => s + t.usdcSize, 0);
  const porCond = new Map();
  for (const e of lista) (porCond.get(e.ex.conditionId) || porCond.set(e.ex.conditionId, []).get(e.ex.conditionId)).push(e);
  const limpo = [];
  for (const L of porCond.values()) {
    if (L.length === 1) { limpo.push(L[0]); continue; }
    L.sort((a, b) => a.t0 - b.t0);
    const ate = L[0].t0 + PROTECAO_SEG;
    const outro = L.slice(1).reduce((s, e) => s + comprasAte(e.ex.asset, ate), 0);
    if (outro < 0.5 * comprasAte(L[0].ex.asset, ate)) limpo.push(L[0]);
  }
  return limpo.sort((a, b) => b.t0 - a.t0);
}

// preço que quem copia pagaria 1 min depois (1º negócio de compra no lado dele) e o nível antes
export async function precosEntrada(api, cond, asset, carteira, t0) {
  const janela = (a, b) => api.get("data", `/trades?market=${cond}&limit=500&start=${a}&end=${b}`).catch(() => []);
  const tr = [...((await janela(t0 - 120, t0 + 120)) || []), ...((await janela(t0 + 120, t0 + 660)) || [])];
  let s = 0, u = 0, p60 = null, t60 = Infinity;
  for (const x of tr) {
    if ((x.proxyWallet || "").toLowerCase() === carteira.toLowerCase()) continue;
    const meu = x.asset === asset;
    const q = meu ? x.price : 1 - x.price;
    if (x.timestamp >= t0 - 120 && x.timestamp < t0 - 5) { s += q * x.size * x.price; u += x.size * x.price; }
    const compra = (meu && x.side === "BUY") || (!meu && x.side === "SELL");
    if (compra && x.timestamp >= t0 + 60 && x.timestamp < t60) { t60 = x.timestamp; p60 = q; }
  }
  return { p60, antes: u > 0 ? s / u : null };
}

// usados pelo placar (scripts/desempenho.mjs) e pelo Worker
export { liberado, tipoMercado as tipoDoMercado, inicioDoJogo as inicioDoMercado, volumeMercado as volumeDoMercado };
