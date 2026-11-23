// Aba "Calibração" (23/11/2026, pedido do usuário): minuto a minuto, o final de cada jogador contra a linha justa ao vivo
// do site naquele momento — quem ganhou, Over ou Under — com filtros (estatística, time ou adversário, posição, papel,
// linha DK, quadra/banco e placar no momento, período, jogador) e a lista de jogadores para tirar/pôr na conta.
// Dados: data/padroes/calibracao/ (nba_pbp/calibracao_site.py → scripts/calibracao_dados.mjs; base viva, temporada atual).
// "Esperado" = chance de Over que o próprio modelo do site dá na justa (a justa é média; contagem assimétrica → < 50%).
import { esc } from "./formato.js";

const BASE = "data/padroes/calibracao/";
const KN = { pts: "Pontos", reb: "Rebotes", ast: "Assistências", tpm: "Cestas de 3", pra: "PRA" };
const POSN = { G: "Armadores", F: "Alas", C: "Pivôs" };
const LS_F = "traderpoly.calib.filtros";
const LS_X = "traderpoly.calib.excluidos";
const JANELAS = { todo: [0, 48], q1: [0, 12], q2: [12, 24], q3: [24, 36], q4: [36, 48] };

let M = null;            // meta
const DADOS = {};        // estatística → {d, p}
let F = null;            // filtros
let EXC = new Set();     // jogadores fora da conta
let EL = null;
let HOVER = null;        // momento sob o cursor
let ULT = null;          // última agregação (para o hover)

const ler = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: segue */ } };
const pct = (x) => (x == null || !isFinite(x) ? "–" : `${(100 * x).toFixed(0)}%`);
const sn = (x, c = 2) => (x == null || !isFinite(x) ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(c).replace(".", ",")}`);
const minTxt = (s) => { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}:${String(r).padStart(2, "0")}` : `${m}`; };

async function json(arq) {
  const r = await fetch(BASE + arq, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${arq}: HTTP ${r.status}`);
  return r.json();
}

export async function mostrarCalibracao(el) {
  EL = el;
  if (!M) {
    el.innerHTML = `<p class="muted">carregando a calibração da temporada…</p>`;
    try { M = await json("meta.json"); } catch (e) { el.innerHTML = `<p class="erro">Não consegui ler os dados da calibração (${esc(e.message)}).</p>`; return; }
    F = { k: "pts", time: "", lado: "do", pos: "", papel: "", linha: "dk", quadra: "", placar: "", periodo: "", aid: "", janela: "todo", todos: false, ...ler(LS_F, {}) };
    EXC = new Set(ler(LS_X, []));
    addEventListener("resize", () => { if (EL && !EL.hidden && ULT) desenharGraficos(); });
  }
  if (!DADOS[F.k]) {
    try { DADOS[F.k] = await json(`${F.k}.json`); } catch (e) { el.innerHTML = `<p class="erro">Não consegui ler ${esc(F.k)} (${esc(e.message)}).</p>`; return; }
  }
  montar();
}

function opcoes(lista, atual) {
  return lista.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(atual) ? " selected" : ""}>${esc(t)}</option>`).join("");
}

function montar() {
  const times = [...new Set(M.jog.map((j) => j[3]))].sort();
  const dias = M.jog.map((j) => j[1]);
  const ini = dias[0], fim = dias[dias.length - 1];
  const nomeJog = F.aid ? M.nomes[F.aid] || F.aid : "";
  EL.innerHTML = `
  <div class="cal-intro muted">
    <p>Para cada jogador e cada momento do jogo (0:30, 1, 2, 3 min… até 46), o final dele comparado com a <b>linha justa do site naquele momento</b>: acima = <span class="cal-over">Over ganhou</span>, abaixo = <span class="cal-under">Under ganhou</span>. Temporada 2026-27, jogos de ${esc(ini.split("-").reverse().join("/"))} a ${esc(fim.split("-").reverse().join("/"))}, com o motor de hoje (essas partidas também entraram nas calibrações: é o retrato dentro da amostra).</p>
    <p>A justa é uma <b>média</b>. Como pontos, rebotes e assistências são contagens assimétricas, mesmo calibrada ela fica um pouco acima do valor "do meio": o Over na justa sai abaixo de 50%, cada vez mais perto do fim. A linha tracejada é o Over que o nosso modelo de chance espera; <b>calibrado = verde em cima do tracejado</b> e viés perto de zero.</p>
  </div>
  <div class="sim-topo cal-filtros">
    <label>Estatística<select data-f="k">${opcoes(Object.entries(KN), F.k)}</select></label>
    <label>Time<select data-f="time"><option value="">Todos</option>${opcoes(times.map((t) => [t, t]), F.time)}</select></label>
    <label>Jogadores<select data-f="lado"${F.time ? "" : " disabled"}>${opcoes([["do", "do time"], ["contra", "contra o time"]], F.lado)}</select></label>
    <label>Posição<select data-f="pos"><option value="">Todas</option>${opcoes(Object.entries(POSN), F.pos)}</select></label>
    <label>Papel<select data-f="papel">${opcoes([["", "Todos"], ["1", "Titulares"], ["0", "Reservas"]], F.papel)}</select></label>
    <label>Linha pré-jogo<select data-f="linha">${opcoes([["dk", "Com linha DK"], ["sem", "Sem linha DK"], ["", "Todos"]], F.linha)}</select></label>
    <label>No momento<select data-f="quadra">${opcoes([["", "Quadra ou banco"], ["1", "Em quadra"], ["0", "No banco"]], F.quadra)}</select></label>
    <label>Placar do time<select data-f="placar">${opcoes([["", "Qualquer"], ["0", "Parelho (até 6)"], ["1", "7 a 14"], ["2", "15 ou mais"]], F.placar)}</select></label>
    <label>Período<select data-f="periodo">${opcoes([["", "Temporada toda"], ["14", "Últimos 14 dias"], ["7", "Últimos 7 dias"]], F.periodo)}</select></label>
    <label>Jogador<input data-f="busca" list="cal-nomes" placeholder="nome…" value="${esc(nomeJog)}" autocomplete="off"></label>
    <datalist id="cal-nomes">${[...new Set(M.jog.map((j) => j[2]))].map((a) => `<option value="${esc(M.nomes[a] || a)}">`).join("")}</datalist>
    ${F.aid ? `<button type="button" class="cal-limpa" data-acao="sem-jogador">× tirar o filtro de jogador</button>` : ""}
    ${EXC.size ? `<button type="button" class="cal-limpa" data-acao="sem-exc">devolver os ${EXC.size} tirados</button>` : ""}
  </div>
  ${F.linha !== "dk" ? `<p class="muted cal-aviso">Sem linha DK: aqui a justa parte da média recente dele (o site usa a projeção do Edgely), então é só uma aproximação.</p>` : ""}
  <div id="cal-resumo" class="cal-resumo"></div>
  <div class="cal-graf" id="cal-g1"></div>
  <div class="cal-graf" id="cal-g2"></div>
  <details class="cal-det" data-k="tab"><summary>Tabela por momento</summary><div id="cal-tab"></div></details>
  <h3 class="cal-h3">Jogadores no filtro</h3>
  <div class="sim-topo cal-filtros">
    <label>Trecho do jogo<select data-f="janela">${opcoes([["todo", "Jogo todo"], ["q1", "Q1"], ["q2", "Q2"], ["q3", "Q3"], ["q4", "Q4"]], F.janela)}</select></label>
    <small class="muted">Desmarque um jogador para tirá-lo da conta (vale para os gráficos também). Clique no nome para ver só ele.</small>
  </div>
  <div id="cal-jog"></div>`;
  for (const s of EL.querySelectorAll("select[data-f]")) s.onchange = () => mudar(s.dataset.f, s.value);
  const busca = EL.querySelector("input[data-f=busca]");
  busca.onchange = () => {
    const v = busca.value.trim().toLowerCase();
    const a = Object.keys(M.nomes).find((x) => (M.nomes[x] || "").toLowerCase() === v);
    mudar("aid", a || "");
  };
  for (const b of EL.querySelectorAll("button[data-acao]")) b.onclick = () => {
    if (b.dataset.acao === "sem-jogador") mudar("aid", "");
    if (b.dataset.acao === "sem-exc") { EXC.clear(); gravar(LS_X, []); montar(); }
  };
  calcular();
}

function mudar(campo, valor) {
  F[campo] = valor;
  gravar(LS_F, F);
  if (campo === "k" && !DADOS[valor]) { mostrarCalibracao(EL); return; }
  montar();
}

// ---------- agregação ----------
function calcular() {
  const NM = M.grade.length, ki = M.ks.indexOf(F.k), D = DADOS[F.k];
  const fimDia = M.jog[M.jog.length - 1][1];
  let corte = "";
  if (F.periodo) { const d = new Date(fimDia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - Number(F.periodo) + 1); corte = d.toISOString().slice(0, 10); }
  const okJ = (j) => {
    if (F.time && (F.lado === "contra" ? j[4] : j[3]) !== F.time) return false;
    if (F.pos && j[5] !== F.pos) return false;
    if (F.papel !== "" && String(j[7]) !== F.papel) return false;
    const temLinha = (j[8] >> ki) & 1;
    if (F.linha === "dk" && !temLinha) return false;
    if (F.linha === "sem" && temLinha) return false;
    if (corte && j[1] < corte) return false;
    return true;
  };
  const mom = M.grade.map(() => ({ n: 0, o: 0, pe: 0, sd: 0, g: new Map() }));
  const jog = new Map();
  const [ja, jb] = JANELAS[F.janela] || JANELAS.todo;
  const jogosF = new Set(), pessoas = new Set();
  M.jog.forEach((j, i) => {
    if (!okJ(j)) return;
    const aid = j[2];
    const fora = EXC.has(aid);
    const so = F.aid && aid !== F.aid;
    let pj = null;
    for (let m = 0; m < NM; m++) {
      const x = D.d[i * NM + m];
      if (x == null) continue;
      const e = M.est_m[i * NM + m];
      if (F.quadra !== "" && String(e & 1) !== F.quadra) continue;
      if (F.placar !== "" && String(e >> 1) !== F.placar) continue;
      const o = x > 0 ? 1 : 0, p = D.p[i * NM + m] / 1000, d = x / 10;
      const minuto = M.grade[m] / 60;
      if (!so && minuto >= ja && minuto < jb) {   // lista de jogadores: todos do filtro (incluindo os tirados)
        pj ||= jog.get(aid) || { n: 0, o: 0, pe: 0, sd: 0, g: new Set(), tm: j[3], pos: j[5] };
        pj.n++; pj.o += o; pj.pe += p; pj.sd += d; pj.g.add(j[0]);
      }
      if (fora || so) continue;
      const c = mom[m];
      c.n++; c.o += o; c.pe += p; c.sd += d;
      const gg = c.g.get(j[0]) || [0, 0, 0];
      gg[0]++; gg[1] += o; gg[2] += d; c.g.set(j[0], gg);
      jogosF.add(j[0]); pessoas.add(aid);
    }
    if (pj) jog.set(aid, pj);
  });
  for (const c of mom) {
    if (!c.n) continue;
    c.over = c.o / c.n; c.esp = c.pe / c.n; c.vies = c.sd / c.n;
    let so = 0, sd = 0;
    for (const [n, o, d] of c.g.values()) { so += (o - n * c.over) ** 2; sd += (d - n * c.vies) ** 2; }
    c.epO = Math.sqrt(so) / c.n; c.epV = Math.sqrt(sd) / c.n; c.jogos = c.g.size;
  }
  ULT = { mom, jog, jogos: jogosF.size, pessoas: pessoas.size };
  resumo();
  desenharGraficos();
  tabela();
  jogadores();
}

// ---------- textos ----------
function leitura(c) {
  if (!c?.n) return "sem dados";
  const dif = c.over - c.esp;
  const forte = Math.abs(dif) >= 2 * c.epO && Math.abs(dif) >= 0.02;
  const lado = dif > 0 ? `<span class="cal-over">Over ganhando</span>` : `<span class="cal-under">Under ganhando</span>`;
  return `Over ${pct(c.over)} × ${pct(c.esp)} esperado (${sn(100 * dif, 0)} pp${forte ? `, ${lado} além do esperado` : ", dentro do acaso"}) · viés ${sn(c.vies)} ${F.k === "pra" ? "PRA" : KN[F.k].toLowerCase()} (± ${(1.96 * c.epV).toFixed(2).replace(".", ",")}) · ${c.n} jogadores-jogo em ${c.jogos} jogos`;
}

function resumo() {
  const el = EL.querySelector("#cal-resumo");
  const m = HOVER ?? null;
  const filtro = [KN[F.k], F.time ? `${F.lado === "contra" ? "contra o " : ""}${F.time}` : "todos os times", F.pos ? POSN[F.pos] : "", F.papel === "1" ? "titulares" : F.papel === "0" ? "reservas" : "",
    F.linha === "dk" ? "com linha DK" : F.linha === "sem" ? "sem linha DK" : "", F.quadra === "1" ? "em quadra" : F.quadra === "0" ? "no banco" : "",
    F.placar === "0" ? "placar parelho" : F.placar === "1" ? "placar 7–14" : F.placar === "2" ? "placar 15+" : "", F.aid ? M.nomes[F.aid] : ""].filter(Boolean).join(" · ");
  if (!ULT.pessoas) { el.innerHTML = `<p class="muted">${esc(filtro)}: nenhum jogador-jogo nesse filtro.</p>`; return; }
  el.innerHTML = `<p><b>${esc(filtro)}</b> — ${ULT.pessoas} jogadores, ${ULT.jogos} jogos${EXC.size ? ` (${EXC.size} tirados da conta)` : ""}.</p>
    <p class="cal-ler">${m != null ? `<b>${minTxt(M.grade[m])} min</b>: ${leitura(ULT.mom[m])}` : `Passe o mouse (ou toque) no gráfico para ler cada momento.`}</p>`;
}

// ---------- gráficos (SVG à mão; cores do tema) ----------
function escalas(W, H, ymin, ymax) {
  const pad = { l: 44, r: 14, t: 14, b: 26 };
  const x = (min) => pad.l + ((W - pad.l - pad.r) * min) / 48;
  const y = (v) => pad.t + ((H - pad.t - pad.b) * (ymax - v)) / (ymax - ymin);
  return { pad, x, y };
}

function eixoX(W, H, s) {
  let g = "";
  for (const q of [12, 24, 36]) g += `<line x1="${s.x(q)}" x2="${s.x(q)}" y1="${s.pad.t}" y2="${H - s.pad.b}" class="cal-q"/>`;
  for (const [q, t] of [[6, "Q1"], [18, "Q2"], [30, "Q3"], [42, "Q4"]]) g += `<text x="${s.x(q)}" y="${H - 8}" text-anchor="middle" class="cal-tx">${t}</text>`;
  for (const v of [0, 12, 24, 36, 48]) g += `<text x="${s.x(v)}" y="${H - 8}" text-anchor="middle" class="cal-tx cal-tx3">${v}</text>`;
  return g;
}

function caminho(pts) {
  let d = "", ant = false;
  for (const p of pts) { if (p == null) { ant = false; continue; } d += `${ant ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; ant = true; }
  return d;
}

function faixa(sup, inf) {
  const a = sup.filter(Boolean), b = inf.filter(Boolean).reverse();
  if (a.length < 2) return "";
  return `M${a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}L${b.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`;
}

function desenharGraficos() {
  const mom = ULT.mom, NM = M.grade.length;
  const W = Math.max(320, Math.min(EL.clientWidth || 720, 980)), H = 230;
  const mins = M.grade.map((t) => t / 60);
  // 1) Over real × esperado (%)
  const ok = mom.map((c) => c.n >= 5);
  const vals = mom.flatMap((c, m) => (ok[m] ? [c.over - 1.96 * c.epO, c.over + 1.96 * c.epO, c.esp] : []));
  let y0 = Math.min(0.3, ...vals), y1 = Math.max(0.6, ...vals);
  y0 = Math.max(0, Math.floor(y0 * 10) / 10); y1 = Math.min(1, Math.ceil(y1 * 10) / 10);
  const s1 = escalas(W, H, y0, y1);
  let grid1 = "";
  for (let v = y0; v <= y1 + 1e-9; v += 0.1) grid1 += `<line x1="${s1.pad.l}" x2="${W - s1.pad.r}" y1="${s1.y(v)}" y2="${s1.y(v)}" class="${Math.abs(v - 0.5) < 1e-9 ? "cal-ref" : "cal-grid"}"/><text x="${s1.pad.l - 6}" y="${s1.y(v) + 4}" text-anchor="end" class="cal-tx cal-tx3">${Math.round(v * 100)}%</text>`;
  const pR = mom.map((c, m) => (ok[m] ? [s1.x(mins[m]), s1.y(c.over)] : null));
  const pE = mom.map((c, m) => (ok[m] ? [s1.x(mins[m]), s1.y(c.esp)] : null));
  const bS = mom.map((c, m) => (ok[m] ? [s1.x(mins[m]), s1.y(Math.min(1, c.over + 1.96 * c.epO))] : null));
  const bI = mom.map((c, m) => (ok[m] ? [s1.x(mins[m]), s1.y(Math.max(0, c.over - 1.96 * c.epO))] : null));
  const ult = (() => { for (let m = NM - 1; m >= 0; m--) if (ok[m]) return m; return -1; })();
  const rot1 = ult >= 0 ? `<text x="${W - s1.pad.r - 2}" y="${Math.min(pR[ult][1], pE[ult][1]) - 8}" text-anchor="end" class="cal-tx">Over real</text>` : "";
  const g1 = `<div class="cal-leg"><span><i class="cal-sw cal-sw-r"></i>Over real (com faixa de 95%)</span><span><i class="cal-sw cal-sw-e"></i>Over esperado pelo modelo</span><span class="muted">acima do tracejado = justa baixa (Over ganhou); abaixo = justa alta (Under ganhou)</span></div>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Over real e esperado na linha justa, por minuto">
    ${grid1}${eixoX(W, H, s1)}
    <path d="${faixa(bS, bI)}" class="cal-band-r"/>
    <path d="${caminho(pE)}" class="cal-esp"/>
    <path d="${caminho(pR)}" class="cal-real"/>
    ${pR.map((p) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" class="cal-pt"/>` : "")).join("")}
    ${rot1}
    <line class="cal-cruz" x1="-10" x2="-10" y1="${s1.pad.t}" y2="${H - s1.pad.b}"/>
    <rect class="cal-hit" x="${s1.pad.l}" y="0" width="${W - s1.pad.l - s1.pad.r}" height="${H}"/>
  </svg>`;
  // 2) viés médio (final − justa), em unidades
  const vv = mom.flatMap((c, m) => (ok[m] ? [c.vies - 1.96 * c.epV, c.vies + 1.96 * c.epV] : [0]));
  let v0 = Math.min(-0.5, ...vv), v1 = Math.max(0.5, ...vv);
  const passo = (v1 - v0) > 6 ? 2 : (v1 - v0) > 3 ? 1 : 0.5;
  v0 = Math.floor(v0 / passo) * passo; v1 = Math.ceil(v1 / passo) * passo;
  const s2 = escalas(W, H, v0, v1);
  let grid2 = "";
  for (let v = v0; v <= v1 + 1e-9; v += passo) grid2 += `<line x1="${s2.pad.l}" x2="${W - s2.pad.r}" y1="${s2.y(v)}" y2="${s2.y(v)}" class="${Math.abs(v) < 1e-9 ? "cal-ref" : "cal-grid"}"/><text x="${s2.pad.l - 6}" y="${s2.y(v) + 4}" text-anchor="end" class="cal-tx cal-tx3">${sn(v, passo < 1 ? 1 : 0)}</text>`;
  const pV = mom.map((c, m) => (ok[m] ? [s2.x(mins[m]), s2.y(c.vies)] : null));
  const vS = mom.map((c, m) => (ok[m] ? [s2.x(mins[m]), s2.y(c.vies + 1.96 * c.epV)] : null));
  const vI = mom.map((c, m) => (ok[m] ? [s2.x(mins[m]), s2.y(c.vies - 1.96 * c.epV)] : null));
  const g2 = `<div class="cal-leg"><span><i class="cal-sw cal-sw-v"></i>Viés médio: final − justa (${esc(KN[F.k].toLowerCase())}), com faixa de 95%</span><span class="muted">acima de 0 = terminou acima da justa; abaixo = terminou abaixo</span></div>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Viés médio da linha justa por minuto">
    <rect x="${s2.pad.l}" y="${s2.pad.t}" width="${W - s2.pad.l - s2.pad.r}" height="${Math.max(0, s2.y(0) - s2.pad.t)}" class="cal-zona-o"/>
    <rect x="${s2.pad.l}" y="${s2.y(0)}" width="${W - s2.pad.l - s2.pad.r}" height="${Math.max(0, H - s2.pad.b - s2.y(0))}" class="cal-zona-u"/>
    ${grid2}${eixoX(W, H, s2)}
    <text x="${W - s2.pad.r - 4}" y="${s2.pad.t + 12}" text-anchor="end" class="cal-tx cal-tx3">▲ Over (justa baixa)</text>
    <text x="${W - s2.pad.r - 4}" y="${H - s2.pad.b - 6}" text-anchor="end" class="cal-tx cal-tx3">▼ Under (justa alta)</text>
    <path d="${faixa(vS, vI)}" class="cal-band-v"/>
    <path d="${caminho(pV)}" class="cal-vies"/>
    ${pV.map((p) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" class="cal-pt-v"/>` : "")).join("")}
    <line class="cal-cruz" x1="-10" x2="-10" y1="${s2.pad.t}" y2="${H - s2.pad.b}"/>
    <rect class="cal-hit" x="${s2.pad.l}" y="0" width="${W - s2.pad.l - s2.pad.r}" height="${H}"/>
  </svg>`;
  EL.querySelector("#cal-g1").innerHTML = `<h3 class="cal-h3">Over × Under contra a linha justa, minuto a minuto</h3>${g1}`;
  EL.querySelector("#cal-g2").innerHTML = `<h3 class="cal-h3">Quanto a justa errou, em média</h3>${g2}`;
  const xs = mins.map((m) => s1.x(m));
  for (const svg of EL.querySelectorAll(".cal-graf svg")) {
    const hit = svg.querySelector(".cal-hit");
    const mover = (ev) => {
      const r = svg.getBoundingClientRect();
      const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      let best = 0;
      xs.forEach((x, m) => { if (ok[m] && Math.abs(x - cx) < Math.abs(xs[best] - cx)) best = m; });
      marcar(best, xs[best]);
    };
    hit.addEventListener("mousemove", mover);
    hit.addEventListener("touchstart", mover, { passive: true });
    hit.addEventListener("touchmove", mover, { passive: true });
  }
  if (HOVER != null && ok[HOVER]) marcar(HOVER, xs[HOVER]);
}

function marcar(m, x) {
  HOVER = m;
  for (const l of EL.querySelectorAll(".cal-cruz")) { l.setAttribute("x1", x); l.setAttribute("x2", x); }
  resumo();
}

function tabela() {
  const linhas = ULT.mom.map((c, m) => {
    if (!c.n) return "";
    const dif = c.over - c.esp;
    const forte = Math.abs(dif) >= 2 * c.epO && Math.abs(dif) >= 0.02;
    return `<tr><td>${minTxt(M.grade[m])}</td><td class="num">${c.n}</td><td class="num">${c.jogos}</td><td class="num">${pct(c.over)}</td><td class="num">${pct(c.esp)}</td>
      <td class="num ${forte ? (dif > 0 ? "cal-over" : "cal-under") : ""}">${sn(100 * dif, 0)} pp</td><td class="num">${sn(c.vies)}</td><td class="num muted">± ${(1.96 * c.epV).toFixed(2).replace(".", ",")}</td></tr>`;
  }).join("");
  EL.querySelector("#cal-tab").innerHTML = `<table class="sim-tab cal-t"><thead><tr><th>Minuto</th><th class="num">Jogadores-jogo</th><th class="num">Jogos</th><th class="num">Over real</th><th class="num">Esperado</th><th class="num">Diferença</th><th class="num">Viés</th><th class="num">IC 95%</th></tr></thead><tbody>${linhas}</tbody></table>
  <p class="muted">Diferença colorida = além de 2 erros-padrão (por jogo) e de 2 pp. Viés = final − justa, na unidade da estatística.</p>`;
}

function jogadores() {
  const el = EL.querySelector("#cal-jog");
  const lista = [...ULT.jog.entries()].map(([aid, c]) => ({ aid, ...c, over: c.o / c.n, esp: c.pe / c.n, vies: c.sd / c.n, jogos: c.g.size }));
  if (!lista.length) { el.innerHTML = `<p class="muted">Nenhum jogador nesse filtro.</p>`; return; }
  lista.sort((a, b) => Math.abs(b.vies) * Math.sqrt(b.jogos) - Math.abs(a.vies) * Math.sqrt(a.jogos));
  const mostrar = F.todos ? lista : lista.slice(0, 40);
  el.innerHTML = `<table class="sim-tab cal-t"><thead><tr><th></th><th>Jogador</th><th class="num">Jogos</th><th class="num">Over real</th><th class="num">Esperado</th><th class="num">Diferença</th><th class="num">Viés</th></tr></thead><tbody>
    ${mostrar.map((j) => {
      const dif = j.over - j.esp, fora = EXC.has(j.aid);
      return `<tr class="${fora ? "cal-fora" : ""}"><td><input type="checkbox" data-aid="${esc(j.aid)}"${fora ? "" : " checked"} aria-label="usar na conta"></td>
        <td><button type="button" class="cal-nome" data-so="${esc(j.aid)}">${esc(M.nomes[j.aid] || j.aid)}</button> <span class="muted">${esc(j.tm)} · ${esc(j.pos)}</span></td>
        <td class="num">${j.jogos}</td><td class="num">${pct(j.over)}</td><td class="num">${pct(j.esp)}</td>
        <td class="num ${Math.abs(dif) >= 0.1 && j.jogos >= 4 ? (dif > 0 ? "cal-over" : "cal-under") : ""}">${sn(100 * dif, 0)} pp</td><td class="num">${sn(j.vies)}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="muted">Ordem: maior viés pesado pelo nº de jogos. ${lista.length > 40 ? `<button type="button" class="cal-limpa" data-acao="todos">${F.todos ? "mostrar só 40" : `mostrar os ${lista.length}`}</button>` : ""} Poucos jogos = muito acaso: um jogador com 3–4 jogos fora do esperado não diz nada sozinho.</p>`;
  for (const c of el.querySelectorAll("input[data-aid]")) c.onchange = () => {
    if (c.checked) EXC.delete(c.dataset.aid); else EXC.add(c.dataset.aid);
    gravar(LS_X, [...EXC]);
    montar();
  };
  for (const b of el.querySelectorAll("button[data-so]")) b.onclick = () => mudar("aid", b.dataset.so);
  const t = el.querySelector("button[data-acao=todos]");
  if (t) t.onclick = () => { F.todos = !F.todos; gravar(LS_F, F); jogadores(); };
}
