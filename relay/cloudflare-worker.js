// relay/cloudflare-worker.js — GERADO por scripts/build-worker.mjs. Não edite à mão:
// edite core.js ou relay/worker.src.js e rode o build de novo.
// Como publicar: veja "Alertas no Telegram" no README.

// ===== core.js =====
// core.js — busca posições abertas dos traders e decide se dá para copiar AGORA.
// Usado pelo site (navegador) e pela GitHub Action (scripts/snapshot.mjs), então
// não pode tocar no DOM.

const HOSTS = {
  data: "https://data-api.polymarket.com",
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
};

// Regras de cópia (mesmas do backtest): teto de 2 centavos acima do preço dele,
// nada depois do início do jogo, nada acima de 97 centavos (sem margem).
// Em azarões o teto é proporcional (no máximo 10% do preço): 2¢ sobre um preço de 2¢
// dobraria o preço (odd 47 → 24).
const PADRAO = { tetoCentavos: 2, tetoRelativo: 0.10, toleranciaCentavos: 5, toleranciaRelativa: 0.25, precoMax: 0.97, pisoCentavos: 10 };
// Piso: se o preço caiu mais de 10¢ desde a entrada dele (a odd subiu muito), o cenário mudou
// (ex.: gol contra) e copiar é outra aposta. Na auditoria, essas cópias ao vivo deram -22% de ROI.
const pisoDe = (preco, r = PADRAO) => preco - (r.pisoCentavos ?? 10) / 100;

// TAMANHO DA APOSTA DELE: quanto ele pôs neste mercado (total, não só o 1º minuto) contra a
// aposta típica dele (mediana, data/indices.json). Profissional que marca entrada com $1 para
// conferir depois não está apostando: isso não é sinal.
//   simbólica = menos de $20 ou menos de 10% da mediana -> não vira sinal
//   pequena   = menos de 50% da mediana                 -> só aviso (no histórico não rendeu menos)
// Histórico (5.443 entradas, total por mercado): < $20 copiando -15%; < 10% do normal -2%;
// 10–50% +7,7%; normal +2,7%; > 2x +5,6% (acerto 66%).
const APOSTA = { minUsd: 20, simbolica: 0.10, pequena: 0.5, grande: 2 };
const usdTxt = (v) => "$" + Math.round(v).toLocaleString("pt-BR");
function tamanhoAposta(valor, mediana) {
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
const taxa = (p) => 0.05 * p * (1 - p);
const custoCopia = (p) => p + taxa(p);
const tetoDe = (preco, r = PADRAO) => Math.min(preco + Math.min(r.tetoCentavos / 100, preco * (r.tetoRelativo ?? 1)), r.precoMax);
const toleranciaDe = (preco, r = PADRAO) => preco + Math.min(r.toleranciaCentavos / 100, preco * (r.toleranciaRelativa ?? 1));

function criarApi({ relay = "", fetchFn = globalThis.fetch, timeoutMs = 15000 } = {}) {
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

function esporte(slug, evento, prefixos) {
  const m = SLUG_JOGO.exec(slug || "");
  if (m && prefixos[m[1]]) return prefixos[m[1]];
  const tags = (evento?.tags || []).map((t) => (t.slug || "").toLowerCase());
  for (const [k, nome] of TAGS) if (tags.includes(k)) return nome;
  return m ? m[1].toUpperCase() : FORA;
}

const FORA = "Fora de esporte";

// Trader com "expira" (ISO) some sozinho depois do horário (usado para testes).
const vigentes = (traders, agora = Date.now()) => (traders || []).filter((t) => !t.expira || Date.parse(t.expira) > agora);

// Nicho = esporte + tipo de mercado + momento. Um trader pode ter "esportes" (qualquer
// mercado daquele esporte) e/ou "nichos" (só aquele tipo de mercado, naquele momento).
const NOME_TIPO = {
  moneyline: "vencedor", spreads: "handicap", totals: "total (mais/menos)", child_moneyline: "vencedor do mapa",
  map_handicap: "handicap de mapas", team_totals: "total do time", both_teams_to_score: "ambos marcam",
};
const rotuloTipo = (t) => NOME_TIPO[t] || t || "outro";
const rotuloNicho = (n) => [rotuloEsporte(n.area), n.tipo ? rotuloTipo(n.tipo) : null, n.momento || null].filter(Boolean).join(" · ");

function volumeMercado(evento, slug) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug);
  return Number(mk?.volumeNum ?? mk?.volume ?? 0) || 0;
}

// Preço médio negociado (no lado dele) nos 2 min antes da entrada, sem as ordens dele.
// Serve para saber se ele "absorveu" (pagou no/acima do mercado) ou "pescou" preço abaixo.
async function nivelAntes(api, cond, asset, carteira, t0seg) {
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
const NOME_ESPORTE = { Tenis: "Tênis", Hoquei: "Hóquei" };
const rotuloEsporte = (s) => NOME_ESPORTE[s] || s;

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
function avaliar({ pos, evento, book, trader, agora, regras = PADRAO, prefixos }) {
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
const odd = (p) => (p == null || p <= 0 ? "–" : (1 / p).toFixed(2).replace(".", ","));

const cents = (p) => {
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
async function carregarTrader(api, trader, { prefixos, regras = PADRAO, agora = Date.now(), cacheEventos = new Map(), limiteAtividade = 500, soEspecialidade = false, maxPosicoes = Infinity, comNivel = true, indices = null } = {}) {
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
    const book = await api.get("clob", `/book?token_id=${pos.asset}`).catch(() => null);
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
      valorDele: pos.initialValue, cotasDele: pos.size, pnlDele: pos.cashPnl, tamanho,
      entrouEm: primeiraCompra[pos.asset] ? primeiraCompra[pos.asset] * 1000 : null,
      usdEntrada: t0 ? usdEntrada[pos.asset] : null, momento: "pré-jogo", antes, volMercado: volumeMercado(ev, pos.slug),
      tituloEvento: ev?.title || pos.title, pergunta: pos.title, aposta: descreverAposta(pos.title, pos.outcome), ...v,
    };
  });
  const ordem = { COPIAR: 0, ESPERAR: 1, NAO: 2 };
  itens.sort((a, b) => ordem[a.status] - ordem[b.status] || (a.inicio ?? 9e15) - (b.inicio ?? 9e15));
  return { carteira: w, posicoes: itens, ultimaAtividade: ultimaAtividade ? ultimaAtividade * 1000 : null };
}

async function carregarTodos(api, traders, opts = {}) {
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
async function carregarSinaisAoVivo(api, trader, { prefixos, agora = Date.now(), regras = PADRAO, cacheEventos = new Map(), historicoSeg = 900, limiteAtividade = 100, soCopiaveis = false, comNivel = true, indices = null } = {}) {
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
  return { carteira: w, sinais, ultimaAtividade: atividade[0]?.timestamp ? atividade[0].timestamp * 1000 : null };
}

async function carregarAoVivo(api, traders, opts = {}) {
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

const ROTULO_FATOR = {
  conviccao: "Tamanho da aposta dele", entrada: "Como ele entrou", momento: "Momento", liquidez: "Liquidez do mercado",
  faixa_odd: "Faixa de odd", deriva: "Odd desde a entrada dele", antecedencia: "Antecedência",
};

function notaEntrada(x, trader, ind) {
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
function descreverAposta(pergunta, lado) {
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
const linkMercado = (x) => `https://polymarket.com/event/${encodeURIComponent(x.eventSlug)}${x.slug && x.slug !== x.eventSlug ? `/${encodeURIComponent(x.slug)}` : ""}`;

// ---------------------------------------------------------------------------
// PLACAR: reconstruir entradas passadas e conferir resultados
// (mesma lógica de polymarket_traders/nichos_analise.py)

// 1/0 se o mercado já resolveu para esse lado; null se ainda não
function resultadoMercado(evento, slug, oi) {
  const mk = (evento?.markets || []).find((m) => m.slug === slug);
  if (!mk || !mk.closed) return null;
  let p;
  try { p = JSON.parse(mk.outcomePrices || "[]").map(Number); } catch { return null; }
  const v = p[oi];
  return v === 0 || v === 1 ? v : null;
}

// primeira compra em cada mercado (compras no 1º minuto) a partir da atividade
function entradasDe(atividade) {
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
  // dois lados do mesmo mercado: só o lado dominante conta, e só se o outro for < 50% dele
  const porCond = new Map();
  for (const e of lista) (porCond.get(e.ex.conditionId) || porCond.set(e.ex.conditionId, []).get(e.ex.conditionId)).push(e);
  const limpo = [];
  for (const L of porCond.values()) {
    if (L.length === 1) { limpo.push(L[0]); continue; }
    L.sort((a, b) => b.usdTotal - a.usdTotal);
    if (L.slice(1).reduce((s, e) => s + e.usdTotal, 0) < 0.5 * L[0].usdTotal) limpo.push(L[0]);
  }
  return limpo.sort((a, b) => b.t0 - a.t0);
}

// preço que quem copia pagaria 1 min depois (1º negócio de compra no lado dele) e o nível antes
async function precosEntrada(api, cond, asset, carteira, t0) {
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

// ===== Worker: relay do site + alertas no Telegram =====
// (o arquivo publicado, relay/cloudflare-worker.js, é gerado por scripts/build-worker.mjs:
//  core.js + este arquivo num arquivo só, para colar no painel da Cloudflare)
//
// 1) RELAY: GET /data/..., /gamma/..., /clob/... repassam a API pública do Polymarket com CORS.
// 2) ALERTAS (Cron Trigger "* * * * *"):
//    - a cada minuto: entradas AO VIVO novas dos traders de data/traders_live.json
//    - a cada minuto, um trader de data/traders.json em rodízio: posições PRÉ-JOGO copiáveis
//    O plano grátis permite 50 consultas externas por execução; o contador ORCAMENTO
//    corta o trabalho antes disso.
//    Cada sinal vai uma vez só para o Telegram (memória no KV "ENVIADOS").
// 3) GET /teste  -> manda uma mensagem de teste no Telegram
//    GET /verificar -> roda a verificação agora e devolve o resumo em JSON
//    GET /status -> últimas execuções do agendamento (para ver se algum minuto foi pulado)
//    GET /registro -> todos os sinais enviados (últimos 90 dias) com o resultado, para o placar
//
// REGISTRO: cada sinal enviado vira uma chave "r:..." no KV, com os dados nos metadados
// (assim uma única listagem traz tudo). A cada 10 min o Worker confere o resultado dos
// sinais cujo jogo já acabou (até 8 por vez).
//
// Configuração no painel (Settings → Variables and Secrets):
//   TELEGRAM_TOKEN   (secret)  token do bot, do @BotFather
//   TELEGRAM_CHAT_ID (secret)  seu chat id
//   BANCA, PCT       (opcional) para sugerir o valor da aposta (ex.: 1000 e 1.5)
//   SITE_URL         (opcional) padrão https://maxmox.github.io/Trader_Poly
// KV: crie um namespace e ligue com o nome ENVIADOS (Settings → Bindings → KV).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const SITE_PADRAO = "https://maxmox.github.io/Trader_Poly";

let listas = null, listasEm = 0;
async function carregarListas(env) {
  if (listas && Date.now() - listasEm < 5 * 60_000) return listas;
  const base = (env.SITE_URL || SITE_PADRAO).replace(/\/$/, "");
  const get = async (p) => (await fetch(`${base}/${p}?t=${Date.now()}`, { cf: { cacheTtl: 0 } })).json();
  const [pre, vivo, prefixos, indices] = await Promise.all([get("data/traders.json"), get("data/traders_live.json"), get("data/prefixos.json"),
    get("data/indices.json").catch(() => null)]);
  listas = { pre: pre.traders, vivo: vivo.traders, prefixos, indices };
  listasEm = Date.now();
  return listas;
}

const memoria = new Map(); // fallback quando não há KV (dura enquanto a instância vive)
async function jaEnviado(env, chave) {
  if (env.ENVIADOS) return (await env.ENVIADOS.get(chave)) !== null;
  return memoria.has(chave);
}
async function marcar(env, chave, ttlSeg) {
  if (env.ENVIADOS) await env.ENVIADOS.put(chave, "1", { expirationTtl: Math.max(60, ttlSeg) });
  else memoria.set(chave, Date.now());
}

async function telegram(env, texto) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, erro: "TELEGRAM_TOKEN / TELEGRAM_CHAT_ID não configurados" };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: texto, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  return j.ok ? { ok: true } : { ok: false, erro: j.description || `HTTP ${r.status}` };
}

const h = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const usd = (v) => "$" + Math.round(v).toLocaleString("pt-BR");
const horaBR = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dataBR = (ms) => new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function aposta(env, teto) {
  const banca = parseFloat(env.BANCA || "0"), pct = parseFloat(env.PCT || "0");
  if (!banca || !pct) return "";
  const v = (banca * pct) / 100;
  return `\nAposta: <b>${usd(v)}</b> → retorno <b>${usd(v / custoCopia(teto))}</b> se ganhar (com a taxa)`;
}

function linhaNota(n) {
  if (!n) return "";
  const ic = { forte: "🟢", boa: "🔵", neutra: "⚪", fraca: "🔴" }[n.rotulo];
  return `\n${ic} Nota <b>${n.nota}</b> (${n.rotulo}) · trader ${n.trader} · mercado ${n.mercado} · odd/tempo ${n.odd}`;
}

// o quanto ele apostou pesa tanto quanto a odd: $1 de um profissional é só marcação
function linhaTamanho(x) {
  const tm = x.tamanho;
  if (!tm) return x.valorDele ? `\n💵 Ele apostou <b>${usd(x.valorDele)}</b>` : "";
  const ic = { grande: "💰", normal: "💵", pequena: "⚠️", simbolica: "⛔", "sem-ref": "💵" }[tm.classe];
  return `\n${ic} Ele apostou <b>${h(tm.texto)}</b> · ${h(tm.rotulo)}`;
}

function msgVivo(env, t, s) {
  const fim = s.entrouEm + t.janelaSeg * 1000;
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🔴 <b>AO VIVO · ${h(t.nome)}</b> (${h(rotuloEsporte(s.esporte))}${s.tipo ? " · " + h(rotuloTipo(s.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(s.tituloEvento)}${s.placar ? ` · ${h(s.placar)}` : ""}
Entrar: <b>${h(s.aposta || s.lado)}</b>${s.pergunta && s.pergunta !== s.tituloEvento ? `
Mercado: ${h(s.pergunta)} · lado ${h(s.lado)}` : ""}
Odd dele ${odd(s.precoDele)} · agora ${odd(s.ask)} · <b>mínima ${odd(s.teto)}</b>${linhaTamanho(s)}${linhaNota(s.nota)}${t.nivel === "teste" ? `
Veredito: <b>${s.status === "COPIAR" ? "copiar" : "não copiar"}</b> — ${h(s.motivos.join("; "))}` : ""}
⏱ Vale até <b>${horaBR(fim)}</b> (janela de ${Math.round(t.janelaSeg / 60)} min)
Entrou às ${horaBR(s.entrouEm)} · detectado às ${horaBR(Date.now())}${aposta(env, s.teto)}
No Polymarket: ordem limitada a ${cents(s.teto)} · segure até o fim
${linkMercado(s)}`;
}

function msgPre(env, t, p) {
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🟢 <b>PRÉ-JOGO · ${h(t.nome)}</b> (${h(rotuloEsporte(p.esporte))}${p.tipo ? " · " + h(rotuloTipo(p.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(p.tituloEvento)} · começa ${p.inicio ? dataBR(p.inicio) : "?"}
Entrar: <b>${h(p.aposta || p.lado)}</b>${p.pergunta && p.pergunta !== p.tituloEvento ? `
Mercado: ${h(p.pergunta)} · lado ${h(p.lado)}` : ""}
Odd dele ${odd(p.precoDele)} · agora ${odd(p.ask)} · <b>mínima ${odd(p.teto)}</b>${linhaTamanho(p)}${linhaNota(p.nota)}${aposta(env, p.teto)}
Detectado às ${horaBR(Date.now())}${p.entrouEm ? ` · ele entrou às ${horaBR(p.entrouEm)}` : ""}
No Polymarket: ordem limitada a ${cents(p.teto)} · segure até o fim
${linkMercado(p)}`;
}

// ---------- registro dos sinais enviados ----------
const corta = (v, n) => String(v ?? "").slice(0, n);
async function registrarSinal(env, t, x, tipo) {
  if (!env.ENVIADOS || t.nivel === "teste") return;
  const md = {
    w: t.carteira, n: corta(t.nome, 30), m: tipo, e: corta(x.tituloEvento, 70), l: corta(x.aposta || x.lado, 60), s: corta(x.slug, 90),
    ev: corta(x.eventSlug, 90), oi: x.oi, p: +x.precoDele.toFixed(4), a: x.ask == null ? null : +x.ask.toFixed(4), mi: +x.teto.toFixed(4),
    nt: x.nota?.nota ?? null, rt: x.nota?.rotulo ?? null, sp: corta(x.esporte, 20), tp: corta(x.tipo, 20),
    u: x.valorDele == null ? null : Math.round(x.valorDele), tc: x.tamanho?.classe ?? null,
    t: x.entrouEm || Date.now(), i: x.inicio || null, env: Date.now(), r: null,
  };
  await env.ENVIADOS.put(`r:${Date.now()}:${corta(x.asset, 12)}`, "", { metadata: md, expirationTtl: 90 * 86400 });
  cacheRegistro = null; // a próxima leitura busca de novo
}

let cacheRegistro = null, cacheRegistroEm = 0;
async function listarRegistro(env, fresco = false) {
  if (!env.ENVIADOS) return [];
  if (!fresco && cacheRegistro && Date.now() - cacheRegistroEm < 120_000) return cacheRegistro;
  const out = [];
  let cursor;
  do {
    const r = await env.ENVIADOS.list({ prefix: "r:", cursor });
    for (const k of r.keys) out.push({ chave: k.name, ...(k.metadata || {}) });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  cacheRegistro = out; cacheRegistroEm = Date.now();
  return out;
}

// confere o resultado dos sinais cujo jogo já deve ter acabado
async function resolverRegistro(env, api) {
  const agora = Date.now();
  const pend = (await listarRegistro(env, true))
    .filter((x) => x.r == null && (x.i ? agora > x.i + 2 * 3600e3 : agora > x.env + 6 * 3600e3))
    .slice(0, 8);
  let resolvidos = 0;
  for (const x of pend) {
    const ev = (await api.get("gamma", `/events?slug=${encodeURIComponent(x.ev)}`).catch(() => null))?.[0];
    const r = resultadoMercado(ev, x.s, x.oi);
    if (r == null) continue;
    const { chave, ...md } = x;
    await env.ENVIADOS.put(chave, "", { metadata: { ...md, r }, expirationTtl: 90 * 86400 });
    resolvidos++;
  }
  if (resolvidos) cacheRegistro = null;
  return resolvidos;
}

const execucoes = []; // log em memória; vai para o KV a cada 5 min (limite grátis: 1.000 gravações/dia)
async function registrar(env, item, persistir) {
  execucoes.unshift(item);
  execucoes.length = Math.min(execucoes.length, 60);
  if (!persistir || !env.ENVIADOS) return;
  const antigo = JSON.parse((await env.ENVIADOS.get("status")) || "[]");
  const todos = [...execucoes, ...antigo].filter((x, i, a) => a.findIndex((y) => y.inicio === x.inicio) === i)
    .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 60);
  await env.ENVIADOS.put("status", JSON.stringify(todos));
}

const ORCAMENTO = 40; // consultas à API por execução (limite do plano grátis: 50, sobra para listas e Telegram)

async function verificar(env, { minuto = new Date().getUTCMinutes(), preTrader = null } = {}) {
  let usadas = 0;
  const fetchContado = (url, opts) => {
    if (++usadas > ORCAMENTO) return Promise.reject(new Error("orçamento de consultas desta execução esgotado"));
    return fetch(url, opts);
  };
  const l = await carregarListas(env);
  const pre = vigentes(l.pre), vivo = vigentes(l.vivo), prefixos = l.prefixos;
  const api = criarApi({ relay: env.RELAY_INTERNO || "", fetchFn: fetchContado });
  const resumo = { em: new Date().toISOString(), aoVivo: [], preJogo: [], preTrader: null, enviados: 0, consultas: 0, erros: [] };

  // pouca atividade por trader: entradas novas cabem nas últimas 30 e o plano grátis tem pouco CPU
  const rv = await carregarAoVivo(api, vivo, { prefixos, limiteAtividade: 30, historicoSeg: +(env.VIVO_HISTORICO_SEG || 300), soCopiaveis: true, indices: l.indices });
  for (const [k, d] of rv.traders.entries()) {
    const t = vivo[k];
    if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
    for (const s of d.sinais) {
      resumo.aoVivo.push({ trader: t.nome, evento: s.tituloEvento, aposta: s.aposta, status: s.status, motivos: s.motivos });
      // trader de teste manda toda entrada nova (com o veredito), para conferir o fluxo
      if (s.status !== "COPIAR" && t.nivel !== "teste") continue;
      const chave = `v:${s.asset}:${s.entrouEm}`;
      s.nota = notaEntrada(s, t, l.indices);
      if (await jaEnviado(env, chave)) continue;
      const r = await telegram(env, msgVivo(env, t, s));
      if (r.ok) { resumo.enviados++; await marcar(env, chave, 6 * 3600); await registrarSinal(env, t, s, "v"); } else resumo.erros.push(`telegram: ${r.erro}`);
    }
  }

  // pré-jogo: um trader por execução, em rodízio (cada um é visto a cada ~10 min);
  // trader de teste entra em toda execução, limitado a 8 posições
  const normais = pre.filter((t) => t.nivel !== "teste");
  const lista = preTrader
    ? pre.filter((t) => t.nome === preTrader || t.carteira === preTrader)
    : [...pre.filter((t) => t.nivel === "teste"), ...(normais.length ? [normais[minuto % normais.length]] : [])];
  resumo.preTrader = lista.map((t) => t.nome).join(", ");
  {
    const rp = await carregarTodos(api, lista, { prefixos, limiteAtividade: 20, soEspecialidade: true, maxPosicoes: 8, indices: l.indices });
    for (const [k, d] of rp.traders.entries()) {
      const t = lista[k];
      if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
      for (const p of d.posicoes) {
        if (p.status !== "COPIAR") continue;
        resumo.preJogo.push({ trader: t.nome, evento: p.tituloEvento, aposta: p.aposta });
        const chave = `p:${p.asset}`;
        p.nota = notaEntrada(p, t, l.indices);
        if (await jaEnviado(env, chave)) continue;
        if (t.nivel === "teste" && resumo.enviados >= 3) continue; // teste: no máximo 3 por execução
        const r = await telegram(env, msgPre(env, t, p));
        const ttl = p.inicio ? (p.inicio - Date.now()) / 1000 + 3600 : 3 * 86400;
        if (r.ok) { resumo.enviados++; await marcar(env, chave, ttl); await registrarSinal(env, t, p, "p"); } else resumo.erros.push(`telegram: ${r.erro}`);
      }
    }
  }
  if (minuto % 10 === 0) {
    try { resumo.resolvidos = await resolverRegistro(env, api); } catch (e) { resumo.erros.push(`registro: ${e.message || e}`); }
  }
  resumo.consultas = usadas;
  return resumo;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return new Response('{"erro":"use GET"}', { status: 405, headers: CORS });
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

    if (url.pathname === "/teste") {
      const r = await telegram(env, "✅ Trader Poly conectado. Os sinais ao vivo e pré-jogo vão chegar aqui.");
      return json(r, r.ok ? 200 : 500);
    }
    if (url.pathname === "/status") {
      const antigo = env.ENVIADOS ? JSON.parse((await env.ENVIADOS.get("status")) || "[]") : [];
      const todos = [...execucoes, ...antigo].filter((x, i, a) => a.findIndex((y) => y.inicio === x.inicio) === i)
        .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 60);
      const intervalos = todos.slice(0, -1).map((x, i) => Math.round((Date.parse(x.inicio) - Date.parse(todos[i + 1].inicio)) / 1000));
      return json({
        agora: new Date().toISOString(),
        ultima_execucao_ha_seg: todos[0] ? Math.round((Date.now() - Date.parse(todos[0].inicio)) / 1000) : null,
        intervalos_seg: intervalos, minutos_pulados: intervalos.filter((v) => v > 90).length, execucoes: todos,
        obs: "intervalos ~60 s = agendamento em dia; buracos maiores = minutos sem execução (o log vai para o KV a cada 5 min)",
      });
    }
    if (url.pathname === "/registro") {
      return json({ agora: Date.now(), sinais: await listarRegistro(env) });
    }
    if (url.pathname === "/verificar") {
      // ?pre=NOME verifica o pré-jogo desse trader; sem isso, segue o rodízio do minuto
      try { return json(await verificar(env, { preTrader: url.searchParams.get("pre") })); } catch (e) { return json({ erro: String(e.message || e) }, 500); }
    }

    const [, host, ...resto] = url.pathname.split("/");
    if (!HOSTS[host]) return json({ erro: "use /data, /gamma, /clob, /teste ou /verificar" }, 404);
    try {
      const r = await fetch(`${HOSTS[host]}/${resto.join("/")}${url.search}`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
    } catch (e) {
      return json({ erro: "falha ao alcançar o Polymarket: " + e.message }, 502);
    }
  },

  async scheduled(event, env, ctx) {
    const minuto = Math.floor(event.scheduledTime / 60000);
    const t0 = Date.now();
    ctx.waitUntil(verificar(env, { minuto })
      .then((r) => ({ consultas: r.consultas, enviados: r.enviados, aoVivo: r.aoVivo.length, erros: r.erros.slice(0, 3) }))
      .catch((e) => ({ erro: String(e.message || e) }))
      .then((r) => registrar(env, { inicio: new Date(event.scheduledTime).toISOString(), ms: Date.now() - t0, ...r }, minuto % 5 === 0)));
  },
};
