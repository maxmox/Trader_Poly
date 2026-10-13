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
export const PADRAO = { tetoCentavos: 2, toleranciaCentavos: 5, precoMax: 0.97 };

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
  const teto = Math.min(preco + regras.tetoCentavos / 100, regras.precoMax);
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

  const daEspecialidade = trader.esportes.includes(sp);
  if (!daEspecialidade) { piora("NAO"); motivos.push(`${rotuloEsporte(sp)} não é a especialidade dele`); }

  if (!encerrado) {
    if (ask == null) { piora("NAO"); motivos.push("sem ofertas de venda no livro"); }
    else if (ask >= regras.precoMax) { piora("NAO"); motivos.push(`preço ${cents(ask)} — sem margem`); }
    else if (ask > preco + regras.toleranciaCentavos / 100) { piora("NAO"); motivos.push(`preço fugiu: ${cents(ask)} vs ${cents(preco)} dele`); }
    else if (ask > teto) { piora("ESPERAR"); motivos.push(`preço ${cents(ask)} acima do teto ${cents(teto)} — deixe ordem limitada`); }
  }
  if (status === "COPIAR") motivos.push(`compre até ${cents(teto)}`);

  // quanto dá para comprar até o teto sem subir o preço
  const liquidez = asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0);

  return {
    status, motivos, esporte: sp, daEspecialidade, inicio,
    horasParaInicio: inicio ? (inicio - agora) / 3.6e6 : null,
    ask, bid, teto, liquidez, precoDele: preco,
    placar: evento?.score || null, periodo: evento?.period || null,
  };
}

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
export async function carregarTrader(api, trader, { prefixos, regras = PADRAO, agora = Date.now(), cacheEventos = new Map() } = {}) {
  const w = trader.carteira;
  const [posicoes, atividade] = await Promise.all([
    api.get("data", `/positions?user=${w}&sizeThreshold=1&redeemable=false&limit=200`),
    api.get("data", `/activity?user=${w}&type=TRADE&limit=500`),
  ]);
  const primeiraCompra = {};
  const ultimaAtividade = (atividade || []).reduce((m, t) => Math.max(m, t.timestamp), 0);
  for (const t of atividade || []) {
    if (t.side !== "BUY") continue;
    primeiraCompra[t.asset] = Math.min(primeiraCompra[t.asset] ?? Infinity, t.timestamp);
  }
  const abertas = (posicoes || []).filter((p) => !p.redeemable && p.curPrice > 0.005 && p.curPrice < 0.995);
  const itens = await emLotes(abertas, 4, async (pos) => {
    let ev = cacheEventos.get(pos.eventSlug);
    if (ev === undefined) {
      const r = await api.get("gamma", `/events?slug=${encodeURIComponent(pos.eventSlug)}`).catch(() => null);
      ev = r?.[0] || null;
      cacheEventos.set(pos.eventSlug, ev);
    }
    const book = await api.get("clob", `/book?token_id=${pos.asset}`).catch(() => null);
    const v = avaliar({ pos, evento: ev, book, trader, agora, regras, prefixos });
    return {
      titulo: pos.title, lado: pos.outcome, slug: pos.slug, eventSlug: pos.eventSlug, asset: pos.asset,
      valorDele: pos.initialValue, cotasDele: pos.size, pnlDele: pos.cashPnl,
      entrouEm: primeiraCompra[pos.asset] ? primeiraCompra[pos.asset] * 1000 : null,
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
