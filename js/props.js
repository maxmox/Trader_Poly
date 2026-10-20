// Página "Props NBA": movimento das linhas de pontos, rebotes e assistências do Polymarket, por jogo.
// Cada mercado é "Jogador: Points O/U 26.5" com Yes = Over; a linha é fixa e o que anda é a chance do Over.
// Lista: histórico de hora em hora (1 consulta por mercado); detalhe: histórico de 10 em 10 min ao clicar.
// Abertura = preço 1 h depois da criação (o mercado nasce cotado a ~50% com o livro vazio); pontos de livro
// vazio (50% com o preço real em outro nível) são descartados (limpar).
import { criarApi, odd, linkMercado } from "./core.js";
import { $, esc, usd, hora, dataHora } from "./formato.js";

const TIPOS = { points: "Pontos", rebounds: "Rebotes", assists: "Assistências" };
const REFRESCO = 5 * 60_000;
const ABERTURA_SEG = 3600;
const JANELA = { "24h": 24 * 3600, "3h": 3 * 3600 };
const CHAVE = "props-filtros";

let api = null, jogos = [], erro = null, carregadoEm = null, rodando = false;
const abertos = new Set(); // mercados com o gráfico aberto (slug)
const detalhe = new Map(); // slug -> histórico de 10 min

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
const probOdd = (p) => (p == null ? "–" : `${prob(p)} <small>(${odd(p)})</small>`);
const linhaTxt = (v) => String(v).replace(".", ",");
const precoEm = (h, t) => { let p = null; for (const x of h) { if (x.t <= t) p = x.p; else break; } return p; };

// Livro vazio: sem ofertas o Polymarket cota 50% e o preço pula entre 50% e o valor real (degraus no gráfico,
// "abertura" falsa em 50%). Se o mercado passa boa parte do tempo claramente longe de 50%, os pontos de
// exatamente ~50% são livro vazio e saem. Linha que está mesmo perto de 50% fica como está.
const vazio = (p) => Math.abs(p - 0.5) <= 0.016; // 49%-51%: meio de um livro vazio ou quase
function limpar(h) {
  const longe = h.filter((x) => Math.abs(x.p - 0.5) > 0.03).length;
  if (longe < 0.3 * h.length) return h;
  const out = h.filter((x) => !vazio(x.p));
  return out.length >= 2 ? out : h;
}
const serie = (bruto) => limpar((bruto || []).map((p) => ({ t: p.t, p: +p.p })).sort((a, b) => a.t - b.t));

// variação da chance do Over desde a referência escolhida
function movimento(m) {
  const h = m.hist;
  if (!h.length) return null;
  const agora = h[h.length - 1].p;
  const ref = f.desde === "abertura" ? m.abertura : precoEm(h, h[h.length - 1].t - JANELA[f.desde]) ?? h[0].p;
  return ref == null ? null : agora - ref;
}

// ---------- dados ----------
async function emLotes(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k]); } }));
}

function macro(ev) {
  const ms = ev.markets || [];
  const out = [];
  const ml = ms.find((m) => m.sportsMarketType === "moneyline");
  if (ml) {
    const nomes = JSON.parse(ml.outcomes || "[]"), pr = JSON.parse(ml.outcomePrices || "[]").map(Number);
    const k = pr[0] >= pr[1] ? 0 : 1;
    if (nomes[k]) out.push(`Favorito <b>${esc(nomes[k])}</b> ${prob(pr[k])}`);
  }
  // total e handicap principais = a linha com preço mais perto de 50%
  const principal = (tipo) => ms.filter((m) => m.sportsMarketType === tipo && !m.closed)
    .map((m) => ({ m, p: +JSON.parse(m.outcomePrices || "[0.5]")[0] })).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))[0]?.m;
  const tot = principal("totals");
  if (tot?.line != null) out.push(`Total <b>${linhaTxt(tot.line)}</b>`);
  const sp = principal("spreads");
  const msp = sp?.question?.match(/Spread:\s*(.+?)\s*\(([-+]?\d+(?:\.\d+)?)\)/i);
  if (msp) out.push(`Handicap <b>${esc(msp[1])} ${msp[2].replace(".", ",")}</b>`);
  return out;
}

async function carregar() {
  if (rodando) return;
  if (document.hidden) return; // aba em segundo plano: não gasta consultas
  rodando = true;
  $("#btn-atualizar").textContent = "Atualizando…";
  try {
    if (!api) {
      const cfg = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      let relay = cfg.relay || "";
      try { relay = JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}").relay || relay; } catch { /* padrão */ }
      api = criarApi({ relay });
      $("#fonte").textContent = relay ? "ao vivo · relay" : "ao vivo";
      $("#fonte").className = "pill live";
    }
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    const agora = Date.now();
    const evs = (await api.get("gamma", `/events?tag_slug=nba&closed=false&start_time_min=${iso(agora - 4 * 3600e3)}&start_time_max=${iso(agora + 48 * 3600e3)}&limit=100`)) || [];
    const novos = evs
      .filter((ev) => /^nba-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}$/.test(ev.slug) && !ev.closed && !ev.ended)
      .map((ev) => ({
        ev, inicio: Date.parse(ev.startTime), macro: macro(ev),
        mercados: (ev.markets || []).filter((m) => TIPOS[m.sportsMarketType] && m.clobTokenIds && !m.closed).map((m) => ({
          m, slug: m.slug, eventSlug: ev.slug, tipo: m.sportsMarketType, linha: m.line,
          jogador: (m.question || "").split(":")[0].trim(), tok: JSON.parse(m.clobTokenIds)[0],
          criado: Date.parse(m.createdAt || m.startDate) / 1000, vol: +(m.volumeNum || 0),
          spread: m.bestAsk != null && m.bestBid != null ? m.bestAsk - m.bestBid : null, hist: [], abertura: null,
        })),
      }))
      .filter((j) => j.mercados.length)
      .sort((a, b) => a.inicio - b.inicio);
    // histórico de hora em hora de cada mercado; os jogos aparecem à medida que chegam
    jogos = novos;
    let feitos = 0;
    const todos = novos.flatMap((j) => j.mercados);
    await emLotes(todos, 8, async (x) => {
      const h = (await api.get("clob", `/prices-history?market=${x.tok}&interval=max&fidelity=60`).catch(() => null))?.history || [];
      x.hist = serie(h);
      x.abertura = x.hist.length ? precoEm(x.hist, (x.criado || x.hist[0].t) + ABERTURA_SEG) ?? x.hist[0].p : null;
      if (++feitos % 40 === 0) { $("#status").textContent = `Carregando histórico: ${feitos}/${todos.length} linhas…`; render(); }
    });
    erro = null;
    carregadoEm = Date.now();
    $("#status").textContent = "";
  } catch (e) {
    erro = e;
    $("#fonte").textContent = "sem dados"; $("#fonte").className = "pill off";
  }
  rodando = false;
  $("#btn-atualizar").textContent = "Atualizar";
  render();
}

// ---------- gráficos ----------
function sparkline(h) {
  if (h.length < 2) return "";
  const W = 96, H = 26, t0 = h[0].t, t1 = h[h.length - 1].t;
  const ps = h.map((x) => x.p), lo = Math.min(...ps), hi = Math.max(...ps), amp = Math.max(hi - lo, 0.04);
  const y = (p) => H - 2 - ((p - (lo + hi) / 2 + amp / 2) / amp) * (H - 4);
  const pts = h.map((x) => `${(((x.t - t0) / (t1 - t0 || 1)) * (W - 4) + 2).toFixed(1)},${y(x.p).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

// gráfico grande da chance do Over desde a criação, com a abertura, o início do jogo e dica ao passar o mouse
function grafico(x, inicio) {
  const h = detalhe.get(x.slug) || x.hist;
  if (h.length < 2) return `<p class="muted">Sem histórico de preço.</p>`;
  const W = 640, H = 200, E = 40, D = 12, T = 12, B = 26;
  const t0 = h[0].t, t1 = Math.max(h[h.length - 1].t, t0 + 60);
  const ps = h.map((p) => p.p);
  let lo = Math.max(0, Math.floor((Math.min(...ps) - 0.03) * 20) / 20), hi = Math.min(1, Math.ceil((Math.max(...ps) + 0.03) * 20) / 20);
  if (hi - lo < 0.1) { const c = (hi + lo) / 2; lo = Math.max(0, c - 0.05); hi = Math.min(1, c + 0.05); }
  const X = (t) => E + ((t - t0) / (t1 - t0)) * (W - E - D);
  const Y = (p) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  const passo = hi - lo > 0.3 ? 0.1 : 0.05;
  const grade = [];
  for (let v = Math.ceil(lo / passo) * passo; v <= hi + 1e-9; v += passo) {
    grade.push(`<line class="g" x1="${E}" x2="${W - D}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${E - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(100 * v)}%</text>`);
  }
  // marcas de dia no eixo x
  const dias = [];
  const d = new Date(t0 * 1000); d.setHours(0, 0, 0, 0);
  for (let t = d.getTime() / 1000 + 86400; t < t1; t += 86400) {
    dias.push(`<line class="g" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${new Date(t * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>`);
  }
  const caminho = h.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.p).toFixed(1)}`).join("");
  const ab = x.abertura != null ? `<line class="ref" x1="${E}" x2="${W - D}" y1="${Y(x.abertura).toFixed(1)}" y2="${Y(x.abertura).toFixed(1)}"/><text class="ax" x="${W - D}" y="${(Y(x.abertura) - 5).toFixed(1)}" text-anchor="end">abertura ${prob(x.abertura)}</text>` : "";
  const ini = inicio / 1000;
  const jogo = ini > t0 && ini < t1 ? `<line class="ref" x1="${X(ini).toFixed(1)}" x2="${X(ini).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${(X(ini) + 4).toFixed(1)}" y="${T + 10}">início</text>` : "";
  const ult = h[h.length - 1];
  const dados = esc(JSON.stringify(h.map((p) => [p.t, Math.round(p.p * 1000) / 1000])));
  return `<div class="graf" data-h="${dados}" data-x0="${t0}" data-x1="${t1}" data-lo="${lo}" data-hi="${hi}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance do Over de ${esc(x.jogador)} ao longo do tempo, de ${prob(h[0].p)} para ${prob(ult.p)}">
      ${grade.join("")}${dias.join("")}${ab}${jogo}
      <path class="serie" d="${caminho}"/>
      <circle class="ponto" cx="${X(ult.t).toFixed(1)}" cy="${Y(ult.p).toFixed(1)}" r="4"/>
      <g class="cruz" hidden><line class="cx" y1="${T}" y2="${H - B}"/><circle class="cp" r="4"/></g>
      <rect class="alvo" x="${E}" y="${T}" width="${W - E - D}" height="${H - T - B}"/>
    </svg>
    <div class="dica" hidden></div>
    <p class="muted">${detalhe.has(x.slug) ? "De 10 em 10 min" : "De hora em hora (carregando detalhe…)"} · linha tracejada = abertura e início do jogo · <a href="${linkMercado(x)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></p>
  </div>`;
}

// cruz + dica: mapeia o mouse para o ponto mais próximo no tempo
document.addEventListener("pointermove", (e) => {
  const alvo = e.target.closest?.(".graf .alvo");
  document.querySelectorAll(".graf .cruz:not([hidden])").forEach((c) => { if (!alvo || !c.closest(".graf").contains(alvo)) { c.hidden = true; c.closest(".graf").querySelector(".dica").hidden = true; } });
  if (!alvo) return;
  const g = alvo.closest(".graf"), svg = g.querySelector("svg");
  const h = JSON.parse(g.dataset.h), x0 = +g.dataset.x0, x1 = +g.dataset.x1, lo = +g.dataset.lo, hi = +g.dataset.hi;
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const sx = ((e.clientX - r.left) / r.width) * vb.width;
  const E = 40, D = 12, T = 12, B = 26;
  const t = x0 + ((sx - E) / (vb.width - E - D)) * (x1 - x0);
  let k = 0;
  for (let i = 1; i < h.length; i++) if (Math.abs(h[i][0] - t) < Math.abs(h[k][0] - t)) k = i;
  const [pt, pp_] = h[k];
  const cx = E + ((pt - x0) / (x1 - x0)) * (vb.width - E - D), cy = T + (1 - (pp_ - lo) / (hi - lo)) * (vb.height - T - B);
  const cruz = g.querySelector(".cruz");
  cruz.hidden = false;
  cruz.querySelector(".cx").setAttribute("x1", cx); cruz.querySelector(".cx").setAttribute("x2", cx);
  cruz.querySelector(".cp").setAttribute("cx", cx); cruz.querySelector(".cp").setAttribute("cy", cy);
  const dica = g.querySelector(".dica");
  dica.hidden = false;
  dica.innerHTML = `<b>${prob(pp_)}</b> Over (odd ${odd(pp_)})<br><span>${dataHora(pt * 1000)}</span>`;
  const px = (cx / vb.width) * r.width;
  dica.style.left = `${Math.min(Math.max(px, 70), r.width - 70)}px`;
  dica.style.top = `${(cy / vb.height) * r.height}px`;
});

// ---------- render ----------
function quando(inicio) {
  const m = (inicio - Date.now()) / 60e3;
  if (m <= 0) return `<span class="momento vivo">Ao vivo</span>`;
  return m < 60 ? `começa em ${Math.round(m)} min (${hora(inicio)})` : m < 24 * 60 ? `começa às ${hora(inicio)} (em ${Math.round(m / 60)} h)` : `começa ${dataHora(inicio)}`;
}

function linhaMercado(j, x) {
  const mov = movimento(x);
  const agora = x.hist.length ? x.hist[x.hist.length - 1].p : null;
  const aberto = abertos.has(x.slug);
  const forte = mov != null && Math.abs(mov) >= 0.10;
  const dir = mov == null || Math.abs(mov) < 0.005 ? "" : mov > 0 ? "▲ Over" : "▼ Under";
  return `<tr class="mk${aberto ? " aberto" : ""}" data-slug="${esc(x.slug)}" tabindex="0" aria-expanded="${aberto}">
      <td><b>${esc(x.jogador)}</b></td><td>${TIPOS[x.tipo]}</td><td class="n">${linhaTxt(x.linha)}</td>
      <td class="n">${probOdd(x.abertura)}</td><td class="n">${probOdd(agora)}</td>
      <td class="n mov${forte ? " forte" : ""}"><b>${pp(mov)}</b><small>${dir}</small></td>
      <td>${sparkline(x.hist)}</td>
      <td class="n">${usd(x.vol)}${x.vol < 1 ? "<small>sem negócio</small>" : ""}</td>
      <td class="n">${x.spread == null ? "–" : `${Math.round(100 * x.spread)}¢`}</td></tr>
    ${aberto ? `<tr class="det"><td colspan="9">${grafico(x, j.inicio)}</td></tr>` : ""}`;
}

function render() {
  if (erro && !jogos.length) {
    $("#jogos").innerHTML = `<div class="banner"><b>Não consegui ler o Polymarket.</b><span>${esc(erro.message || erro)}</span></div>`;
    return;
  }
  if (carregadoEm) $("#atualizado").textContent = `atualizado ${hora(carregadoEm)} · a cada 5 min`;
  const busca = f.busca.trim().toLowerCase(), min = +f.min;
  const html = jogos.filter((j) => Date.now() < j.inicio + 3.5 * 3600e3).map((j) => {
    const L = j.mercados
      .filter((x) => (!f.tipo || x.tipo === f.tipo) && (!busca || x.jogador.toLowerCase().includes(busca)))
      .map((x) => ({ x, mov: movimento(x) }))
      .filter(({ mov }) => !min || (mov != null && Math.abs(mov) >= min))
      .sort((a, b) => Math.abs(b.mov ?? 0) - Math.abs(a.mov ?? 0));
    if (!L.length && (busca || min)) return "";
    const top = L.filter(({ mov }) => mov != null && Math.abs(mov) >= 0.03).slice(0, 3)
      .map(({ x, mov }) => `<span class="chip${Math.abs(mov) >= 0.10 ? " forte" : ""}">${esc(x.jogador)} · ${TIPOS[x.tipo].toLowerCase()} ${linhaTxt(x.linha)} · ${pp(mov)} ${mov > 0 ? "▲" : "▼"}</span>`).join("");
    return `<section class="panel jogo">
      <div class="jogo-top"><h2>${esc(j.ev.title)}</h2><span class="muted">${quando(j.inicio)}</span></div>
      ${j.macro.length ? `<p class="macro">${j.macro.join(" · ")}</p>` : ""}
      ${top ? `<div class="chips"><span class="muted">Mais movimentadas:</span>${top}</div>` : `<p class="muted">Nenhuma linha andou 3 pp ou mais ${f.desde === "abertura" ? "desde a abertura" : `nas últimas ${f.desde}`}.</p>`}
      ${L.length ? `<div class="tbl-wrap"><table class="props-tab"><thead><tr><th>Jogador</th><th>Estatística</th><th class="n">Linha</th><th class="n">Over na abertura</th><th class="n">Over agora</th><th class="n">Movimento</th><th>Desde a abertura</th><th class="n">Volume</th><th class="n">Spread</th></tr></thead>
        <tbody>${L.map(({ x }) => linhaMercado(j, x)).join("")}</tbody></table></div>` : ""}
    </section>`;
  }).join("");
  $("#jogos").innerHTML = html || (rodando ? "" : `<div class="vazio"><b>Nenhum jogo da NBA com props abertas nas próximas 48 h${busca || min ? " com esses filtros" : ""}.</b></div>`);
}

// abrir/fechar o gráfico de uma linha (clique ou Enter)
async function alternar(tr) {
  const slug = tr.dataset.slug;
  if (abertos.has(slug)) { abertos.delete(slug); render(); return; }
  abertos.add(slug);
  render();
  const x = jogos.flatMap((j) => j.mercados).find((m) => m.slug === slug);
  if (x && !detalhe.has(slug)) {
    const h = (await api.get("clob", `/prices-history?market=${x.tok}&interval=max&fidelity=10`).catch(() => null))?.history || [];
    if (h.length) detalhe.set(slug, serie(h));
    render();
  }
}
$("#jogos").addEventListener("click", (e) => { const tr = e.target.closest("tr.mk"); if (tr && !e.target.closest("a")) alternar(tr); });
$("#jogos").addEventListener("keydown", (e) => { const tr = e.target.closest("tr.mk"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); alternar(tr); } });

carregar();
setInterval(() => { detalhe.clear(); carregar(); }, REFRESCO);
setInterval(render, 60_000); // relógio do "começa em" e jogos encerrados
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (carregadoEm || 0) > REFRESCO) carregar(); });
