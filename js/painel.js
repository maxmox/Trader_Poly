// Painel da partida (padroes.html, aba "Painel", 09/11/2026, pedido do usuário): para cada jogador, quanto ele já fez,
// quanto deveria ter feito com os minutos que jogou (ritmo normal dele) e a linha justa estimada para o fim do jogo.
// Atualiza a cada 30 s pelo box score da ESPN. Base: linha da DraftKings da análise do dia (sem linha: projeção do
// Edgely) ÷ minutos projetados. Estimativa simples e NÃO calibrada contra linhas ao vivo.
import { esc } from "./formato.js";
import { emQuadra, segundosPorPeriodo } from "./jogada.js";

export const ESTATS = [["pts", "PTS", "points"], ["reb", "REB", "rebounds"], ["ast", "AST", "assists"], ["tpm", "3PM", "threes"], ["pra", "PRA", "pra"]];
const JOGO_S = 2880;
const PESO_HOJE = 60; // peso do ritmo de hoje = min / (min + 60): 12 min → 17%, 24 → 29%, 36 → 38% (o ritmo do dia diz pouco)
const LIGA_Q4 = { ganhando: 0.6, perdendo: 0.6 }; // titulares no Q4 com 16+ × jogo normal (liga, cenarios.json)
const num = (v, c = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));

// Segundos decorridos e restantes do jogo (prorrogação de 5 min). No último minuto a ESPN manda só os segundos ("34.5").
export function relogio(st) {
  const p = st?.period || 0, estado = st?.type?.state;
  const txt = String(st?.displayClock ?? "0:00");
  const resta = txt.includes(":") ? txt.split(":").reduce((m, s) => (Number(m) || 0) * 60 + (Number(s) || 0)) : Number(txt) || 0;
  if (estado === "post" || st?.type?.completed) return { t: JOGO_S, resta: 0, p, fim: true };
  if (estado === "pre" || !p) return { t: 0, resta: JOGO_S, p: 0, fim: false };
  if (p <= 4) { const t = (p - 1) * 720 + 720 - resta; return { t, resta: JOGO_S - t, p, fim: false }; }
  return { t: JOGO_S + (p - 5) * 300 + 300 - resta, resta, p, fim: false };
}

// Multiplicador dos minutos dele no Q4: blowout (16+) tira os titulares (política do time quando houver, senão a liga)
// e dá minutos aos reservas; jogo parelho no Q4 (até 5) dá mais minutos a quem joga 30+.
export function ajusteQ4(minEsp, margem, rel, pol) {
  if (rel.p < 3 || margem == null) return 1;
  const a = Math.abs(margem);
  if (a >= 16) {
    const lado = margem > 0 ? "ganhando" : "perdendo";
    const r = (pol?.[`${lado}_atual`] || pol?.[lado])?.razao ?? LIGA_Q4[lado];
    const efeito = minEsp >= 24 ? r : minEsp < 20 ? 1.3 : 1;
    return rel.p >= 4 ? efeito : 1 + (efeito - 1) * 0.75; // no 3º a vantagem ainda pode cair
  }
  if (rel.p >= 4 && a <= 5 && minEsp >= 30) return 1.2;
  return 1;
}

// Linha pré-jogo de uma estatística: DraftKings da análise do dia; sem ela, projeção do Edgely; PRA sem linha = soma.
export function linhaPre(j, k) {
  const mk = ESTATS.find((e) => e[0] === k)[2];
  if (j.linhas?.[mk]?.l != null) return { v: j.linhas[mk].l, fonte: "DK" };
  if (k === "pra") {
    const ps = ["pts", "reb", "ast"].map((s) => linhaPre(j, s));
    if (ps.every((x) => x)) return { v: ps.reduce((t, x) => t + x.v, 0), fonte: ps.every((x) => x.fonte === "DK") ? "DK" : "proj" };
  }
  const e = j.edgely?.[k] ?? j.recente?.media?.[k];
  return e != null ? { v: e, fonte: "proj" } : null;
}

// Minutos esperados por quarto antes do jogo: total do Edgely repartido como a rotação dele nos últimos 10 jogos no
// time atual (rotacao.min_q); sem rotação, 1/4 em cada quarto.
export function minutosQuarto(j) {
  const minEsp = j.edgely?.min || j.recente?.media?.min || 0;
  const mq = j.rotacao?.min_q;
  const soma = mq ? mq.reduce((a, b) => a + b, 0) : 0;
  return [0, 1, 2, 3].map((q) => (soma > 0 ? (minEsp * mq[q]) / soma : minEsp / 4));
}

// Estimativa de um jogador: feito, deveria (ritmo normal × minutos jogados) e linha justa ao fim.
export function estimar(j, box, rel, ajQ4) {
  const minEsp = j.edgely?.min || j.recente?.media?.min || 0;
  const min = box?.min || 0;
  const fora = (box?.pf ?? 0) >= 6;
  const espQ = minutosQuarto(j);
  // minutos que ainda deve jogar: o esperado dos quartos que faltam (o atual pela parte que falta), Q4 ajustado pelo placar
  let minResto = 0;
  if (!rel.fim && !fora && minEsp) {
    if (rel.p > 4) minResto = (minEsp / JOGO_S) * rel.resta * 1.2; // prorrogação: quem joga muito fica
    else {
      const cur = Math.max(1, rel.p);
      const fracCur = rel.p ? (720 * cur - rel.t) / 720 : 1;
      for (let q = cur; q <= 4; q++) minResto += espQ[q - 1] * (q === cur ? fracCur : 1) * (q === 4 ? ajQ4 : 1);
    }
  }
  const minAgora = minEsp * Math.min(1, rel.t / JOGO_S);
  const w = min > 0 ? min / (min + PESO_HOJE) : 0;
  const est = {};
  for (const [k] of ESTATS) {
    const L = linhaPre(j, k);
    const feito = box?.[k] ?? 0;
    if (!L || !minEsp) { est[k] = { feito }; continue; }
    const taxa0 = L.v / minEsp;
    const taxa = (1 - w) * taxa0 + (min > 0 ? w * (feito / min) : 0);
    est[k] = { feito, deveria: taxa0 * min, justa: feito + taxa * minResto, pre: L.v, fonte: L.fonte };
  }
  return { minEsp, minAgora, minResto, espQ, est };
}

// Box score da ESPN → { id: {min, pts, reb, ast, tpm, pra, pf, starter, sigla, nome} }
export function lerBox(s) {
  const out = {};
  for (const t of s?.boxscore?.players || []) {
    const st = t.statistics?.[0];
    if (!st) continue;
    const ix = (n) => st.labels.indexOf(n);
    for (const a of st.athletes || []) {
      const v = a.stats || [];
      if (!v.length) { out[a.athlete.id] = { dnp: true, sigla: t.team.abbreviation, nome: a.athlete.displayName }; continue; }
      const n = (lab) => Number(v[ix(lab)]) || 0;
      const tpm = Number(String(v[ix("3PT")] || "0").split("-")[0]) || 0;
      const b = { min: n("MIN"), pts: n("PTS"), reb: n("REB"), ast: n("AST"), tpm, pf: n("PF"), starter: !!a.starter, sigla: t.team.abbreviation, nome: a.athlete.displayName };
      b.pra = b.pts + b.reb + b.ast;
      out[a.athlete.id] = b;
    }
  }
  return out;
}

// ---------- chance de blowout/clutch e insights (09/11; nba_pbp/blowout_minuto.py e insights_painel.py) ----------
// Chance agora pela tabela da liga (minuto × placar do time), com o placar projetado pelo handicap do dia
// (placar − peso × handicap do time × minutos que faltam ÷ 48; peso 1 no blowout, 0,75 no clutch). Valores em %.
export function chanceAgora(cm, rel, margem, hTime) {
  if (!cm?.liga) return null;
  const m = Math.min(47, Math.max(1, Math.floor(rel.t / 60)));
  const pega = (peso) => {
    const x = (margem ?? 0) - (hTime == null ? 0 : (peso * hTime * (48 - m)) / 48);
    for (let v = Math.max(-30, Math.min(30, Math.round(x))), i = 0; i < 31; i++, v -= Math.sign(v)) {
      const r = cm.liga[`${m}|${v}`];
      if (r) return r;
      if (v === 0) break;
    }
    return null;
  };
  const b = pega(cm.peso_handicap?.B ?? 1), c = pega(cm.peso_handicap?.C ?? 0.75);
  if (!b || !c) return null;
  return { bmais: b[0], bmenos: b[1], b5mais: b[3], b5menos: b[4], clutch: c[2] };
}

const INI = ["muito frio", "frio", "média", "quente", "muito quente"];
export const faixaIni = (r) => (r < 0.6 ? 0 : r < 0.85 ? 1 : r < 1.15 ? 2 : r < 1.4 ? 3 : 4);
const corteDe = (rel) => (rel.fim || rel.p === 0 ? null : rel.t >= 2160 ? 36 : rel.t >= 1440 ? 24 : rel.t >= 720 ? 12 : null);

// Insight validado para a estatística: começo dele × nível da chance de blowout e de clutch (chance da liga, como no teste).
// Os dois de acordo → o de maior efeito; em conflito → nenhum.
export function insightDe(ins, k, e, rel, ch) {
  const corte = corteDe(rel);
  if (!ins?.insights || !corte || !ch || e.deveria == null || e.deveria < 1) return null;
  const ini = INI[faixaIni(e.feito / e.deveria)];
  const nb = (ch.bmais + ch.bmenos) / 100, nc = ch.clutch / 100;
  const nivel = { blowout: nb < 0.2 ? "baixa" : nb < 0.4 ? "média" : "alta", clutch: nc < 0.3 ? "baixa" : nc < 0.5 ? "média" : "alta" };
  const ach = ins.insights.filter((x) => x.k === k && x.corte === corte && x.ini === ini && x.nivel === nivel[x.dim]);
  if (!ach.length || (ach.length > 1 && Math.sign(ach[0].z) !== Math.sign(ach[1].z))) return null;
  return ach.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
}
const DIMTXT = { blowout: "chance de blowout", clutch: "chance de clutch apertado" };
const CORTETXT = { 12: "fim do Q1", 24: "intervalo", 36: "fim do Q3" };
const insTxt = (x) => `começo ${x.ini} + ${DIMTXT[x.dim]} ${x.nivel} (medido no ${CORTETXT[x.corte]}): termina ${x.u > 0 ? "+" : "−"}${num(Math.abs(x.u))} em relação à linha justa (${x.z > 0 ? "+" : "−"}${num(Math.abs(x.z), 2)} desvio; mesmo sinal em 3 testes, ${x.n + x.nC} casos)`;

// ---------- tela ----------
const COR_O = "var(--sig-o)", COR_U = "var(--sig-u)";
let PAINEL = { sel: null, sb: null, sum: null, pol: null, carregando: false };
try { PAINEL.sel = localStorage.getItem("traderpoly.painel") || null; } catch { /* sem armazenamento */ }

function quandoTxt(st) {
  const e = st?.type?.state;
  if (e === "pre") return "antes do jogo";
  if (e === "post") return "encerrado";
  if (/HALFTIME/.test(st?.type?.name || "")) return "intervalo";
  const rel = relogio(st);
  const q = rel.p > 4 ? `Pr${rel.p - 4}` : `Q${rel.p}`;
  const s = Math.round(rel.p > 4 ? 300 - rel.resta : rel.t - (rel.p - 1) * 720); // minutos decorridos no quarto
  return /END_PERIOD/.test(st?.type?.name || "") ? `fim do ${q}` : `${q} aos ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// célula de uma estatística: feito grande, deveria pequeno, barra do ritmo e a linha justa × pré-jogo
function celula(e, ins) {
  if (e.deveria == null) return `<td class="pc"><b class="pc-feito">${e.feito}</b></td>`;
  const insH = ins ? `<div class="pc-ins" style="color:${ins.z > 0 ? COR_O : COR_U}" title="${esc(insTxt(ins))}">${ins.z > 0 ? "↑" : "↓"} ${ins.u > 0 ? "+" : "−"}${num(Math.abs(ins.u))}${Math.abs(ins.z) >= 0.15 ? " ●" : ""}</div>` : "";
  const r = e.deveria >= 0.5 ? e.feito / e.deveria : null; // começo: pouca base, sem cor
  const cor = r == null ? "var(--ink-3)" : r >= 1.15 ? COR_O : r <= 0.85 ? COR_U : "var(--ink-3)";
  const forte = r != null && (r >= 1.4 || r <= 0.6);
  const larg = Math.min(100, Math.round(((r ?? 0) / 2) * 100));
  const d = e.justa - e.pre;
  const seta = Math.abs(d) < Math.max(0.5, 0.04 * e.pre) ? "" : d > 0 ? `<span style="color:${COR_O}">▲</span>` : `<span style="color:${COR_U}">▼</span>`;
  return `<td class="pc${forte ? " forte" : ""}" style="--cor:${cor}">
    <div class="pc-top"><b class="pc-feito" style="color:${r == null ? "var(--ink)" : cor}">${e.feito}</b><span class="pc-dev">/ ${num(e.deveria)}</span></div>
    <div class="pbar" title="feito ÷ deveria: ${r == null ? "–" : num(r, 2)}"><i style="width:${larg}%;background:${cor}"></i><em></em></div>
    <div class="pc-fim">${seta}<b>${num(e.justa)}</b> <small title="${e.fonte === "DK" ? "linha da DraftKings antes do jogo" : "sem linha: projeção do Edgely"}">${e.fonte === "DK" ? "pré" : "proj"} ${num(e.pre)}</small></div>${insH}</td>`;
}

// minutos de um quarto: real / esperado antes do jogo; quarto encerrado com 2+ min de diferença ganha cor; o atual tem borda
function celQuarto(real, esp, q, rel) {
  const atual = q === rel.p && !rel.fim;
  const futuro = !rel.fim && (rel.p === 0 || q > rel.p);
  if (futuro) return `<td class="pq0"><span class="muted">${num(esp)}</span></td>`;
  const d = (real ?? 0) - (esp ?? 0);
  const cor = atual || esp == null ? "var(--ink)" : d >= 2 ? COR_O : d <= -2 ? COR_U : "var(--ink)";
  return `<td class="pq0${atual ? " atual" : ""}"><b style="color:${cor}">${num(real)}</b><small>/ ${num(esp)}</small></td>`;
}

function tabelaTime(sigla, linhas, semBase, rel) {
  const pr = rel.p > 4;
  const corpo = linhas.map(({ j, b, x, quadra, mq, ins }) => {
    const pf = b?.pf ?? 0;
    const pfCor = pf >= 5 ? "var(--bad)" : pf >= 4 ? "var(--warn)" : "var(--ink-3)";
    const md = b ? b.min - x.minAgora : 0;
    const minCor = !b || x.minAgora < 3 ? "var(--ink)" : md >= 3 ? COR_O : md <= -3 ? COR_U : "var(--ink)";
    const dot = quadra == null ? "" : `<span class="dot${quadra ? " on" : ""}" title="${quadra ? "em quadra" : "no banco"}"></span>`;
    return `<tr><td class="pj">${dot}<b>${esc(j.nome)}</b><small style="color:${pfCor}">${b ? `${pf} falta${pf === 1 ? "" : "s"}` : "não entrou"}</small></td>
      <td class="pmin"><b style="color:${minCor}">${b ? b.min : 0}</b><small>de ~${num(x.minAgora, 0)} · fim ~${num((b?.min || 0) + x.minResto, 0)}</small></td>
      ${[1, 2, 3, 4].map((q) => celQuarto(mq?.[q - 1], x.espQ[q - 1], q, rel)).join("")}${pr ? `<td class="pq0"><b>${num((mq || []).slice(4).reduce((a, c) => a + c, 0))}</b></td>` : ""}
      ${ESTATS.map(([k]) => celula(x.est[k], ins?.[k])).join("")}</tr>`;
  }).join("");
  const extra = semBase.length ? `<p class="hint" style="margin:6px 0 0">Sem projeção na análise do dia: ${semBase.map((b) => `${esc(b.nome)} ${b.min} min, ${b.pts} pts, ${b.reb} reb, ${b.ast} ast`).join(" · ")}</p>` : "";
  return `<h3 class="ptime">${esc(sigla)}</h3><div class="tbl-wrap"><table class="painel"><thead><tr><th>Jogador</th><th>Min</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>${pr ? "<th>Pr</th>" : ""}${ESTATS.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>${extra}`;
}

function jogoHtml(g, s) {
  const comp = s?.header?.competitions?.[0];
  const st = comp?.status || { type: { state: "pre" } };
  const rel = relogio(st);
  const box = lerBox(s);
  const placar = Object.fromEntries((comp?.competitors || []).map((c) => [c.team.abbreviation, Number(c.score) || 0]));
  const plays = s?.plays || [];
  const out = (g.lesoes ? Object.values(g.lesoes).flat() : []).filter((x) => /\(Out\)/.test(x)).map((x) => x.replace(/ \(.*$/, ""));
  const porTime = {};
  const vistos = new Set();
  const hTime = (t) => (g.handicap == null ? null : t === g.casa ? g.handicap : -g.handicap); // handicap do mandante: negativo = favorito
  const margemDe = (t) => (placar[t] != null ? placar[t] - (Object.entries(placar).find(([k]) => k !== t)?.[1] ?? 0) : 0);
  const chance = Object.fromEntries([g.fora, g.casa].map((t) => [t, chanceAgora(PAINEL.cm, rel, margemDe(t), hTime(t))]));
  const lista = [];
  for (const j of g.jogadores) {
    const b = box[j.aid];
    vistos.add(String(j.aid));
    // fora do jogo: sem jogar (DNP), ou jogo começado e ele nem aparece no box (inativo), ou Out no relatório
    if (b?.dnp || (!b && (Object.keys(box).length || out.includes(j.nome)) && st.type?.state !== "pre")) continue;
    const margem = placar[j.time] != null ? placar[j.time] - (Object.entries(placar).find(([k]) => k !== j.time)?.[1] ?? 0) : null;
    const minEsp = j.edgely?.min || j.recente?.media?.min || 0;
    const x = estimar(j, b, rel, ajusteQ4(minEsp, margem, rel, PAINEL.pol?.times?.[j.time]));
    const quadra = st.type?.state === "in" && b ? emQuadra(plays, String(j.aid), b.starter).quadra : null;
    // minutos reais em cada quarto pelas substituições (soma conferida com o box: 161/161 a menos de 1 min, 08/11)
    const mq = b && st.type?.state !== "pre" ? segundosPorPeriodo(plays, String(j.aid), rel.fim ? null : { p: rel.p, resta: rel.p > 4 ? rel.resta : 720 * rel.p - rel.t }).map((v) => v / 60) : null;
    const ins = Object.fromEntries(ESTATS.map(([k]) => [k, b ? insightDe(PAINEL.ins, k, x.est[k], rel, chance[j.time]) : null]));
    for (const [k, nome] of ESTATS) if (ins[k]) lista.push({ j, nome, x: ins[k] });
    (porTime[j.time] ||= []).push({ j, b, x, quadra, mq, ins });
  }
  const semBase = Object.entries(box).filter(([id, b]) => !vistos.has(id) && !b.dnp && b.min > 0).map(([, b]) => b);
  const siglas = [g.fora, g.casa];
  for (const t of siglas) (porTime[t] || []).sort((a, c) => (c.b?.starter - a.b?.starter) || (c.x.minEsp - a.x.minEsp));
  const marg = (placar[g.casa] ?? 0) - (placar[g.fora] ?? 0);
  const aviso = rel.p >= 3 && Math.abs(marg) >= 16 ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn)">blowout: minutos do Q4 ajustados</span>`
    : rel.p >= 4 && Math.abs(marg) <= 5 ? `<span class="chip" style="background:var(--accent-soft);color:var(--accent)">parelho: titulares jogam mais o Q4</span>` : "";
  // chance de cada time, com o fator do técnico (tira titulares mais ou menos que a liga com o mesmo placar)
  const fat = (t) => PAINEL.cm?.times?.[t] || { fator: 1, fator_clutch: 1 };
  const lim = (v) => Math.min(95, Math.round(v));
  const chanceH = rel.fim ? "" : `<div class="chance-vivo">${[g.fora, g.casa].map((t) => {
    const c = chance[t];
    if (!c) return "";
    const f = fat(t);
    return `<div><b>${esc(t)}</b> blowout a favor <b>${lim(c.bmais * f.fator)}%</b> <small>(5+ min ${lim(c.b5mais * f.fator)}%)</small> · contra <b>${lim(c.bmenos * f.fator)}%</b> <small>(5+ min ${lim(c.b5menos * f.fator)}%)</small> · clutch apertado <b>${lim(c.clutch * f.fator_clutch)}%</b> <small title="fator do técnico: blowout × ${num(f.fator, 2)}, clutch × ${num(f.fator_clutch, 2)}">técnico ×${num(f.fator, 2)}</small></div>`;
  }).join("")}</div>`;
  // no topo só os de efeito maior (0,12+ desvio); os menores ficam só na célula (quadro limpo)
  const fortes = lista.filter(({ x }) => Math.abs(x.z) >= 0.12).sort((a, c) => Math.abs(c.x.z) - Math.abs(a.x.z));
  const corIns = (x) => (x.z > 0 ? COR_O : COR_U);
  const insH = fortes.length ? `<div class="panel ins-vivo"><h2 style="margin:0 0 6px">Insights agora (${fortes.length})</h2><ul class="regras">${fortes.slice(0, 10).map(({ j, nome, x }) =>
    `<li style="border-left:4px solid ${corIns(x)};padding-left:8px${Math.abs(x.z) >= 0.15 ? ";font-weight:600" : ""}"><span class="chip" style="color:${corIns(x)};border:1px solid ${corIns(x)};background:transparent">${x.z > 0 ? "↑ Over" : "↓ Under"}</span> <b>${esc(j.nome)}</b> ${nome}: ${esc(insTxt(x))}</li>`).join("")}</ul>${fortes.length > 10 ? `<p class="muted">+${fortes.length - 10} nas células</p>` : ""}</div>` : "";
  return `<div class="placar-vivo"><span class="pt">${esc(g.fora)} <b>${placar[g.fora] ?? "–"}</b></span><span class="px">×</span><span class="pt"><b>${placar[g.casa] ?? "–"}</b> ${esc(g.casa)}</span>
    <span class="pq">${quandoTxt(st)}</span>${aviso}</div>${chanceH}${insH}
    ${siglas.map((t) => tabelaTime(t, porTime[t] || [], semBase.filter((b) => b.sigla === t), rel)).join("")}`;
}

function seletor(dia) {
  const ev = Object.fromEntries((PAINEL.sb?.events || []).map((e) => [e.id, e]));
  return `<div class="chips painel-jogos">${dia.jogos.map((g) => {
    const e = ev[g.id]?.competitions?.[0];
    const st = e?.status?.type?.state;
    const sc = e ? Object.fromEntries(e.competitors.map((c) => [c.team.abbreviation, c.score])) : {};
    const txt = st && st !== "pre" ? `${g.fora} ${sc[g.fora] ?? ""} × ${sc[g.casa] ?? ""} ${g.casa}` : `${g.fora} @ ${g.casa}`;
    const ao = st === "in" ? " ●" : "";
    return `<button type="button" data-jogo="${g.id}" aria-pressed="${g.id === PAINEL.sel}" class="${st === "in" ? "ao-vivo" : ""}">${esc(txt)}${ao}</button>`;
  }).join("")}</div>`;
}

const LEGENDA = `<p class="hint">Em cada estatística: <b>feito</b> / <b>deveria</b> (ritmo normal dele × minutos que já jogou) e a barra do ritmo (meio = no ritmo; <span style="color:var(--sig-o)">azul</span> = 15%+ acima, <span style="color:var(--sig-u)">laranja</span> = 15%+ abaixo; borda = 40%+). Embaixo: <b>linha justa</b> estimada para o fim × linha da DraftKings antes do jogo (<i>proj</i> = sem linha, projeção do Edgely). Linha justa = feito + ritmo × minutos que faltam; ritmo = normal dele misturado com o de hoje (peso de hoje = min ÷ (min + 60): 12 min → 17%, 24 → 29%); minutos que faltam = o esperado dos quartos que faltam, com o Q4 ajustado pelo placar (16+: titulares saem pela política do time, reservas +30%; parelho no Q4: quem joga 30+ ganha 20%). Minutos: jogou / esperado até agora · fim previsto; Q1–Q4 = minutos reais no quarto / esperados antes do jogo (total do Edgely repartido pela rotação dele nos últimos 10 jogos; quarto encerrado com 2+ min de diferença em cor; o quarto em andamento tem borda; os que faltam mostram só o esperado). Os minutos que faltam usam esses quartos. Compare a linha justa com a linha ao vivo da casa. Estimativa simples, não calibrada contra linhas ao vivo. Atualiza a cada 30 s com a aba aberta.</p>
<p class="hint"><b>Chance agora</b> (blowout = o time tira os titulares com 1:30+ faltando; clutch apertado = titulares até o fim e placar até 6 a 2:00): tabela da liga por minuto × placar em 2.448 jogos, com o placar projetado pelo handicap do dia e o fator do técnico (2025-26 + 2026-27, encolhido). <b>Insights</b> (↑/↓ na célula, ● = 0,15+ desvio): começo do jogador (feito ÷ deveria: muito frio &lt; 0,6, frio &lt; 0,85, média até 1,15, quente até 1,4, muito quente acima) × nível da chance de blowout (&lt; 20%, 20–40%, 40%+) e de clutch (&lt; 30%, 30–50%, 50%+) da liga, medido no fim do Q1 (vale no Q2), no intervalo (Q3) e no fim do Q3 (Q4); o valor é quanto o final ficou acima ou abaixo da linha justa. Só entram os que tiveram o mesmo sinal em 3 testes (linha 2025-27, linha 2024-25 e jogos sem linha): de 357 cruzamentos, 182 repetiram (~89 seria acaso), então parte ainda é ruído. Não medido contra a linha ao vivo das casas.</p>`;

export async function mostrarPainel(el, dia, espn, forcar = false) {
  if (!dia || PAINEL.carregando || document.hidden) return;
  PAINEL.carregando = true;
  try {
    if (!PAINEL.pol) PAINEL.pol = await fetch("data/padroes/cenarios.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.cm) PAINEL.cm = await fetch("data/padroes/chance_minuto.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.ins) PAINEL.ins = await fetch("data/padroes/insights_painel.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    try { PAINEL.sb = await espn(`/scoreboard?dates=${dia.data.replaceAll("-", "")}`); } catch { /* fica com o anterior */ }
    const ids = dia.jogos.map((g) => g.id);
    if (!ids.includes(PAINEL.sel)) {
      const st = (id) => PAINEL.sb?.events?.find((e) => e.id === id)?.competitions?.[0]?.status?.type?.state;
      PAINEL.sel = ids.find((id) => st(id) === "in") || ids.find((id) => st(id) === "pre") || ids[0];
    }
    const g = dia.jogos.find((x) => x.id === PAINEL.sel);
    if (forcar || PAINEL.sum?.header?.id !== g.id || !PAINEL.sum?.header?.competitions?.[0]?.status?.type?.completed) {
      try { PAINEL.sum = await espn(`/summary?event=${g.id}`); } catch { if (PAINEL.sum?.header?.id !== g.id) PAINEL.sum = null; }
    }
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    el.innerHTML = `${seletor(dia)}<p class="muted" style="margin:6px 0">atualizado às ${hora}</p>${jogoHtml(g, PAINEL.sum?.header?.id === g.id ? PAINEL.sum : null)}${LEGENDA}`;
    for (const b of el.querySelectorAll("[data-jogo]")) b.onclick = () => {
      PAINEL.sel = b.dataset.jogo;
      try { localStorage.setItem("traderpoly.painel", PAINEL.sel); } catch { /* sem armazenamento */ }
      PAINEL.carregando = false;
      el.querySelector(".placar-vivo")?.insertAdjacentHTML("afterend", `<p class="muted">carregando…</p>`);
      mostrarPainel(el, dia, espn, true);
    };
  } finally { PAINEL.carregando = false; }
}
