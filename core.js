// core.js — busca posições abertas dos traders e decide se dá para copiar AGORA.
// Usado pelo site (navegador) e pela GitHub Action (scripts/snapshot.mjs), então
// não pode tocar no DOM.

export const HOSTS = {
  data: "https://data-api.polymarket.com",
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
};

// Regras de cópia (mesmas do backtest): teto de 2 centavos acima do preço dele,
// nada depois do início do jogo, nada acima de 97 centavos (sem margem).
// Em azarões o teto é proporcional (no máximo 10% do preço): 2¢ sobre um preço de 2¢
// dobraria o preço (odd 47 → 24).
export const PADRAO = { tetoCentavos: 2, tetoRelativo: 0.10, toleranciaCentavos: 5, toleranciaRelativa: 0.25, precoMax: 0.97 };
export const tetoDe = (preco, r = PADRAO) => Math.min(preco + Math.min(r.tetoCentavos / 100, preco * (r.tetoRelativo ?? 1)), r.precoMax);
const toleranciaDe = (preco, r = PADRAO) => preco + Math.min(r.toleranciaCentavos / 100, preco * (r.toleranciaRelativa ?? 1));

export function criarApi({ relay = "", fetchFn = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = (host) => (relay ? `${relay.replace(/\/$/, "")}/${host}` : HOSTS[host]);
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

// Busca tudo de um trader: posições abertas + primeira compra de cada uma + evento + livro
export async function carregarTrader(api, trader, { prefixos, regras = PADRAO, agora = Date.now(), cacheEventos = new Map(), limiteAtividade = 500, soEspecialidade = false, maxPosicoes = Infinity, comNivel = true } = {}) {
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
  const itens = await emLotes(abertas, 4, async (pos) => {
    let ev = cacheEventos.get(pos.eventSlug);
    if (ev === undefined) {
      const r = await api.get("gamma", `/events?slug=${encodeURIComponent(pos.eventSlug)}`).catch(() => null);
      ev = r?.[0] || null;
      cacheEventos.set(pos.eventSlug, ev);
    }
    const book = await api.get("clob", `/book?token_id=${pos.asset}`).catch(() => null);
    const v = avaliar({ pos, evento: ev, book, trader, agora, regras, prefixos });
    // a primeira compra só é confiável se aconteceu depois do início da lista de atividade
    const t0 = primeiraCompra[pos.asset] && primeiraCompra[pos.asset] > maisAntigo ? primeiraCompra[pos.asset] : null;
    const antes = comNivel && t0 && v.status !== "NAO" ? await nivelAntes(api, pos.conditionId, pos.asset, w, t0) : null;
    return {
      titulo: pos.title, lado: pos.outcome, slug: pos.slug, eventSlug: pos.eventSlug, asset: pos.asset, cond: pos.conditionId,
      valorDele: pos.initialValue, cotasDele: pos.size, pnlDele: pos.cashPnl,
      entrouEm: primeiraCompra[pos.asset] ? primeiraCompra[pos.asset] * 1000 : null,
      usdEntrada: t0 ? usdEntrada[pos.asset] : null, momento: "pré-jogo", antes, volMercado: volumeMercado(ev, pos.slug),
      tituloEvento: ev?.title || pos.title, ...v,
    };
  });
  const ordem = { COPIAR: 0, ESPERAR: 1, NAO: 2 };
  itens.sort((a, b) => ordem[a.status] - ordem[b.status] || (a.inicio ?? 9e15) - (b.inicio ?? 9e15));
  return { carteira: w, posicoes: itens, ultimaAtividade: ultimaAtividade ? ultimaAtividade * 1000 : null };
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
export async function carregarSinaisAoVivo(api, trader, { prefixos, agora = Date.now(), regras = PADRAO, cacheEventos = new Map(), historicoSeg = 900, limiteAtividade = 100, soCopiaveis = false, comNivel = true } = {}) {
  const w = trader.carteira;
  const atividade = (await api.get("data", `/activity?user=${w}&type=TRADE&limit=${limiteAtividade}`)) || [];
  const corte = agora / 1000 - historicoSeg;
  // primeira compra de cada ativo dentro da lista (se já comprava antes da janela, não é entrada nova)
  const porAtivo = new Map();
  for (const t of [...atividade].sort((a, b) => a.timestamp - b.timestamp)) {
    if (t.side !== "BUY") continue;
    const e = porAtivo.get(t.asset) || { t0: t.timestamp, usd: 0, cotas: 0, ex: t };
    if (t.timestamp <= e.t0 + 60) { e.usd += t.usdcSize; e.cotas += t.size; }
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
    const preco = e.usd / e.cotas;
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
    else if (ask > teto) nao(`odd caiu: ${odd(ask)} vs ${odd(preco)} dele`);
    if (idadeSeg > trader.janelaSeg) nao(`passou da janela de ${Math.round(trader.janelaSeg / 60)} min`);
    if (status === "COPIAR") motivos.push(`aceite odd a partir de ${odd(teto)}`);
    const antes = comNivel && status === "COPIAR" ? await nivelAntes(api, t.conditionId, t.asset, w, e.t0) : null;
    return {
      cond: t.conditionId, usdEntrada: e.usd, momento: "ao vivo", antes, volMercado: volumeMercado(ev, t.slug), inicio,
      carteira: w, asset: t.asset, titulo: t.title, lado: t.outcome, slug: t.slug, eventSlug: t.eventSlug,
      tituloEvento: ev?.title || t.title, esporte: sp, tipo, nicho: lib.nicho, placar: ev?.score || null, periodo: ev?.period || null,
      entrouEm: e.t0 * 1000, idadeSeg, restanteSeg: trader.janelaSeg - idadeSeg, valorDele: e.usd, precoDele: preco,
      ask, teto, liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0), status, motivos,
    };
  });
  sinais.sort((a, b) => (a.status === b.status ? b.entrouEm - a.entrouEm : a.status === "COPIAR" ? -1 : 1));
  return { carteira: w, sinais, ultimaAtividade: atividade[0]?.timestamp ? atividade[0].timestamp * 1000 : null };
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
// NOTA DA ENTRADA (modelo de polymarket_traders/modelo_entrada.py, data/indices.json)
// Vantagem esperada de quem copia, somando o efeito de fatores que se repetiram no tempo:
//   trader  = convicção (aposta vs mediana dele) + como entrou (absorveu ou "pescou" preço)
//   mercado = ao vivo / pré-jogo + liquidez do mercado
//   odd     = faixa de odd + quanto a odd andou desde a entrada dele + antecedência
// Índice = 50 + 6 × efeito (em pontos de probabilidade); nota = 50 + 6 × vantagem esperada.
const faixaDe = (v, faixas) => (faixas.find(([a, b]) => v >= a && v < b) || faixas[faixas.length - 1])[2];

export const ROTULO_FATOR = {
  conviccao: "Tamanho da aposta dele", entrada: "Como ele entrou", momento: "Momento", liquidez: "Liquidez do mercado",
  faixa_odd: "Faixa de odd", deriva: "Odd desde a entrada dele", antecedencia: "Antecedência",
};

export function notaEntrada(x, trader, ind) {
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
    const e = faixa ? ind.efeitos[nome]?.[faixa]?.efeito ?? 0 : 0;
    soma[ind.grupos[nome]] += e;
    fatores.push({ nome, rotulo: ROTULO_FATOR[nome], grupo: ind.grupos[nome], faixa, efeito: e });
  }
  const pts = (v) => Math.max(0, Math.min(100, Math.round(50 + ind.escala * 100 * v)));
  const esperado = ind.media + soma.trader + soma.mercado + soma.odd;
  const nota = pts(esperado);
  return {
    trader: pts(soma.trader), mercado: pts(soma.mercado), odd: pts(soma.odd), nota, esperado,
    rotulo: nota >= 66 ? "forte" : nota >= 58 ? "boa" : nota >= 50 ? "neutra" : "fraca", fatores,
  };
}
