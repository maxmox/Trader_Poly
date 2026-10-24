// Página "Props NBA": movimento dos mercados do jogo (vencedor, handicap, totais do jogo, 1º tempo e quartos) e
// das props de pontos, rebotes, assistências, cestas de 3 e PRA, por jogo.
// Fonte principal: DraftKings pela API pública da ESPN (linha e odd de abertura e atuais; buscarDk em core.js),
// com as lesões do jogo (ESPN) e o histórico gravado pela Action a cada ~10 min (data/linhas_dk.json).
// (O Polymarket saiu desta página em 21/10/2026: nas props ele quase não tem volume e não acrescentava nada.)
// Aba Edge: projeções do Edgely (data/edgely.json, buscadas pela Action 1x por dia ou pelo botão) × DraftKings agora.
import { buscarDk, datasNba, semMargem, movimentoMercado, MERCADOS_JOGO, edgeProp, nomeChave, POR_LINHA_PROPS, nomeAtletaEspn, TIPOS_PROP, edgeJogo, projDoMercado } from "./core.js";
import { $, esc, hora, dataHora } from "./formato.js";
import { carregarAcomp, renderAcomp, acompVelho } from "./acompanhamento.js";
import { carregarFiltros, renderFiltros, filtrosVelho } from "./filtros.js";

const TIPOS = { ...TIPOS_PROP, pra: "PRA (pts+reb+ast)" };
const NOVA_MS = 2 * 3600e3; // linha que apareceu há menos de 2 h ganha destaque
const POR_LINHA = POR_LINHA_PROPS; // core.js: quanto 1 ponto de linha vale em chance do Over
const REFRESCO = 5 * 60_000;
const JANELA = { "24h": 24 * 3600, "3h": 3 * 3600 };
const CHAVE = "props-filtros";
// site.api.espn.com vai pelo relay (o navegador chegou a recusar a chamada direta); a API "core" vai direto
const ESPN_NBA = "/apis/site/v2/sports/basketball/nba";
let SITE = `https://site.api.espn.com${ESPN_NBA}`;

let configurado = false, RELAY = "", jogos = [], erro = null, carregadoEm = null, rodando = false;
let edgely = null, pedidoMsg = ""; // data/edgely.json e a resposta do último "Buscar projeções"
const abertos = new Set(); // linhas com o gráfico aberto

// ---------- filtros (salvos só neste navegador) ----------
const PADRAO_F = { aba: "mov", tipo: "", desde: "abertura", min: "0", ev: "", mom: "", merc: "", amostra: "30", conf: "20", busca: "" };
let f = (() => { try { return { ...PADRAO_F, ...JSON.parse(localStorage.getItem(CHAVE) || "{}") }; } catch { return { ...PADRAO_F }; } })();
{ const a = new URLSearchParams(location.search).get("aba"); if (["mov", "edge", "filtros", "acomp"].includes(a)) f.aba = a; } // link direto: props.html?aba=edge
const salvarF = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ ...f, busca: "" })); } catch { /* sem armazenamento */ } };
for (const [k, sel] of [["tipo", "#f-tipo"], ["desde", "#f-desde"], ["min", "#f-min"], ["ev", "#f-ev"], ["mom", "#f-mom"], ["merc", "#f-merc"], ["amostra", "#f-amostra"], ["conf", "#f-conf"], ["busca", "#f-busca"]]) {
  const el = $(sel);
  el.value = f[k];
  el.addEventListener(k === "busca" ? "input" : "change", () => {
    f[k] = el.value;
    salvarF();
    render();
  });
}
$("#btn-atualizar").addEventListener("click", () => carregar());

// abas: Movimento | Edge | Acompanhamento (os elementos com data-so só aparecem nas abas listadas nele)
function mostrarAba() {
  document.querySelectorAll(".tabs [data-aba]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === f.aba)));
  document.querySelectorAll("[data-so]").forEach((el) => { el.hidden = !el.dataset.so.split(" ").includes(f.aba); });
}
document.querySelectorAll(".tabs [data-aba]").forEach((b) => b.addEventListener("click", () => { f.aba = b.dataset.aba; salvarF(); mostrarAba(); render(); }));
mostrarAba();

// botão "Buscar projeções no Edgely": o Worker guarda o pedido e dispara a Action, que consulta o Edgely 1 vez
// (no máximo 1 busca a cada 10 min) e publica data/edgely.json; esta página relê o arquivo a cada 5 min
$("#btn-edgely").addEventListener("click", async () => {
  const b = $("#btn-edgely");
  b.disabled = true; b.textContent = "Pedindo…";
  try {
    if (!RELAY) throw new Error("relay não configurado");
    const r = await getJson(`${RELAY}/edgely-atualizar`);
    pedidoMsg = r.msg?.startsWith("já") ? `Já foi pedido às ${hora(r.pedido)} (no máximo 1 busca a cada 10 min).`
      : `Pedido enviado às ${hora(r.pedido)}: o servidor busca no Edgely e publica em ~10–15 min; a página confere sozinha a cada 5 min.`;
  } catch (e) {
    pedidoMsg = /404/.test(e.message) ? "O Worker ainda não tem este botão: cole o Worker novo na Cloudflare." : `Não consegui pedir: ${e.message}`;
  }
  b.disabled = false; b.textContent = "Buscar projeções no Edgely";
  render();
});

// ---------- números ----------
const pp = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")} pp`);
const prob = (p) => (p == null ? "–" : `${Math.round(100 * p)}%`);
const dec = (v) => (v == null ? "–" : v.toFixed(2).replace(".", ","));
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
const seta = (a, b, fmt) => (a == null || a === b ? fmt(b) : `${fmt(a)} → <b>${fmt(b)}</b>`);
const normal = nomeChave;
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`); return r.json(); };

async function emLotes(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k]); } }));
}

// elenco do time (id do atleta -> nome); guardado por 12 h neste navegador
const elencos = new Map();
async function elenco(idTime) {
  if (elencos.has(idTime)) return elencos.get(idTime);
  const ck = `nba-elenco2-${idTime}`; // "2": a versão antiga guardava elenco vazio por 12 h quando a busca falhava
  try { const c = JSON.parse(localStorage.getItem(ck) || "null"); if (c && Object.keys(c.m).length && Date.now() - c.em < 12 * 3600e3) { elencos.set(idTime, c.m); return c.m; } } catch { /* sem cache */ }
  const r = await getJson(`${SITE}/teams/${idTime}/roster`).catch(() => null);
  const m = Object.fromEntries((r?.athletes || []).map((a) => [a.id, a.displayName]));
  if (!Object.keys(m).length) return m; // falhou: não guarda (tenta de novo na próxima atualização)
  elencos.set(idTime, m);
  try { localStorage.setItem(ck, JSON.stringify({ em: Date.now(), m })); } catch { /* sem cache */ }
  return m;
}
// quem não está no elenco: nome pelo id do atleta (guardado neste navegador por 30 dias)
async function nomesFaltando(ids, nomes) {
  const falta = ids.filter((id) => !nomes[id]);
  await emLotes(falta, 4, async (id) => {
    const ck = `nba-atleta-${id}`;
    try { const c = localStorage.getItem(ck); if (c) { nomes[id] = c; return; } } catch { /* sem cache */ }
    const n = await nomeAtletaEspn(getJson, id);
    if (n) { nomes[id] = n; try { localStorage.setItem(ck, n); } catch { /* sem cache */ } }
  });
}

// movimento desde a referência escolhida: linha, chance sem margem e o movimento EQUIVALENTE, isto é, quanto
// a chance do lado A (Over, ou o visitante) mudou na linha da referência: a chance na linha nova + o efeito de
// ter mudado a linha. dirLinha: +1 nos totais (linha maior = Over mais difícil); -1 no handicap do visitante
// (linha mais negativa = mais difícil cobrir).
function movimento(x) {
  let ref = { linha: x.dk.linhaAb, p: x.dk.pAb };
  if (f.desde !== "abertura" && x.hist.length) {
    const alvo = Date.now() / 1000 - JANELA[f.desde];
    let r = x.hist.find((h) => h[0] == null) || x.hist[0];
    for (const h of x.hist) if (h[0] != null && h[0] <= alvo) r = h;
    ref = { linha: r[1], p: semMargem(r[2], r[3]) };
  }
  const dl = ref.linha != null ? x.dk.linha - ref.linha : 0;
  const dp = ref.p != null && x.dk.p != null ? x.dk.p - ref.p : null;
  const sinal = x.dirLinha * dl * (x.porLinha || 0) + (dp ?? 0);
  return { ref, dl, dp, sinal, forca: Math.abs(sinal) };
}

// ---------- dados ----------
// ---------- Edge (projeção do Edgely × DraftKings; conta em core.js: chanceOver/edgeProp) ----------
// lado com o maior valor esperado nas odds atuais da DraftKings
function edgeDe(x) {
  if (x.k) { // mercado do jogo
    const e = edgeJogo(x.k, x.proj, x.dk.linha, x.dk.over, x.dk.under);
    return e && { ...e, dif: x.k === "total" ? x.proj - x.dk.linha : null, ladoTxt: e.lado === "O" ? x.rotA : x.rotB };
  }
  const e = edgeProp(x.tipo, x.proj, x.dk.linha, x.dk.over, x.dk.under);
  return e && { ...e, ladoTxt: e.lado };
}
const hojeEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
// projeções por jogo da ESPN + nome (o Edgely traz o id do jogo na ESPN): projeção de outro dia não casa
const projecoes = (e) => new Map((e?.jogadores || []).filter((p) => p.ev).map((p) => [`${p.ev}|${normal(p.nome)}`, p]));

// quando a linha apareceu pela 1ª vez: 1º ponto com hora no histórico (gravado a cada ~10 min); se o jogo já tem
// histórico e esta linha ainda não, ela abriu depois da última gravação (agora)
function vistoEm(hist, chave) {
  const H = hist?.h?.[chave];
  if (!H) return hist ? Date.now() : null;
  const t = H.find((h) => h[0] != null)?.[0];
  return t ? t * 1000 : null;
}
const ehNova = (x) => x.vistoEm != null && Date.now() - x.vistoEm < NOVA_MS;
const tagNova = (x) => (ehNova(x) ? ` <span class="tag-nova" title="linha vista pela 1ª vez às ${hora(x.vistoEm)}">nova · ${Math.max(1, Math.round((Date.now() - x.vistoEm) / 60e3))} min</span>` : "");

async function carregarJogo(ev, historico, projs) {
  const c = ev.competitions[0];
  const times = c.competitors.map((t) => ({ id: t.team.id, sigla: t.team.abbreviation, nome: t.team.shortDisplayName, casa: t.homeAway === "home" }));
  const [dk, e1, e2, resumo] = await Promise.all([
    buscarDk(getJson, ev.id).catch(() => ({ props: {}, jogo: {} })),
    elenco(times[0].id), elenco(times[1].id),
    getJson(`${SITE}/summary?event=${ev.id}`).catch(() => null),
  ]);
  const hist = historico?.jogos?.[ev.id] || null;
  const nomes = { ...e1, ...e2 }, siglaDe = {};
  for (const id of Object.keys(e1)) siglaDe[id] = times[0].sigla;
  for (const id of Object.keys(e2)) siglaDe[id] = times[1].sigla;
  await nomesFaltando([...new Set(Object.values(dk.props).map((p) => p.atleta))], nomes);
  const lesoes = {};
  for (const t of resumo?.injuries || []) for (const i of t.injuries || []) lesoes[normal(i.athlete?.displayName)] = { status: i.status, motivo: i.details?.type || "", sigla: t.team?.abbreviation, nome: i.athlete?.displayName };
  const fora = times.find((t) => !t.casa), casa = times.find((t) => t.casa);
  const mercados = Object.values(dk.jogo).sort((a, b) => MERCADOS_JOGO[a.k].ordem - MERCADOS_JOGO[b.k].ordem).map((m) => {
    const total = !["ml", "spread"].includes(m.k);
    return {
      id: `${ev.id}|jogo|${m.k}`, k: m.k, nome: MERCADOS_JOGO[m.k].nome, rotA: total ? "Over" : fora.nome, rotB: total ? "Under" : casa.nome,
      porLinha: MERCADOS_JOGO[m.k].porLinha || 0, dirLinha: total ? 1 : -1, temLinha: m.k !== "ml",
      dk: { linha: m.linha, linhaAb: m.linhaAb, over: m.a, under: m.b, overAb: m.aAb, underAb: m.bAb, p: m.p, pAb: m.pAb },
      hist: hist?.h?.[`jogo|${m.k}`] || [], vistoEm: vistoEm(hist, `jogo|${m.k}`),
      tipo: `jogo-${m.k}`, proj: projDoMercado(m.k, edgely?.data === hojeEt() ? edgely?.jogos?.[ev.id]?.proj : null),
    };
  });
  const linhas = Object.values(dk.props).map((dk) => {
    const jogador = nomes[dk.atleta] || `atleta ${dk.atleta}`;
    const pe = projs.get(`${ev.id}|${normal(jogador)}`);
    return {
      id: `${ev.id}|${dk.atleta}|${dk.tipo}`, jogador, sigla: siglaDe[dk.atleta] || "", tipo: dk.tipo, dk,
      rotA: "Over", rotB: "Under", porLinha: POR_LINHA[dk.tipo], dirLinha: 1, temLinha: true,
      lesao: lesoes[normal(jogador)] || null, hist: hist?.h?.[`${dk.atleta}|${dk.tipo}`] || [], proj: pe?.proj?.[dk.tipo] ?? null, projMin: pe?.proj?.min ?? null,
      vistoEm: vistoEm(hist, `${dk.atleta}|${dk.tipo}`),
    };
  });
  return {
    id: ev.id, titulo: `${times.find((t) => !t.casa)?.nome} @ ${times.find((t) => t.casa)?.nome}`, inicio: Date.parse(ev.date),
    estado: ev.status?.type?.state, placar: ev.status?.type?.state === "in" ? `${c.competitors.map((t) => `${t.team.abbreviation} ${t.score}`).join(" · ")} · ${ev.status.type.shortDetail}` : "",
    lesoes: Object.values(lesoes), linhas, mercados, comHist: !!hist,
  };
}

async function carregar() {
  if (rodando || document.hidden) return; // aba em segundo plano: não consulta
  rodando = true;
  $("#btn-atualizar").textContent = "Atualizando…";
  try {
    if (!configurado) {
      const cfg = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      let relay = cfg.relay || "";
      try { relay = JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}").relay || relay; } catch { /* padrão */ }
      RELAY = relay.replace(/\/$/, "");
      if (relay) SITE = `${RELAY}/espn${ESPN_NBA}`;
      configurado = true;
    }
    const evs = [];
    for (const d of datasNba()) evs.push(...(((await getJson(`${SITE}/scoreboard?dates=${d}`)).events) || []));
    const vivos = evs.filter((e) => e.status?.type?.state !== "post"); // jogo encerrado some da página
    // histórico gravado pela Action (mesmo site; a ESPN recusa o Worker)
    const lerData = (nome) => fetch(`data/${nome}?t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [historico, ed] = await Promise.all([lerData("linhas_dk.json"), lerData("edgely.json")]);
    edgely = ed;
    const projs = projecoes(edgely);
    const novos = [];
    let feitos = 0;
    await emLotes(vivos, 3, async (ev) => {
      const j = await carregarJogo(ev, historico, projs).catch(() => null);
      if (j && (j.linhas.length || j.mercados.length)) novos.push(j);
      $("#status").textContent = `Carregando jogos: ${++feitos}/${vivos.length}…`;
    });
    jogos = novos.sort((a, b) => a.inicio - b.inicio);
    erro = null; carregadoEm = Date.now();
    $("#status").textContent = "";
    $("#fonte").textContent = "DraftKings · ESPN"; $("#fonte").className = "pill live";
  } catch (e) {
    erro = e;
    $("#fonte").textContent = "sem dados"; $("#fonte").className = "pill off";
  }
  rodando = false;
  $("#btn-atualizar").textContent = "Atualizar";
  render();
}

// ---------- gráficos ----------
function sparkline(vals) {
  if (vals.length < 2) return `<span class="muted">–</span>`;
  const W = 96, H = 26, lo = Math.min(...vals), hi = Math.max(...vals), amp = Math.max(hi - lo, 0.04);
  const y = (v) => H - 2 - ((v - (lo + hi) / 2 + amp / 2) / amp) * (H - 4);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (W - 4) + 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

// gráfico de uma série no tempo: pontos [t, valor, texto da dica]; degrau = linha da casa (muda em saltos)
const M = { E: 46, D: 12, T: 12, B: 26 };
function grafico({ titulo, pontos, eixo, degrau = false, refs = [], rodape = "" }) {
  if (pontos.length < 2) return `<p class="muted">${esc(titulo)}: sem histórico suficiente ainda.</p>`;
  const W = 640, H = 170, { E, D, T, B } = M;
  const t0 = pontos[0][0], t1 = Math.max(pontos[pontos.length - 1][0], t0 + 60);
  const vs = pontos.map((p) => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, eixo === "pct" ? 0.03 : 0.5);
  lo -= pad; hi += pad;
  const X = (t) => E + ((t - t0) / (t1 - t0)) * (W - E - D);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const passo = eixo === "pct" ? (hi - lo > 0.3 ? 0.1 : hi - lo > 0.12 ? 0.05 : 0.02) : (hi - lo > 6 ? 2 : hi - lo > 2.5 ? 1 : 0.5);
  const fmt = eixo === "pct" ? (v) => `${Math.round(100 * v)}%` : (v) => lin(Math.round(v * 2) / 2);
  const grade = [];
  for (let v = Math.ceil(lo / passo) * passo; v <= hi + 1e-9; v += passo) grade.push(`<line class="g" x1="${E}" x2="${W - D}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${E - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`);
  const marcasX = [];
  const vaiDia = t1 - t0 > 20 * 3600;
  const d = new Date(t0 * 1000); d.setMinutes(0, 0, 0); if (vaiDia) d.setHours(0);
  for (let t = d.getTime() / 1000; t < t1; t += vaiDia ? 86400 : 3 * 3600) {
    if (t <= t0) continue;
    const rot = vaiDia ? new Date(t * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : hora(t * 1000);
    marcasX.push(`<line class="g" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${rot}</text>`);
  }
  let caminho = "";
  pontos.forEach((p, i) => {
    if (!i) caminho = `M${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
    else caminho += degrau ? `H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}` : `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
  });
  const marcas = refs.filter((r) => r.t > t0 && r.t < t1).map((r) => `<line class="ref" x1="${X(r.t).toFixed(1)}" x2="${X(r.t).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${(X(r.t) + 4).toFixed(1)}" y="${T + 10}">${esc(r.rot)}</text>`).join("");
  const ult = pontos[pontos.length - 1];
  return `<div class="graf" data-h="${esc(JSON.stringify(pontos))}" data-x0="${t0}" data-x1="${t1}" data-lo="${lo}" data-hi="${hi}">
    <h4 class="sub">${esc(titulo)}</h4>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: de ${esc(pontos[0][2])} para ${esc(ult[2])}">
      ${grade.join("")}${marcasX.join("")}${marcas}
      <path class="serie" d="${caminho}"/>
      <circle class="ponto" cx="${X(ult[0]).toFixed(1)}" cy="${Y(ult[1]).toFixed(1)}" r="4"/>
      <g class="cruz" hidden><line class="cx" y1="${T}" y2="${H - B}"/><circle class="cp" r="4"/></g>
      <rect class="alvo" x="${E}" y="${T}" width="${W - E - D}" height="${H - T - B}"/>
    </svg>
    <div class="dica" hidden></div>
    ${rodape ? `<p class="muted">${rodape}</p>` : ""}
  </div>`;
}

// cruz + dica: o ponto mais próximo do mouse no tempo
document.addEventListener("pointermove", (e) => {
  const alvo = e.target.closest?.(".graf .alvo");
  document.querySelectorAll(".graf .cruz:not([hidden])").forEach((c) => { if (!alvo || !c.closest(".graf").contains(alvo)) { c.hidden = true; c.closest(".graf").querySelector(".dica").hidden = true; } });
  if (!alvo) return;
  const g = alvo.closest(".graf"), svg = g.querySelector("svg");
  const h = JSON.parse(g.dataset.h), x0 = +g.dataset.x0, x1 = +g.dataset.x1, lo = +g.dataset.lo, hi = +g.dataset.hi;
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, { E, D, T, B } = M;
  const t = x0 + ((((e.clientX - r.left) / r.width) * vb.width - E) / (vb.width - E - D)) * (x1 - x0);
  let k = 0;
  for (let i = 1; i < h.length; i++) if (Math.abs(h[i][0] - t) < Math.abs(h[k][0] - t)) k = i;
  const cx = E + ((h[k][0] - x0) / (x1 - x0)) * (vb.width - E - D), cy = T + (1 - (h[k][1] - lo) / (hi - lo)) * (vb.height - T - B);
  const cruz = g.querySelector(".cruz");
  cruz.hidden = false;
  cruz.querySelector(".cx").setAttribute("x1", cx); cruz.querySelector(".cx").setAttribute("x2", cx);
  cruz.querySelector(".cp").setAttribute("cx", cx); cruz.querySelector(".cp").setAttribute("cy", cy);
  const dica = g.querySelector(".dica");
  dica.hidden = false;
  dica.innerHTML = `${esc(h[k][2])}<br><span>${dataHora(h[k][0] * 1000)}</span>`;
  const top = (cy / vb.height) * r.height + svg.offsetTop;
  dica.style.left = `${Math.min(Math.max((cx / vb.width) * r.width, 90), r.width - 90)}px`;
  dica.style.top = `${top}px`;
});

// chance do lado A sem margem de um ponto do histórico CONVERTIDA PARA A LINHA DE ABERTURA: quando a casa mexe a linha,
// comparar a odd de 24,5 com a de 22,5 não faz sentido, e a ABERTURA é a referência inicial do movimento (24/10, pedidos
// do usuário). Mesma conta do "≈ X pp" da tabela (core.movimentoMercado: props pela média implícita da linha, mercados
// do jogo pelo porLinha); sem abertura conhecida, a linha atual.
function chanceNaLinha(x, h, ref) {
  const p = semMargem(h[2], h[3]);
  if (p == null) return null;
  if (!x.temLinha || ref == null || h[1] == null || h[1] === ref) return p;
  const q = movimentoMercado(x.tipo, ref, h[1], 0, p);
  return q == null ? null : Math.min(0.99, Math.max(0.01, q));
}
const linhaRef = (x) => x.dk.linhaAb ?? x.dk.linha ?? x.hist.filter((h) => h[1] != null).pop()?.[1] ?? null;
// a abertura como 1º ponto da série (o histórico guarda a abertura sem hora: t = null): 15 min antes do 1º registro
function comAbertura(x) {
  const timed = x.hist.filter((h) => h[0] != null);
  const ab = x.dk.overAb != null || x.dk.linhaAb != null ? [null, x.dk.linhaAb ?? null, x.dk.overAb ?? null, x.dk.underAb ?? null] : x.hist.find((h) => h[0] == null);
  if (!ab || !timed.length) return timed.map((h) => ({ h, ab: false }));
  return [{ h: [timed[0][0] - 900, ab[1], ab[2], ab[3]], ab: true }, ...timed.map((h) => ({ h, ab: false }))];
}
// minigráfico: a chance do lado A na linha de abertura, da abertura até agora
function serieAjustada(x) {
  const ref = linhaRef(x);
  return comAbertura(x).map(({ h }) => chanceNaLinha(x, h, ref)).filter((v) => v != null);
}

function detalhe(j, x) {
  const serie = comAbertura(x);
  const refs = [{ t: j.inicio / 1000, rot: "início" }];
  if (serie.length >= 2) {
    const ref = linhaRef(x), t0 = serie[0].ab ? serie[0].h[0] : null;
    if (t0 != null) refs.push({ t: t0 + 1, rot: "abertura" });
    const ptsP = serie.map(({ h, ab }) => { const c = chanceNaLinha(x, h, ref); return [h[0], c, `${ab ? "ABERTURA · " : ""}${x.rotA} ${prob(c)}${x.temLinha ? ` na linha de abertura ${lin(ref)}` : ""}${x.temLinha && h[1] !== ref ? ` · na hora a linha era ${lin(h[1])}: ${x.rotA} ${prob(semMargem(h[2], h[3]))}` : ""} (odd ${dec(h[2])} / ${x.rotB} ${dec(h[3])})`]; }).filter((p) => p[1] != null);
    const rodape = `Abertura: ${x.temLinha ? `linha ${lin(x.dk.linhaAb)}, ` : ""}${x.rotA} ${dec(x.dk.overAb)} / ${x.rotB} ${dec(x.dk.underAb)} (1º ponto, sem hora: a casa não informa quando abriu) · depois, gravado a cada ~10 min`;
    const mudouLinha = x.temLinha && serie.some(({ h }) => h[1] !== ref);
    const chance = grafico({ titulo: `Chance de ${x.rotA} sem a margem${x.temLinha ? `, na linha de abertura (${lin(ref)})` : ""} (DraftKings)`, pontos: ptsP, eixo: "pct", refs,
      rodape: rodape + (mudouLinha ? " · nos pontos em que a linha já era outra, a chance foi convertida para a linha de abertura (mesma conta do movimento da tabela)" : "") });
    if (!x.temLinha) return chance;
    const ptsLinha = serie.map(({ h, ab }) => [h[0], h[1], `${ab ? "ABERTURA · " : ""}linha ${lin(h[1])} · ${x.rotA} ${dec(h[2])} / ${x.rotB} ${dec(h[3])}`]).filter((p) => p[1] != null);
    return `<div class="graf-duo">${grafico({ titulo: `Linha da DraftKings${x.k === "spread" ? ` (${x.rotA})` : ""}`, pontos: ptsLinha, eixo: "linha", degrau: true, refs })}${chance}</div>`;
  }
  return `<p class="muted">Ainda sem histórico da DraftKings para ${x.k ? "este mercado" : "esta linha"}: ele é gravado a cada ~10 min.</p>`;
}

// ---------- render ----------
function quando(j) {
  if (j.estado === "in") return `<span class="momento vivo">Ao vivo</span> ${esc(j.placar)}`;
  const m = (j.inicio - Date.now()) / 60e3;
  if (m <= 0) return `<span class="momento vivo">Começando</span>`;
  return m < 60 ? `começa em ${Math.round(m)} min (${hora(j.inicio)})` : m < 24 * 60 ? `começa às ${hora(j.inicio)} (em ${Math.round(m / 60)} h)` : `começa ${dataHora(j.inicio)}`;
}

function linha(j, x, mv) {
  const aberto = abertos.has(x.id);
  const dir = mv.forca < 0.005 ? "" : mv.sinal > 0 ? `▲ ${x.rotA}` : `▼ ${x.rotB}`;
  const partes = [mv.dl ? `${mv.dl > 0 ? "+" : "−"}${lin(Math.abs(mv.dl))} na linha` : "", mv.dp != null && Math.abs(mv.dp) >= 0.005 ? pp(mv.dp) : ""].filter(Boolean);
  const les = x.lesao ? ` <span class="tag-les" title="${esc(x.lesao.motivo)}">${esc(x.lesao.status)}</span>` : "";
  // minigráfico: linha + chance do Over (1 ponto de linha = 1 unidade; a chance ajusta dentro da linha)
  const serie = serieAjustada(x);
  return `<tr class="mk${aberto ? " aberto" : ""}${ehNova(x) ? " nova" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-expanded="${aberto}">
      <td><b>${esc(x.jogador)}</b>${les}${tagNova(x)}<small>${esc(x.sigla)}</small></td><td>${TIPOS[x.tipo]}${x.proj != null ? `<small>Edgely ${lin(x.proj)}</small>` : ""}</td>
      <td class="n">${seta(mv.ref.linha, x.dk.linha, lin)}</td>
      <td class="n">${seta(x.dk.overAb, x.dk.over, dec)}<small>Under ${dec(x.dk.under)}</small></td>
      <td class="n">${seta(mv.ref.p, x.dk.p, prob)}</td>
      <td class="n mov${mv.forca >= 0.10 ? " forte" : ""}"><b>${mv.forca < 0.005 ? "–" : `≈ ${pp(mv.sinal)}`}</b><small>${[partes.join(" · "), dir].filter(Boolean).join(" · ")}</small></td>
      <td>${sparkline(serie)}</td></tr>
    ${aberto ? `<tr class="det"><td colspan="7">${detalhe(j, x)}</td></tr>` : ""}`;
}

// projeção do Edgely num mercado do jogo: total → pontos; handicap/vencedor → quem vence e por quanto (margem = mandante − visitante)
const projJogoTxt = (x) => (x.proj == null ? "" : x.k === "total" ? `<small>Edgely ${lin(x.proj)}</small>`
  : `<small>Edgely: ${esc(x.proj < 0 ? x.rotA : x.rotB)} por ${lin(Math.abs(x.proj))}</small>`);
// mercado do jogo (vencedor, handicap, totais): mesma leitura das props, com os lados do mercado
function linhaJogo(j, x, mv) {
  const aberto = abertos.has(x.id);
  const dir = mv.forca < 0.005 ? "" : mv.sinal > 0 ? `▲ ${x.rotA}` : `▼ ${x.rotB}`;
  const partes = [mv.dl ? `${mv.dl > 0 ? "+" : "−"}${lin(Math.abs(mv.dl))} na linha` : "", mv.dp != null && Math.abs(mv.dp) >= 0.005 ? pp(mv.dp) : ""].filter(Boolean);
  const linhaTxt = (v) => (v == null ? "–" : x.k === "spread" ? `${v > 0 ? "+" : ""}${lin(v)}` : lin(v));
  return `<tr class="mk${aberto ? " aberto" : ""}${ehNova(x) ? " nova" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-expanded="${aberto}">
      <td><b>${esc(x.nome)}</b>${tagNova(x)}${x.k === "spread" ? `<small>linha de ${esc(x.rotA)}</small>` : ""}${projJogoTxt(x)}</td>
      <td class="n">${x.temLinha ? seta(mv.ref.linha, x.dk.linha, linhaTxt) : "–"}</td>
      <td class="n">${esc(x.rotA)} ${seta(x.dk.overAb, x.dk.over, dec)}<small>${esc(x.rotB)} ${seta(x.dk.underAb, x.dk.under, dec)}</small></td>
      <td class="n">${seta(mv.ref.p, x.dk.p, prob)}<small>${esc(x.rotA)}</small></td>
      <td class="n mov${mv.forca >= 0.05 ? " forte" : ""}"><b>${mv.forca < 0.005 ? "–" : `≈ ${pp(mv.sinal)}`}</b><small>${[partes.join(" · "), dir].filter(Boolean).join(" · ")}</small></td>
      <td>${sparkline(serieAjustada(x))}</td></tr>
    ${aberto ? `<tr class="det"><td colspan="6">${detalhe(j, x)}</td></tr>` : ""}`;
}

// aba Edge: todas as props de todos os jogos com projeção, da maior para a menor em valor esperado
function infoEdgely() {
  let t;
  if (!edgely?.data) t = "Ainda sem projeções do Edgely: a busca automática é a partir das 9 h de Nova York (10 h de Brasília), ou use o botão.";
  else {
    const ult = edgely.versoes?.[edgely.versoes.length - 1];
    t = `Projeções do Edgely de ${edgely.data.split("-").reverse().slice(0, 2).join("/")} · <b>atualizadas pelo Edgely às ${hora(edgely.mudouEm || edgely.buscadoEm)}</b>${ult?.mudaram && edgely.versoes.length > 1 ? ` (${ult.mudaram} jogadores mudaram)` : ""} · conferido às ${hora(edgely.buscadoEm)} (a cada 30 min; 10 min perto dos jogos) · ${edgely.jogadores.length} jogadores`;
    if (edgely.data !== hojeEt()) t += " · <b>são de outro dia</b> (os jogos de hoje ficam sem projeção até a próxima busca)";
  }
  if (edgely?.erro) t += ` · última tentativa falhou (${esc(edgely.erro)})`;
  $("#edgely-info").innerHTML = [t, pedidoMsg && `<b>${esc(pedidoMsg)}</b>`].filter(Boolean).join("<br>");
}
const pctSinal = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")}%`;
function renderEdge() {
  infoEdgely();
  const busca = normal(f.busca), min = f.ev === "" ? -Infinity : +f.ev;
  const L = [];
  for (const j of jogos) {
    for (const x of j.linhas) {
      if ((f.tipo && x.tipo !== f.tipo) || (busca && !normal(x.jogador).includes(busca))) continue;
      const e = edgeDe(x);
      if (e && e.ev >= min) L.push({ j, x, e });
    }
    if (!f.tipo || f.tipo === "jogo") for (const x of j.mercados) { // total, handicap e vencedor com a projeção de jogo do Edgely
      if (x.proj == null || (busca && !normal(j.titulo).includes(busca))) continue;
      const e = edgeDe(x);
      if (e && e.ev >= min) L.push({ j, x, e });
    }
  }
  L.sort((a, b) => b.e.ev - a.e.ev);
  if (!L.length) {
    const comProj = jogos.some((j) => j.linhas.some((x) => x.proj != null));
    $("#jogos").innerHTML = rodando ? "" : `<div class="vazio"><b>${comProj ? "Nenhuma linha com esses filtros." : "Nenhuma prop da DraftKings com projeção do Edgely para casar agora."}</b></div>`;
    return;
  }
  // divergência extrema (≥ 30 pp entre a chance pela projeção e a da DraftKings): quase sempre minutos/papel
  // diferentes na projeção (troca de time, volta de lesão, começo de temporada); ficam numa lista à parte
  const extrema = (e) => e.mercado != null && Math.abs(e.chance - e.mercado) >= 0.30;
  const normais = L.filter(({ e }) => !extrema(e)), extremas = L.filter(({ e }) => extrema(e));
  $("#jogos").innerHTML = [
    normais.length ? tabelaEdge(normais, `${normais.length} linhas`) : "",
    extremas.length ? tabelaEdge(extremas, `Divergências extremas · ${extremas.length} linhas`, "A projeção e a DraftKings discordam em 30 pp ou mais. Quase sempre a projeção usa minutos diferentes (veja os minutos projetados): troca de time, volta de lesão, rotação nova. Confira antes de confiar.") : "",
  ].join("");
}
function tabelaEdge(L, titulo, nota = "") {
  return `<section class="panel"><h2>${esc(titulo)}</h2>${nota ? `<p class="muted">${nota}</p>` : ""}<div class="tbl-wrap"><table class="props-tab edge-tab"><thead><tr>
      <th>Jogador</th><th>Jogo</th><th>Estatística</th><th class="n">Projeção</th><th class="n">Linha DK</th><th class="n">Dif.</th><th class="n">Aposta</th><th class="n">Chance pela projeção</th><th class="n">Chance DK sem margem</th><th class="n">Valor esperado</th></tr></thead>
    <tbody>${L.map(({ j, x, e }) => {
      const aberto = abertos.has(x.id);
      const les = x.lesao ? ` <span class="tag-les" title="${esc(x.lesao.motivo)}">${esc(x.lesao.status)}</span>` : "";
      const projTxt = x.k ? (x.k === "total" ? lin(x.proj) : `${esc(x.proj < 0 ? x.rotA : x.rotB)} por ${lin(Math.abs(x.proj))}`) : lin(x.proj);
      return `<tr class="mk${aberto ? " aberto" : ""}${ehNova(x) ? " nova" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-expanded="${aberto}">
        <td><b>${esc(x.k ? x.nome : x.jogador)}</b>${les}${tagNova(x)}<small>${esc(x.k ? "mercado do jogo" : x.sigla)}</small></td>
        <td>${esc(j.titulo)}<small>${j.estado === "in" ? "ao vivo" : hora(j.inicio)}</small></td>
        <td>${x.k ? "Jogo" : TIPOS[x.tipo]}</td>
        <td class="n">${projTxt}${x.projMin != null ? `<small>${lin(x.projMin)} min</small>` : ""}</td>
        <td class="n">${x.k === "ml" ? "–" : seta(x.dk.linhaAb, x.dk.linha, lin)}</td>
        <td class="n">${e.dif == null ? "–" : `${e.dif >= 0 ? "+" : "−"}${lin(Math.round(10 * Math.abs(e.dif)) / 10)}`}</td>
        <td class="n"><b>${esc(e.ladoTxt)}</b> ${dec(e.odd)}</td>
        <td class="n">${prob(e.chance)}</td>
        <td class="n">${prob(e.mercado)}</td>
        <td class="n mov${e.ev >= 0.10 ? " forte" : ""}"><b>${pctSinal(e.ev)}</b></td></tr>
      ${aberto ? `<tr class="det"><td colspan="10">${detalhe(j, x)}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div></section>`;
}

function render() {
  if (f.aba === "filtros") { // temporada: arquivo do mercado (relido a cada 10 min); hoje: os jogos já carregados
    if (filtrosVelho()) carregarFiltros().then(() => f.aba === "filtros" && renderFiltros($("#jogos"), f, jogos));
    renderFiltros($("#jogos"), f, jogos);
    return;
  }
  if (f.aba === "acomp") { // não depende dos jogos de hoje: lê data/apostas_edgely (relido a cada 5 min)
    if (acompVelho()) carregarAcomp().then(() => f.aba === "acomp" && renderAcomp($("#jogos"), f));
    renderAcomp($("#jogos"), f);
    return;
  }
  if (f.aba === "edge" && !(erro && !jogos.length)) {
    if (carregadoEm) $("#atualizado").textContent = `atualizado ${hora(carregadoEm)} · a cada 5 min`;
    renderEdge();
    return;
  }
  if (erro && !jogos.length) {
    $("#jogos").innerHTML = `<div class="banner"><b>Não consegui ler os dados.</b><span>${esc(erro.message || erro)}</span></div>`;
    return;
  }
  if (carregadoEm) $("#atualizado").textContent = `atualizado ${hora(carregadoEm)} · a cada 5 min`;
  const busca = normal(f.busca), min = +f.min;
  $("#aviso-hist").hidden = f.aba !== "mov" || !(jogos.length && !jogos.some((j) => j.comHist) && f.desde !== "abertura");
  const html = jogos.map((j) => {
    const L = j.linhas
      .filter((x) => (!f.tipo || x.tipo === f.tipo) && (!busca || normal(x.jogador).includes(busca)))
      .map((x) => ({ x, mv: movimento(x) }))
      .filter(({ mv }) => !min || mv.forca >= min)
      .sort((a, b) => b.mv.forca - a.mv.forca || a.x.jogador.localeCompare(b.x.jogador));
    if (!L.length && (busca || min)) return "";
    const tabJogo = j.mercados.length && !busca ? `<h3 class="sub-jogo">Mercados do jogo</h3><div class="tbl-wrap"><table class="props-tab jogo-tab"><thead><tr><th>Mercado</th><th class="n">Linha</th><th class="n">Odds</th><th class="n">Chance sem margem</th><th class="n">Movimento</th><th>Histórico</th></tr></thead>
        <tbody>${j.mercados.map((x) => linhaJogo(j, x, movimento(x))).join("")}</tbody></table></div>` : "";
    const top = L.filter(({ mv }) => mv.forca >= 0.03).slice(0, 3).map(({ x, mv }) =>
      `<span class="chip${mv.forca >= 0.10 ? " forte" : ""}">${esc(x.jogador)} · ${TIPOS[x.tipo].toLowerCase()} ${lin(x.dk.linha)} ${mv.sinal > 0 ? "▲" : "▼"}</span>`).join("");
    const les = j.lesoes.length ? `<p class="lesoes"><b>Lesões:</b> ${j.lesoes.map((l) => `${esc(l.sigla)} ${esc(l.nome)} <span class="tag-les">${esc(l.status)}</span>${l.motivo ? ` <small>${esc(l.motivo)}</small>` : ""}`).join(" · ")}</p>` : "";
    return `<section class="panel jogo">
      <div class="jogo-top"><h2>${esc(j.titulo)}</h2><span class="muted">${quando(j)}</span></div>
      ${les}
      ${tabJogo}
      <h3 class="sub-jogo">Props dos jogadores</h3>
      ${top ? `<div class="chips"><span class="muted">Mais movimentadas:</span>${top}</div>` : `<p class="muted">Nenhuma linha andou o equivalente a 3 pp ou mais ${f.desde === "abertura" ? "desde a abertura" : `nas últimas ${f.desde}`}.</p>`}
      ${L.length ? `<div class="tbl-wrap"><table class="props-tab"><thead><tr><th>Jogador</th><th>Estatística</th><th class="n">Linha</th><th class="n">Odd do Over</th><th class="n">Over sem margem</th><th class="n">Movimento</th><th>Histórico</th></tr></thead>
        <tbody>${L.map(({ x, mv }) => linha(j, x, mv)).join("")}</tbody></table></div>` : ""}
    </section>`;
  }).join("");
  $("#jogos").innerHTML = html || (rodando ? "" : `<div class="vazio"><b>Nenhum jogo da NBA com props na DraftKings hoje ou amanhã${busca || min ? " com esses filtros" : ""}.</b></div>`);
}

// abrir/fechar o gráfico de uma linha
function alternar(tr) {
  const id = tr.dataset.id;
  if (abertos.has(id)) abertos.delete(id); else abertos.add(id);
  render();
}
$("#jogos").addEventListener("click", (e) => { const tr = e.target.closest("tr.mk"); if (tr && !e.target.closest("a")) alternar(tr); });
$("#jogos").addEventListener("keydown", (e) => { const tr = e.target.closest("tr.mk"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); alternar(tr); } });

carregar();
setInterval(carregar, REFRESCO);
setInterval(render, 60_000); // relógio do "começa em"
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (carregadoEm || 0) > REFRESCO) carregar(); });
