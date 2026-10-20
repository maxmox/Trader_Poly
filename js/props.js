// Página "Props NBA": movimento de pontos, rebotes e assistências, por jogo.
// Fonte principal: DraftKings pela API pública da ESPN (linha e odd de abertura e atuais; lerPropsDk em core.js),
// com as lesões do jogo (ESPN) e o histórico gravado pelo Worker a cada 10 min (GET /props-dk). O Polymarket
// entra como comparação (chance do Over agora) e como gráfico de reserva enquanto não há histórico da DraftKings.
import { criarApi, linkMercado, buscarPropsDk, datasNba, semMargem } from "./core.js";
import { $, esc, hora, dataHora } from "./formato.js";

const TIPOS = { points: "Pontos", rebounds: "Rebotes", assists: "Assistências" };
// quanto 1 ponto de linha muda a chance do Over perto do meio (normal com o desvio típico de cada estatística:
// pontos ~6, rebotes ~2,8, assistências ~2,3). Serve para comparar a chance em linhas diferentes.
const POR_LINHA = { points: 0.065, rebounds: 0.14, assists: 0.17 };
const REFRESCO = 5 * 60_000;
const JANELA = { "24h": 24 * 3600, "3h": 3 * 3600 };
const CHAVE = "props-filtros";
// site.api.espn.com vai pelo relay (o navegador chegou a recusar a chamada direta); a API "core" vai direto
const ESPN_NBA = "/apis/site/v2/sports/basketball/nba";
let SITE = `https://site.api.espn.com${ESPN_NBA}`;

let api = null, relay = "", jogos = [], erro = null, carregadoEm = null, rodando = false;
const abertos = new Set(); // linhas com o gráfico aberto
const pmHist = new Map(); // token do Polymarket -> histórico (reserva do gráfico)

// ---------- filtros (salvos só neste navegador) ----------
const PADRAO_F = { tipo: "", desde: "abertura", min: "0", busca: "" };
let f = (() => { try { return { ...PADRAO_F, ...JSON.parse(localStorage.getItem(CHAVE) || "{}") }; } catch { return { ...PADRAO_F }; } })();
for (const [k, sel] of [["tipo", "#f-tipo"], ["desde", "#f-desde"], ["min", "#f-min"], ["busca", "#f-busca"]]) {
  const el = $(sel);
  el.value = f[k];
  el.addEventListener(k === "busca" ? "input" : "change", () => {
    f[k] = el.value;
    try { localStorage.setItem(CHAVE, JSON.stringify({ ...f, busca: "" })); } catch { /* sem armazenamento */ }
    render();
  });
}
$("#btn-atualizar").addEventListener("click", () => carregar());

// ---------- números ----------
const pp = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")} pp`);
const prob = (p) => (p == null ? "–" : `${Math.round(100 * p)}%`);
const dec = (v) => (v == null ? "–" : v.toFixed(2).replace(".", ","));
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
const seta = (a, b, fmt) => (a == null || a === b ? fmt(b) : `${fmt(a)} → <b>${fmt(b)}</b>`);
const normal = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z]/g, "");
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`); return r.json(); };

async function emLotes(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k]); } }));
}

// elenco do time (id do atleta -> nome); guardado por 12 h neste navegador
const elencos = new Map();
async function elenco(idTime) {
  if (elencos.has(idTime)) return elencos.get(idTime);
  const ck = `nba-elenco-${idTime}`;
  try { const c = JSON.parse(localStorage.getItem(ck) || "null"); if (c && Date.now() - c.em < 12 * 3600e3) { elencos.set(idTime, c.m); return c.m; } } catch { /* sem cache */ }
  const r = await getJson(`${SITE}/teams/${idTime}/roster`).catch(() => null);
  const m = Object.fromEntries((r?.athletes || []).map((a) => [a.id, a.displayName]));
  elencos.set(idTime, m);
  try { localStorage.setItem(ck, JSON.stringify({ em: Date.now(), m })); } catch { /* sem cache */ }
  return m;
}

// movimento desde a referência escolhida: linha, chance sem margem e o movimento EQUIVALENTE, isto é, quanto
// a chance do Over mudou na linha da referência (a chance na linha nova + o efeito de ter mudado a linha)
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
  const sinal = dl * POR_LINHA[x.tipo] + (dp ?? 0);
  return { ref, dl, dp, sinal, forca: Math.abs(sinal) };
}

// ---------- dados ----------
function macroEspn(ev) {
  const o = ev.competitions?.[0]?.odds?.[0];
  const out = [];
  if (o?.details) out.push(`Handicap <b>${esc(o.details.replace(".", ","))}</b>`);
  if (o?.overUnder != null) out.push(`Total <b>${lin(o.overUnder)}</b>`);
  return out;
}

async function carregarJogo(ev, pmEventos) {
  const c = ev.competitions[0];
  const times = c.competitors.map((t) => ({ id: t.team.id, sigla: t.team.abbreviation, nome: t.team.shortDisplayName, casa: t.homeAway === "home" }));
  const [props, e1, e2, resumo, hist] = await Promise.all([
    buscarPropsDk(getJson, ev.id).catch(() => ({})),
    elenco(times[0].id), elenco(times[1].id),
    getJson(`${SITE}/summary?event=${ev.id}`).catch(() => null),
    relay ? getJson(`${relay.replace(/\/$/, "")}/props-dk?ev=${ev.id}`).catch(() => null) : null,
  ]);
  const nomes = { ...e1, ...e2 }, siglaDe = {};
  for (const id of Object.keys(e1)) siglaDe[id] = times[0].sigla;
  for (const id of Object.keys(e2)) siglaDe[id] = times[1].sigla;
  const lesoes = {};
  for (const t of resumo?.injuries || []) for (const i of t.injuries || []) lesoes[normal(i.athlete?.displayName)] = { status: i.status, motivo: i.details?.type || "", sigla: t.team?.abbreviation, nome: i.athlete?.displayName };
  // Polymarket do mesmo jogo (título com os dois apelidos) e os mercados por jogador
  const pm = pmEventos.find((e) => times.every((t) => (e.title || "").includes(t.nome)));
  const pmMercados = {};
  for (const m of pm?.markets || []) {
    if (!TIPOS[m.sportsMarketType] || m.closed || !m.clobTokenIds) continue;
    const k = `${normal((m.question || "").split(":")[0])}|${m.sportsMarketType}`;
    (pmMercados[k] ||= []).push(m);
  }
  const linhas = Object.values(props).map((dk) => {
    const jogador = nomes[dk.atleta] || `atleta ${dk.atleta}`;
    const L = pmMercados[`${normal(jogador)}|${dk.tipo}`] || [];
    const m = L.sort((a, b) => Math.abs(a.line - dk.linha) - Math.abs(b.line - dk.linha))[0];
    // chance do Over no Polymarket = meio do livro, só com spread de até 10¢ (livro vazio cota 50%)
    const pmAgora = m && m.bestAsk != null && m.bestBid != null && m.bestAsk - m.bestBid <= 0.10 ? (m.bestAsk + m.bestBid) / 2 : null;
    return {
      id: `${ev.id}|${dk.atleta}|${dk.tipo}`, jogador, sigla: siglaDe[dk.atleta] || "", tipo: dk.tipo, dk,
      lesao: lesoes[normal(jogador)] || null, hist: hist?.h?.[`${dk.atleta}|${dk.tipo}`] || [],
      pm: m ? { linha: m.line, p: pmAgora, vol: +(m.volumeNum || 0), tok: JSON.parse(m.clobTokenIds)[0], slug: m.slug, eventSlug: pm.slug } : null,
    };
  });
  return {
    id: ev.id, titulo: `${times.find((t) => !t.casa)?.nome} @ ${times.find((t) => t.casa)?.nome}`, inicio: Date.parse(ev.date),
    estado: ev.status?.type?.state, placar: ev.status?.type?.state === "in" ? `${c.competitors.map((t) => `${t.team.abbreviation} ${t.score}`).join(" · ")} · ${ev.status.type.shortDetail}` : "",
    macro: macroEspn(ev), lesoes: Object.values(lesoes), linhas, comHist: !!hist?.em,
  };
}

async function carregar() {
  if (rodando || document.hidden) return; // aba em segundo plano: não consulta
  rodando = true;
  $("#btn-atualizar").textContent = "Atualizando…";
  try {
    if (!api) {
      const cfg = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      relay = cfg.relay || "";
      try { relay = JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}").relay || relay; } catch { /* padrão */ }
      api = criarApi({ relay });
      if (relay) SITE = `${relay.replace(/\/$/, "")}/espn${ESPN_NBA}`;
    }
    const evs = [];
    for (const d of datasNba()) evs.push(...(((await getJson(`${SITE}/scoreboard?dates=${d}`)).events) || []));
    const vivos = evs.filter((e) => e.status?.type?.state !== "post"); // jogo encerrado some da página
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    const pmEventos = (await api.get("gamma", `/events?tag_slug=nba&closed=false&start_time_min=${iso(Date.now() - 4 * 3600e3)}&start_time_max=${iso(Date.now() + 52 * 3600e3)}&limit=100`).catch(() => null)) || [];
    const novos = [];
    let feitos = 0;
    await emLotes(vivos, 3, async (ev) => {
      const j = await carregarJogo(ev, pmEventos).catch(() => null);
      if (j?.linhas.length) novos.push(j);
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

function detalhe(j, x) {
  const timed = x.hist.filter((h) => h[0] != null);
  const refs = [{ t: j.inicio / 1000, rot: "início" }];
  if (timed.length >= 2) {
    const ptsLinha = timed.map((h) => [h[0], h[1], `linha ${lin(h[1])} · Over ${dec(h[2])} / Under ${dec(h[3])}`]);
    const ptsP = timed.map((h) => [h[0], semMargem(h[2], h[3]), `Over ${prob(semMargem(h[2], h[3]))} na linha ${lin(h[1])} (odd ${dec(h[2])})`]).filter((p) => p[1] != null);
    return `<div class="graf-duo">
      ${grafico({ titulo: "Linha da DraftKings", pontos: ptsLinha, eixo: "linha", degrau: true, refs })}
      ${grafico({ titulo: "Chance do Over sem a margem (DraftKings)", pontos: ptsP, eixo: "pct", refs, rodape: `Abertura: linha ${lin(x.dk.linhaAb)}, Over ${dec(x.dk.overAb)} · gravado pelo Worker a cada 10 min${x.pm ? ` · <a href="${linkMercado(x.pm)}" target="_blank" rel="noopener">Polymarket ↗</a>` : ""}` })}
    </div>`;
  }
  // sem histórico da DraftKings ainda: gráfico do Polymarket (reserva)
  if (!x.pm) return `<p class="muted">Ainda sem histórico da DraftKings para esta linha (o Worker grava a cada 10 min) e sem mercado no Polymarket.</p>`;
  const h = pmHist.get(x.pm.tok);
  if (!h) return `<p class="muted">Carregando o histórico do Polymarket…</p>`;
  const pts = h.map((p) => [p.t, p.p, `Polymarket: Over ${prob(p.p)} na linha ${lin(x.pm.linha)}`]);
  return grafico({ titulo: `Chance do Over no Polymarket (linha ${lin(x.pm.linha)})`, pontos: pts, eixo: "pct", refs,
    rodape: `A DraftKings só informa abertura e agora; o histórico dela começa quando o Worker novo estiver no ar. Volume no Polymarket: $${Math.round(x.pm.vol)} · <a href="${linkMercado(x.pm)}" target="_blank" rel="noopener">Abrir ↗</a>` });
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
  const dir = mv.forca < 0.005 ? "" : mv.sinal > 0 ? "▲ Over" : "▼ Under";
  const partes = [mv.dl ? `${mv.dl > 0 ? "+" : "−"}${lin(Math.abs(mv.dl))} na linha` : "", mv.dp != null && Math.abs(mv.dp) >= 0.005 ? pp(mv.dp) : ""].filter(Boolean);
  const les = x.lesao ? ` <span class="tag-les" title="${esc(x.lesao.motivo)}">${esc(x.lesao.status)}</span>` : "";
  // minigráfico: linha + chance do Over (1 ponto de linha = 1 unidade; a chance ajusta dentro da linha)
  const serie = x.hist.filter((h) => h[0] != null).map((h) => h[1] + ((semMargem(h[2], h[3]) ?? 0.5) - 0.5) / POR_LINHA[x.tipo]);
  return `<tr class="mk${aberto ? " aberto" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-expanded="${aberto}">
      <td><b>${esc(x.jogador)}</b>${les}<small>${esc(x.sigla)}</small></td><td>${TIPOS[x.tipo]}</td>
      <td class="n">${seta(mv.ref.linha, x.dk.linha, lin)}</td>
      <td class="n">${seta(x.dk.overAb, x.dk.over, dec)}<small>Under ${dec(x.dk.under)}</small></td>
      <td class="n">${seta(mv.ref.p, x.dk.p, prob)}</td>
      <td class="n mov${mv.forca >= 0.10 ? " forte" : ""}"><b>${mv.forca < 0.005 ? "–" : `≈ ${pp(mv.sinal)}`}</b><small>${[partes.join(" · "), dir].filter(Boolean).join(" · ")}</small></td>
      <td class="n">${x.pm ? `${prob(x.pm.p)}${x.pm.linha !== x.dk.linha ? `<small>linha ${lin(x.pm.linha)}</small>` : ""}` : "–"}</td>
      <td>${sparkline(serie)}</td></tr>
    ${aberto ? `<tr class="det"><td colspan="8">${detalhe(j, x)}</td></tr>` : ""}`;
}

function render() {
  if (erro && !jogos.length) {
    $("#jogos").innerHTML = `<div class="banner"><b>Não consegui ler os dados.</b><span>${esc(erro.message || erro)}</span></div>`;
    return;
  }
  if (carregadoEm) $("#atualizado").textContent = `atualizado ${hora(carregadoEm)} · a cada 5 min`;
  const busca = normal(f.busca), min = +f.min;
  $("#aviso-hist").hidden = !(jogos.length && !jogos.some((j) => j.comHist) && f.desde !== "abertura");
  const html = jogos.map((j) => {
    const L = j.linhas
      .filter((x) => (!f.tipo || x.tipo === f.tipo) && (!busca || normal(x.jogador).includes(busca)))
      .map((x) => ({ x, mv: movimento(x) }))
      .filter(({ mv }) => !min || mv.forca >= min)
      .sort((a, b) => b.mv.forca - a.mv.forca || a.x.jogador.localeCompare(b.x.jogador));
    if (!L.length && (busca || min)) return "";
    const top = L.filter(({ mv }) => mv.forca >= 0.03).slice(0, 3).map(({ x, mv }) =>
      `<span class="chip${mv.forca >= 0.10 ? " forte" : ""}">${esc(x.jogador)} · ${TIPOS[x.tipo].toLowerCase()} ${lin(x.dk.linha)} ${mv.sinal > 0 ? "▲" : "▼"}</span>`).join("");
    const les = j.lesoes.length ? `<p class="lesoes"><b>Lesões:</b> ${j.lesoes.map((l) => `${esc(l.sigla)} ${esc(l.nome)} <span class="tag-les">${esc(l.status)}</span>${l.motivo ? ` <small>${esc(l.motivo)}</small>` : ""}`).join(" · ")}</p>` : "";
    return `<section class="panel jogo">
      <div class="jogo-top"><h2>${esc(j.titulo)}</h2><span class="muted">${quando(j)}</span></div>
      ${j.macro.length ? `<p class="macro">${j.macro.join(" · ")} <small class="muted">(DraftKings)</small></p>` : ""}
      ${les}
      ${top ? `<div class="chips"><span class="muted">Mais movimentadas:</span>${top}</div>` : `<p class="muted">Nenhuma linha andou o equivalente a 3 pp ou mais ${f.desde === "abertura" ? "desde a abertura" : `nas últimas ${f.desde}`}.</p>`}
      ${L.length ? `<div class="tbl-wrap"><table class="props-tab"><thead><tr><th>Jogador</th><th>Estatística</th><th class="n">Linha</th><th class="n">Odd do Over</th><th class="n">Over sem margem</th><th class="n">Movimento</th><th class="n">Polymarket</th><th>Histórico</th></tr></thead>
        <tbody>${L.map(({ x, mv }) => linha(j, x, mv)).join("")}</tbody></table></div>` : ""}
    </section>`;
  }).join("");
  $("#jogos").innerHTML = html || (rodando ? "" : `<div class="vazio"><b>Nenhum jogo da NBA com props na DraftKings hoje ou amanhã${busca || min ? " com esses filtros" : ""}.</b></div>`);
}

async function alternar(tr) {
  const id = tr.dataset.id;
  if (abertos.has(id)) { abertos.delete(id); render(); return; }
  abertos.add(id);
  render();
  const j = jogos.find((g) => id.startsWith(`${g.id}|`)), x = j?.linhas.find((l) => l.id === id);
  if (x && x.hist.filter((h) => h[0] != null).length < 2 && x.pm && !pmHist.has(x.pm.tok)) {
    const h = (await api.get("clob", `/prices-history?market=${x.pm.tok}&interval=max&fidelity=10`).catch(() => null))?.history || [];
    pmHist.set(x.pm.tok, h.map((p) => ({ t: p.t, p: +p.p })).sort((a, b) => a.t - b.t));
    render();
  }
}
$("#jogos").addEventListener("click", (e) => { const tr = e.target.closest("tr.mk"); if (tr && !e.target.closest("a")) alternar(tr); });
$("#jogos").addEventListener("keydown", (e) => { const tr = e.target.closest("tr.mk"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); alternar(tr); } });

carregar();
setInterval(carregar, REFRESCO);
setInterval(render, 60_000); // relógio do "começa em"
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (carregadoEm || 0) > REFRESCO) carregar(); });
