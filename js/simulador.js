// Simulador do Painel (padroes.html, aba "Simulador", 18/11/2026, pedido do usuário): o MESMO quadro do Painel,
// congelado num momento de um jogo já encerrado (Q1 6:00, fim do Q1, Q2 6:00, intervalo, Q3 6:00, Q4 6:00). O exercício
// é bater a nossa linha justa: até 3 apostas por quadro (1 u cada desde 18/11, pedido do usuário; ou nenhuma), Over/Under contra a justa daquele
// momento, pagamento 1:1. Depois de salvar: ver o gabarito ou ir ao próximo quadro (sorteado entre os jogos do time
// escolhido). Placar com acertos e erros por estatística, momento, lado, tamanho, time, ritmo e placar.
// Base: data/padroes/sim/ (nba_pbp/simulador_base.py) = análise do dia na ÚLTIMA versão gravada ANTES do início de cada
// jogo (as republicações com o jogo rolando já tinham linha ao vivo). O lance a lance da ESPN é cortado no momento e o
// box é refeito por ele (contarAte bate com o box em 310/312; minutos pelas substituições). Fica neste navegador.
import { esc } from "./formato.js";
import { ESTATS, lerBox, tabelasPainel, painelCongelado, ligarDetalhes } from "./painel.js";
import { contarAte, segundosPorPeriodo, tempoDe } from "./jogada.js";

const MOMENTOS = [
  { k: "q1m", nome: "Q1 · 6:00", t: 360, p: 1 },
  { k: "q1f", nome: "fim do Q1", t: 720, p: 1, fim: true },
  { k: "q2m", nome: "Q2 · 6:00", t: 1080, p: 2 },
  { k: "int", nome: "intervalo", t: 1440, p: 2, fim: true },
  { k: "q3m", nome: "Q3 · 6:00", t: 1800, p: 3 },
  { k: "q4m", nome: "Q4 · 6:00", t: 2520, p: 4 },
];
const MOM = Object.fromEntries(MOMENTOS.map((m) => [m.k, m]));
const STAKES = [1, 1, 1]; // 18/11: as 3 com a mesma unidade (antes 2 / 1,5 / 1)
const CHAVE = "traderpoly.simulador";
const CHAVE_FILTRO = "traderpoly.sim.filtro";
const num = (v, c = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
const u = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), 2)} u`;
const nomeK = (k) => ESTATS.find((e) => e[0] === k)?.[1] ?? k;
const dataBR = (d) => d.split("-").reverse().slice(0, 2).join("/");

const S = { el: null, espn: null, indice: null, dias: new Map(), sums: new Map(), incompleto: new Set(), q: null, slots: [], foco: 0, salvo: false };

// ---------- armazenamento (neste navegador) ----------
function ler() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE) || "{}");
    return { apostas: d.apostas || [], quadros: d.quadros || [], atual: d.atual || null };
  } catch { return { apostas: [], quadros: [], atual: null }; }
}
function gravar(d) {
  try { localStorage.setItem(CHAVE, JSON.stringify(d)); return true; } catch { return false; }
}
function lerFiltro() {
  try { return JSON.parse(localStorage.getItem(CHAVE_FILTRO) || "{}"); } catch { return {}; }
}

// ---------- o jogo congelado ----------
// Summary da ESPN cortado no momento m: lance a lance até ali, status "em andamento", placar do último lance e box
// refeito pelo lance a lance. Inativo no box final (fora DNP por decisão do técnico) continua fora; o resto que ainda
// não jogou aparece como "ainda não entrou" (o técnico não avisa antes).
export function congelar(s, m) {
  const plays = (s.plays || []).filter((x) => {
    const p = x.period?.number ?? 1;
    return p < m.p || (p === m.p && (m.fim || tempoDe(p, x.clock?.displayValue) <= m.t));
  });
  const ult = plays[plays.length - 1];
  const comp0 = s.header.competitions[0];
  const resta = m.fim ? 0 : 720 * m.p - m.t;
  const relog = `${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, "0")}`;
  const status = {
    period: m.p, displayClock: relog, clock: resta,
    type: { state: "in", completed: false, name: m.k === "int" ? "STATUS_HALFTIME" : m.fim ? "STATUS_END_PERIOD" : "STATUS_IN_PROGRESS", shortDetail: m.nome, detail: m.nome },
  };
  const comp = {
    ...comp0, status,
    competitors: comp0.competitors.map((c) => ({ ...c, winner: undefined, score: String((c.homeAway === "home" ? ult?.homeScore : ult?.awayScore) ?? 0), linescores: (c.linescores || []).slice(0, m.fim ? m.p : m.p - 1) })),
  };
  const cont = contarAte(plays, 99);
  const agora = { p: m.p, resta };
  const players = (s.boxscore?.players || []).map((t) => {
    const ath = t.statistics?.[0]?.athletes || [];
    return {
      ...t,
      statistics: [{
        labels: ["MIN", "PTS", "REB", "AST", "3PT", "PF"],
        athletes: ath.map((a) => {
          const id = String(a.athlete.id);
          if (a.didNotPlay && a.reason && !/coach/i.test(a.reason)) return { ...a, stats: [] }; // inativo/lesão: já se sabia
          const x = cont[id] || {};
          const seg = segundosPorPeriodo(plays, id, agora).reduce((s1, v) => s1 + v, 0);
          if (!seg && !x.pts && !x.reb && !x.ast && !x.pf) return { ...a, didNotPlay: false, stats: [] };
          return { ...a, didNotPlay: false, stats: [String(Math.round(seg / 60)), String(x.pts || 0), String(x.reb || 0), String(x.ast || 0), `${x.tpm || 0}-${x.tpa || 0}`, String(x.pf || 0)] };
        }),
      }],
    };
  });
  return { ...s, plays, header: { ...s.header, competitions: [comp] }, boxscore: { ...s.boxscore, players } };
}

async function json(u0) {
  const r = await fetch(u0, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${u0}: ${r.status}`);
  return r.json();
}
async function diaSim(data) {
  if (!S.dias.has(data)) S.dias.set(data, await json(`data/padroes/sim/${data}.json`));
  return S.dias.get(data);
}
async function summary(id) {
  if (!S.sums.has(id)) S.sums.set(id, await S.espn(`/summary?event=${id}`));
  return S.sums.get(id);
}

// ---------- sorteio ----------
function sortear() {
  const f = lerFiltro();
  const D = ler();
  const feitos = new Set(D.quadros.map((x) => `${x.jogo_id}|${x.momento}`));
  const vistos = new Set(D.quadros.map((x) => x.jogo_id));
  const jogos = (S.indice?.jogos || []).filter((j) => (!f.time || j.fora === f.time || j.casa === f.time) && !S.incompleto.has(j.id));
  const moms = f.mom ? MOMENTOS.filter((m) => m.k === f.mom) : MOMENTOS;
  const quadros = jogos.flatMap((j) => moms.map((m) => ({ data: j.data, id: j.id, m: m.k }))).filter((q) => !feitos.has(`${q.id}|${q.m}`));
  const novos = quadros.filter((q) => !vistos.has(q.id));
  const pool = novos.length ? novos : quadros;
  if (!pool.length) return null;
  return { ...pool[Math.floor(Math.random() * pool.length)], repetido: !novos.length };
}

async function novoQuadro() {
  for (let i = 0; i < 6; i++) {
    const q = sortear();
    const area = S.el.querySelector("#sim-quadro");
    if (!q) {
      area.innerHTML = `<p class="muted">Você já jogou todos os quadros deste filtro. Troque o time ou o momento.</p>`;
      return;
    }
    const ok = await abrir(q);
    if (ok) return;
  }
}

// ---------- quadro ----------
async function abrir(q) {
  const area = S.el.querySelector("#sim-quadro");
  area.innerHTML = `<p class="muted">montando o quadro…</p>`;
  let dia, s;
  try {
    [dia, s] = await Promise.all([diaSim(q.data), summary(q.id), tabelasPainel()]);
  } catch (e) {
    area.innerHTML = `<p class="erro">Não consegui carregar o jogo (${esc(e.message)}). Tente sortear de novo.</p>`;
    return true;
  }
  if (!s?.header?.competitions?.[0]?.status?.type?.completed) { S.incompleto.add(q.id); return false; }
  const g = dia.jogos.find((x) => x.id === q.id);
  if (!g) { S.incompleto.add(q.id); return false; }
  const m = MOM[q.m];
  const sc = congelar(s, m);
  const r = painelCongelado(g, sc);
  const comp = s.header.competitions[0];
  S.q = { ...q, g, m, r, ctx: r.ctx, final: lerBox(s), placarFinal: Object.fromEntries(comp.competitors.map((c) => [c.team.abbreviation, c.score])), ot: (comp.status?.period || 4) > 4 };
  S.slots = STAKES.map(() => ({ aid: "", k: "pts", lado: "", palp: "" }));
  S.foco = 0;
  S.salvo = false;
  const D = ler();
  D.atual = { data: q.data, id: q.id, m: q.m, repetido: !!q.repetido };
  gravar(D);
  const hora = g.gerado_em ? new Date(g.gerado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  area.innerHTML = `<div class="sim-cab"><b>🧊 Quadro congelado</b><span>${esc(g.fora)} @ ${esc(g.casa)} · ${dataBR(q.data)} · <b>${esc(m.nome)}</b></span>
      <small class="muted">análise de ${esc(hora)} (antes do início)${q.repetido ? " · todos os jogos deste filtro já apareceram: este é outro momento de um jogo que você já viu" : ""}</small></div>
    <aside class="pn-rail pn-dir">${r.rail || ""}</aside>
    <div class="sim-painel">${r.html}</div>
    <div id="sim-ap" class="panel sim-ap"></div>
    <div id="sim-gab"></div>`;
  ligarDetalhes(area);
  desenharApostas();
  return true;
}

// ---------- apostas ----------
const jogadoresCtx = () => Object.entries(S.q?.ctx?.jogadores || {}).sort((a, b) => a[1].time.localeCompare(b[1].time) || a[1].nome.localeCompare(b[1].nome));
const linhaDe = (e) => (e?.justa == null ? null : Math.round(e.justa * 10) / 10);

function infoSlot(x) {
  if (!x.aid) return `<span class="muted">clique numa célula do quadro ou escolha o jogador</span>`;
  const j = S.q.ctx.jogadores[x.aid], e = j?.est?.[x.k];
  if (linhaDe(e) == null) return `<span style="color:var(--bad)">sem linha justa nesta estatística</span>`;
  return `linha justa <b>${num(linhaDe(e))}</b> · pré ${num(e.pre)} · tem ${e.feito} em ${num(j.min, 0)} min${e.deveria != null ? ` (deveria ${num(e.deveria)})` : ""}`;
}

function desenharApostas(msg = "") {
  const el = S.el.querySelector("#sim-ap");
  if (!el || !S.q) return;
  const trava = S.salvo ? " disabled" : "";
  const ops = jogadoresCtx().map(([aid, j]) => `<option value="${aid}">${esc(j.time)} · ${esc(j.nome)}</option>`).join("");
  const slots = S.slots.map((x, i) => `<div class="sim-slot${i === S.foco && !S.salvo ? " foco" : ""}" data-i="${i}">
      <b class="sim-stake">${num(STAKES[i], STAKES[i] % 1 ? 1 : 0)} u</b>
      <select class="sim-j" aria-label="Jogador"${trava}><option value="">— sem aposta —</option>${ops.replace(`value="${x.aid}"`, `value="${x.aid}" selected`)}</select>
      <select class="sim-k" aria-label="Estatística"${trava}>${ESTATS.map(([k, n]) => `<option value="${k}"${k === x.k ? " selected" : ""}>${n}</option>`).join("")}</select>
      <span class="sim-lado"><button type="button" data-lado="O" aria-pressed="${x.lado === "O"}"${trava}>Over</button><button type="button" data-lado="U" aria-pressed="${x.lado === "U"}"${trava}>Under</button></span>
      <input class="sim-palp" type="text" inputmode="decimal" autocomplete="off" placeholder="seu número (opcional)" value="${esc(x.palp)}"${trava}>
      ${S.salvo ? "" : `<button type="button" class="sim-limpa" title="limpar esta aposta">×</button>`}
      <div class="sim-info">${infoSlot(x)}</div></div>`).join("");
  const nAp = S.slots.filter((x) => x.aid).length;
  const acoes = S.salvo
    ? `<span class="sim-ok">✓ Registrado no placar</span><button type="button" id="sim-ver">Ver gabarito</button><button type="button" id="sim-prox" class="prim">Próximo quadro →</button>`
    : `<button type="button" id="sim-salvar" class="prim">${nAp ? `Salvar ${nAp} aposta${nAp > 1 ? "s" : ""}` : "Não apostar neste quadro"}</button>`;
  el.innerHTML = `<h2 style="margin:0 0 4px">Suas apostas neste quadro</h2>
    <p class="hint" style="margin:0 0 6px">Bata a nossa linha justa: clique numa célula do quadro (ou escolha abaixo), marque Over ou Under. A linha é a justa deste momento; pagamento 1:1. Até 3 apostas de 1 u cada, ou nenhuma. O "seu número" é opcional: serve para medir se a sua estimativa erra menos que a nossa.</p>
    ${slots}<div class="sim-acoes">${acoes}<span class="muted">${esc(msg)}</span></div>`;
}

function salvar() {
  const ap = S.slots.map((x, i) => ({ ...x, stake: STAKES[i] })).filter((x) => x.aid);
  const vistos = new Set();
  for (const x of ap) {
    const e = S.q.ctx.jogadores[x.aid]?.est?.[x.k];
    if (linhaDe(e) == null) return desenharApostas(`${S.q.ctx.jogadores[x.aid]?.nome}: sem linha justa em ${nomeK(x.k)}.`);
    if (!x.lado) return desenharApostas("Marque Over ou Under em cada aposta.");
    const ch = `${x.aid}|${x.k}`;
    if (vistos.has(ch)) return desenharApostas("A mesma aposta aparece duas vezes.");
    vistos.add(ch);
  }
  const { g, m, ctx } = S.q;
  const base = { quando: new Date().toISOString(), data: S.q.data, jogo_id: S.q.id, jogo: `${g.fora} @ ${g.casa}`, momento: m.k };
  const D = ler();
  ap.forEach((x, i) => {
    const j = ctx.jogadores[x.aid], e = j.est[x.k], linha = linhaDe(e);
    const b = S.q.final[x.aid];
    const final = !b || b.dnp ? null : b[x.k];
    const d = final == null ? null : x.lado === "O" ? final - linha : linha - final;
    const res = d == null ? "A" : d > 0 ? "G" : d < 0 ? "P" : "D";
    const palp = x.palp === "" ? null : Number(String(x.palp).replace(",", "."));
    D.apostas.push({
      ...base, id: `${Date.now()}-${i}`, aid: x.aid, nome: j.nome, time: j.time, adv: j.time === g.fora ? g.casa : g.fora,
      k: x.k, lado: x.lado, stake: x.stake, linha, pre: e.pre, feito: e.feito, deveria: e.deveria, min: j.min, margem: j.margem,
      palpite: palp != null && isFinite(palp) ? palp : null, final, res, lucro: res === "G" ? x.stake : res === "P" ? -x.stake : 0,
    });
  });
  D.quadros.push({ ...base, n: ap.length });
  D.atual = null;
  if (!gravar(D)) return desenharApostas("Não consegui gravar neste navegador (armazenamento bloqueado).");
  S.salvo = true;
  desenharApostas();
  desenharPlacar();
}

// ---------- gabarito ----------
function gabarito() {
  const el = S.el.querySelector("#sim-gab");
  const { g, ctx, final, placarFinal } = S.q;
  const minhas = ler().apostas.filter((a) => a.jogo_id === S.q.id && a.momento === S.q.m);
  const resTxt = (a) => (a.res === "G" ? `<span class="sim-g">✓ acertou</span>` : a.res === "P" ? `<span class="sim-p">✗ errou</span>` : a.res === "A" ? `<span class="muted">anulada (não jogou)</span>` : `<span class="muted">empate</span>`);
  const tabMinhas = minhas.length ? `<table class="sim-tab"><thead><tr><th>Aposta</th><th>Linha</th><th>Final</th><th>Resultado</th><th>Lucro</th></tr></thead><tbody>${minhas.map((a) =>
    `<tr><td><b>${esc(a.nome)}</b> ${nomeK(a.k)} ${a.lado === "O" ? "Over" : "Under"} <small class="muted">${num(a.stake, a.stake % 1 ? 1 : 0)} u${a.palpite != null ? ` · seu número ${num(a.palpite)}` : ""}</small></td><td>${num(a.linha)}</td><td><b>${a.final ?? "–"}</b></td><td>${resTxt(a)}</td><td>${u(a.lucro)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Sem aposta neste quadro.</p>`;
  // todos os jogadores: final × justa (verde = terminou acima da justa → Over; vermelho = abaixo → Under)
  const porTime = {};
  for (const [aid, j] of jogadoresCtx()) (porTime[j.time] ||= []).push([aid, j]);
  const linhas = [g.fora, g.casa].map((t) => `<tr class="grupo"><td colspan="${ESTATS.length + 2}"><b>${esc(t)}</b> ${placarFinal[t] ?? ""}</td></tr>${(porTime[t] || []).map(([aid, j]) => {
    const b = final[aid];
    const cel = ESTATS.map(([k]) => {
      const e = j.est[k], f = !b || b.dnp ? null : b[k], L = linhaDe(e);
      if (f == null) return `<td class="muted">–</td>`;
      const d = L == null ? null : f - L;
      const cls = d == null || Math.abs(d) < 0.5 ? "" : d > 0 ? "sim-g" : "sim-p";
      return `<td><b class="${cls}">${f}</b><small>justa ${num(L)} · tinha ${e.feito}</small></td>`;
    }).join("");
    return `<tr><td><b>${esc(j.nome)}</b><small>${b && !b.dnp ? `${b.min} min (tinha ${num(j.min, 0)})` : "não jogou"}</small></td>${cel}</tr>`;
  }).join("")}`).join("");
  el.innerHTML = `<div class="panel sim-gabarito"><h2 style="margin:0 0 6px">Gabarito · final ${esc(g.fora)} ${placarFinal[g.fora]} × ${placarFinal[g.casa]} ${esc(g.casa)}${S.q.ot ? " (prorrogação)" : ""}</h2>
    ${tabMinhas}
    <h3 style="margin:14px 0 4px">Todos os jogadores: final × linha justa de ${esc(S.q.m.nome)}</h3>
    <p class="hint" style="margin:0 0 6px"><span class="sim-g">verde</span> = terminou acima da justa (Over), <span class="sim-p">vermelho</span> = abaixo (Under); diferença menor que 0,5 sem cor.</p>
    <div class="tbl-wrap"><table class="sim-tab sim-tab-gab"><thead><tr><th>Jogador</th>${ESTATS.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table></div>
    <div class="sim-acoes"><button type="button" id="sim-prox2" class="prim">Próximo quadro →</button></div></div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- placar ----------
const ritmoDe = (a) => (a.deveria == null || a.deveria < 0.5 ? "pouca base (começo)" : a.feito / a.deveria >= 1.15 ? "quente (≥ 15% acima)" : a.feito / a.deveria <= 0.85 ? "frio (≥ 15% abaixo)" : "no ritmo");
const placarDe = (a) => { const v = a.margem ?? 0, x = Math.abs(v); return x <= 6 ? "parelho (até 6)" : `${v > 0 ? "ganhando" : "perdendo"} ${x >= 16 ? "16+" : "7–15"}`; };
const justaPre = (a) => { if (a.pre == null) return "sem pré"; const d = a.linha - a.pre; return Math.abs(d) < Math.max(0.5, 0.04 * a.pre) ? "justa ≈ pré" : d > 0 ? "justa acima do pré" : "justa abaixo do pré"; };
const comJusta = (a) => { const j = justaPre(a); return j === "justa acima do pré" ? (a.lado === "O" ? "Over com a justa subindo" : "Under com a justa subindo") : j === "justa abaixo do pré" ? (a.lado === "U" ? "Under com a justa caindo" : "Over com a justa caindo") : null; };
const DIMS = [
  ["Estatística", (a) => nomeK(a.k), ESTATS.map(([, n]) => n)],
  ["Momento", (a) => MOM[a.momento]?.nome, MOMENTOS.map((m) => m.nome)],
  ["Lado", (a) => (a.lado === "O" ? "Over" : "Under"), ["Over", "Under"]],
  ["Ritmo dele no momento", ritmoDe, ["frio (≥ 15% abaixo)", "no ritmo", "quente (≥ 15% acima)", "pouca base (começo)"]],
  ["Placar do time dele", placarDe, ["perdendo 16+", "perdendo 7–15", "parelho (até 6)", "ganhando 7–15", "ganhando 16+"]],
  ["Justa × linha pré", comJusta, null],
  ["Time do jogador", (a) => a.time, null],
];
function agrupar(L, f, ordem) {
  const m = new Map();
  for (const a of L) {
    const k = f(a);
    if (k == null) continue;
    const x = m.get(k) || { n: 0, g: 0, p: 0, uu: 0, lucro: 0 };
    x.n++; if (a.res === "G") x.g++; if (a.res === "P") x.p++;
    x.uu += a.stake; x.lucro += a.lucro;
    m.set(k, x);
  }
  const ks = [...m.keys()];
  ks.sort(ordem ? (a, b) => ordem.indexOf(a) - ordem.indexOf(b) : (a, b) => m.get(b).n - m.get(a).n || String(a).localeCompare(String(b)));
  return ks.map((k) => [k, m.get(k)]);
}
function linhaPlacar(rot, x) {
  const ac = x.g + x.p ? x.g / (x.g + x.p) : null, roi = x.uu ? x.lucro / x.uu : 0;
  const cor = x.lucro > 0 ? "sim-g" : x.lucro < 0 ? "sim-p" : "";
  return `<tr><td>${esc(rot)}</td><td>${x.n}</td><td>${x.g}–${x.p}</td><td>${ac == null ? "–" : `${Math.round(100 * ac)}%`}</td><td class="${cor}">${u(x.lucro)}</td><td class="${cor}">${x.uu ? `${roi > 0 ? "+" : roi < 0 ? "−" : ""}${Math.round(Math.abs(100 * roi))}%` : "–"}</td></tr>`;
}
function desenharPlacar() {
  const el = S.el.querySelector("#sim-placar");
  const D = ler();
  const L = D.apostas.filter((a) => a.res !== "A");
  if (!D.quadros.length) { el.innerHTML = `<div class="panel"><h2 style="margin:0">Placar do simulador</h2><p class="muted">Nenhum quadro jogado ainda.</p></div>`; return; }
  const tot = agrupar(L, () => "total")[0]?.[1] || { n: 0, g: 0, p: 0, uu: 0, lucro: 0 };
  const sem = D.quadros.filter((q) => !q.n).length;
  const cp = L.filter((a) => a.palpite != null && a.final != null);
  const palpH = cp.length ? (() => {
    const eu = cp.reduce((s1, a) => s1 + Math.abs(a.palpite - a.final), 0) / cp.length;
    const nos = cp.reduce((s1, a) => s1 + Math.abs(a.linha - a.final), 0) / cp.length;
    const perto = cp.filter((a) => Math.abs(a.palpite - a.final) < Math.abs(a.linha - a.final)).length;
    return `<div><small class="muted">seu número × nossa justa (${cp.length})</small><b>${num(eu, 2)} × ${num(nos, 2)}</b><small class="muted">erro médio · mais perto em ${perto}/${cp.length}</small></div>`;
  })() : "";
  const ac = tot.g + tot.p ? Math.round((100 * tot.g) / (tot.g + tot.p)) : null;
  const tabs = DIMS.map(([tit, f, ordem]) => {
    const rows = agrupar(L, f, ordem);
    return rows.length ? `<div><h3 class="sim-h3">${tit}</h3><table class="sim-tab"><thead><tr><th></th><th>Ap.</th><th>G–P</th><th>Acerto</th><th>Lucro</th><th>ROI</th></tr></thead><tbody>${rows.map(([k, x]) => linhaPlacar(k, x)).join("")}</tbody></table></div>` : "";
  }).join("");
  const ult = D.apostas.slice(-15).reverse().map((a) => `<tr><td><small class="muted">${dataBR(a.data)} · ${esc(a.jogo)} · ${esc(MOM[a.momento]?.nome || "")}</small><br><b>${esc(a.nome)}</b> ${nomeK(a.k)} ${a.lado === "O" ? "Over" : "Under"} ${num(a.linha)} <small class="muted">${num(a.stake, a.stake % 1 ? 1 : 0)} u · tinha ${a.feito}</small></td><td><b>${a.final ?? "–"}</b></td><td>${a.res === "G" ? `<span class="sim-g">✓</span>` : a.res === "P" ? `<span class="sim-p">✗</span>` : `<span class="muted">${a.res === "A" ? "anulada" : "empate"}</span>`}</td><td>${u(a.lucro)}</td></tr>`).join("");
  el.innerHTML = `<div class="panel"><h2 style="margin:0 0 6px">Placar do simulador</h2>
    <div class="sim-resumo">
      <div><small class="muted">quadros</small><b>${D.quadros.length}</b><small class="muted">${sem} sem aposta</small></div>
      <div><small class="muted">apostas</small><b>${tot.n}</b><small class="muted">${tot.g} acertos · ${tot.p} erros</small></div>
      <div><small class="muted">acerto</small><b>${ac == null ? "–" : `${ac}%`}</b><small class="muted">contra a linha justa (1:1)</small></div>
      <div><small class="muted">resultado</small><b class="${tot.lucro > 0 ? "sim-g" : tot.lucro < 0 ? "sim-p" : ""}">${u(tot.lucro)}</b><small class="muted">ROI ${tot.uu ? `${tot.lucro < 0 ? "−" : tot.lucro > 0 ? "+" : ""}${Math.abs(Math.round((100 * tot.lucro) / tot.uu))}%` : "–"} em ${num(tot.uu, 1)} u</small></div>
      ${palpH}
    </div>
    <div class="sim-grade">${tabs}</div>
    <h3 class="sim-h3">Últimas apostas</h3>
    <div class="tbl-wrap"><table class="sim-tab"><thead><tr><th>Aposta</th><th>Final</th><th></th><th>Lucro</th></tr></thead><tbody>${ult}</tbody></table></div>
    <div class="sim-acoes"><button type="button" id="sim-baixar">Baixar (JSON)</button><button type="button" id="sim-apagar">Apagar o placar</button>
    <small class="muted">Fica neste navegador. "Baixar" para levar a outro aparelho ou me mandar para analisar.</small></div></div>`;
}

// ---------- tela ----------
function topoHtml() {
  const f = lerFiltro();
  const cont = {};
  for (const j of S.indice?.jogos || []) for (const t of [j.fora, j.casa]) cont[t] = (cont[t] || 0) + 1;
  const times = Object.keys(cont).sort();
  const n = (S.indice?.jogos || []).length;
  return `<div class="sim-topo">
    <label>Time<select id="sim-time"><option value="">Todos (${n} jogos)</option>${times.map((t) => `<option value="${t}"${t === f.time ? " selected" : ""}>${t} (${cont[t]} jogos)</option>`).join("")}</select></label>
    <label>Momento<select id="sim-mom"><option value="">Qualquer</option>${MOMENTOS.map((m) => `<option value="${m.k}"${m.k === f.mom ? " selected" : ""}>${m.nome}</option>`).join("")}</select></label>
    <button type="button" id="sim-sortear" class="prim">Sortear quadro</button>
    <small class="muted">Jogos encerrados de ${S.indice?.jogos?.length ? `${dataBR(S.indice.jogos[0].data)} a ${dataBR(S.indice.jogos[n - 1].data)}` : "–"}, com a análise do dia de antes do início. O quadro é o Painel congelado no momento sorteado.</small></div>`;
}

function ligar() {
  const el = S.el;
  el.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "sim-time" || t.id === "sim-mom") {
      const f = lerFiltro();
      f[t.id === "sim-time" ? "time" : "mom"] = t.value;
      try { localStorage.setItem(CHAVE_FILTRO, JSON.stringify(f)); } catch { /* sem armazenamento */ }
      return;
    }
    const sl = t.closest(".sim-slot");
    if (!sl || S.salvo) return;
    const x = S.slots[Number(sl.dataset.i)];
    if (t.classList.contains("sim-j")) x.aid = t.value;
    if (t.classList.contains("sim-k")) x.k = t.value;
    S.foco = Number(sl.dataset.i);
    desenharApostas();
  });
  el.addEventListener("input", (ev) => {
    const sl = ev.target.closest(".sim-slot");
    if (sl && ev.target.classList.contains("sim-palp")) S.slots[Number(sl.dataset.i)].palp = ev.target.value;
  });
  el.addEventListener("click", (ev) => {
    const t = ev.target;
    const b = t.closest("button");
    if (b?.id === "sim-sortear") {
      const D = ler();
      if (S.q && !S.salvo && D.atual && !confirm("Trocar de quadro sem salvar? Este quadro conta como pulado (não volta no sorteio).")) return;
      if (S.q && !S.salvo) { D.quadros.push({ quando: new Date().toISOString(), data: S.q.data, jogo_id: S.q.id, jogo: `${S.q.g.fora} @ ${S.q.g.casa}`, momento: S.q.m.k, n: 0, pulado: true }); D.atual = null; gravar(D); desenharPlacar(); }
      return novoQuadro();
    }
    if (b?.id === "sim-prox" || b?.id === "sim-prox2") return novoQuadro();
    if (b?.id === "sim-ver") return gabarito();
    if (b?.id === "sim-salvar") return salvar();
    if (b?.id === "sim-baixar") {
      const blob = new Blob([JSON.stringify(ler(), null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `simulador_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
      return;
    }
    if (b?.id === "sim-apagar") {
      if (!confirm("Apagar todo o placar do simulador neste navegador? (baixe antes se quiser guardar)")) return;
      gravar({ apostas: [], quadros: [], atual: null });
      return desenharPlacar();
    }
    const sl = t.closest(".sim-slot");
    if (sl && !S.salvo) {
      const i = Number(sl.dataset.i);
      S.foco = i;
      if (b?.dataset.lado) S.slots[i].lado = S.slots[i].lado === b.dataset.lado ? "" : b.dataset.lado;
      if (b?.classList.contains("sim-limpa")) S.slots[i] = { aid: "", k: "pts", lado: "", palp: "" };
      if (b || !t.closest("select, input")) desenharApostas();
      return;
    }
    // clique numa célula do quadro → próxima aposta livre (ou a que está em foco)
    const td = t.closest(".sim-painel td[data-aid]");
    if (td && S.q && !S.salvo && S.q.ctx.jogadores[td.dataset.aid]) {
      let i = S.slots[S.foco]?.aid ? S.slots.findIndex((x) => !x.aid) : S.foco;
      if (i < 0) i = S.foco;
      S.slots[i] = { ...S.slots[i], aid: td.dataset.aid, k: td.dataset.k };
      S.foco = S.slots.findIndex((x) => !x.aid);
      if (S.foco < 0) S.foco = i;
      desenharApostas();
      S.el.querySelector("#sim-ap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

export async function mostrarSimulador(el, espn) {
  if (S.el === el) return; // já montado: o quadro fica como está
  S.el = el;
  S.espn = espn;
  el.innerHTML = `<p class="muted">carregando a base do simulador…</p>`;
  try {
    S.indice = await json("data/padroes/sim/indice.json");
  } catch (e) {
    el.innerHTML = `<p class="erro">Base do simulador indisponível (${esc(e.message)}).</p>`;
    S.el = null;
    return;
  }
  el.innerHTML = `${topoHtml()}<div id="sim-quadro"><p class="muted">Escolha o time (ou todos) e o momento e clique em <b>Sortear quadro</b>.</p></div><div id="sim-placar"></div>`;
  ligar();
  desenharPlacar();
  const at = ler().atual; // quadro aberto e não salvo (recarregou a página): volta para ele
  if (at && MOM[at.m]) await abrir({ data: at.data, id: at.id, m: at.m, repetido: at.repetido });
}
