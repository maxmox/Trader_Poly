// Painel da partida (padroes.html, aba "Painel", 09/11/2026, pedido do usuário): para cada jogador, quanto ele já fez,
// quanto deveria ter feito com os minutos que jogou (ritmo normal dele) e a linha justa estimada para o fim do jogo.
// Atualiza a cada 30 s pelo box score da ESPN. Base: linha da DraftKings da análise do dia (sem linha: projeção do
// Edgely) ÷ minutos projetados. Estimativa simples e NÃO calibrada contra linhas ao vivo.
import { esc } from "./formato.js";
import { emQuadra, segundosPorPeriodo } from "./jogada.js";
import { atualizarRegistro, preencher, resolverPendentes } from "./registro.js";

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

// Minutos esperados antes do jogo: nossa projeção (minutos.py, erra menos que o Edgely: 6,4 × 7,1 min no teste de 09/11),
// senão Edgely, senão a média recente.
export const minEspDe = (j) => j.min_proj ?? (j.edgely?.min || j.recente?.media?.min || 0);

// Minutos esperados por quarto antes do jogo: total projetado repartido como a rotação dele nos últimos 10 jogos no
// time atual (rotacao.min_q); sem rotação, 1/4 em cada quarto.
export function minutosQuarto(j) {
  const minEsp = minEspDe(j);
  const mq = j.rotacao?.min_q;
  const soma = mq ? mq.reduce((a, b) => a + b, 0) : 0;
  return [0, 1, 2, 3].map((q) => (soma > 0 ? (minEsp * mq[q]) / soma : minEsp / 4));
}

// Estimativa de um jogador: feito, deveria (ritmo normal × minutos jogados) e linha justa ao fim.
export function estimar(j, box, rel, ajQ4) {
  const minEsp = minEspDe(j);
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
const insTxt = (x) => `${x.tipo === "time" ? `quente em pontos (${x.faixa}) com o time ${x.est} (${Math.round(100 * x.frac)}% dos companheiros abaixo do ritmo)` : `começo ${x.ini} + ${DIMTXT[x.dim]} ${x.nivel}`} (medido no ${CORTETXT[x.corte]}): termina ${x.u > 0 ? "+" : "−"}${num(Math.abs(x.u))} em relação à linha justa (${x.z > 0 ? "+" : "−"}${num(Math.abs(x.z), 2)} desvio; mesmo sinal em 3 testes, ${x.n + x.nC} casos)`;

// Sinais para a aba Ao vivo (09/11): insight ativo agora × o histórico do jogador nesse tipo de insight
// (nba_pbp/insights_jogador.py). Pontos, PRA e 3PM usam o jogador (separou fora da amostra: quem seguiu na 1ª metade
// dos jogos seguiu na 2ª); rebotes e assistências usam a liga. Efeito dele = efeito do insight × (encolhido dele ÷ liga);
// vira sinal com 0,12+ desvio. Linha alvo = linha justa + efeito dele (comparar com a linha ao vivo da casa).
// Cenário "time frio, 1–2 quentes" (09/11, nba_pbp/cenario_time.py → insights_time.json): quem está quente em pontos
// (≥ 1,15 do esperado; no máximo 2 quentes no time, 4+ jogadores com base) e o estado dos companheiros (frio = 60%+ abaixo
// de 0,85 do esperado em pontos; meio = 40–60%). Devolve por atleta os insights validados e os minutos a mais.
export function cenarioTime(tim, rel, lista) {
  const corte = corteDe(rel);
  const out = {};
  if (!tim?.insights || !corte) return out;
  const q0 = tim.quente?.[0] ?? 1.15, q1 = tim.quente?.[1] ?? 1.4, fr = tim.frio ?? 0.85;
  const porTime = {};
  for (const p of lista) if (p.est?.pts?.deveria >= 1) (porTime[p.time] ||= []).push({ ...p, r: p.est.pts.feito / p.est.pts.deveria });
  for (const com of Object.values(porTime)) {
    const nq = com.filter((p) => p.r >= q0).length;
    if (com.length < 4 || nq === 0 || nq > 2) continue;
    for (const p of com.filter((x) => x.r >= q0)) {
      const outros = com.filter((x) => x.aid !== p.aid);
      const frac = outros.filter((x) => x.r < fr).length / outros.length;
      const est = frac >= 0.6 ? "frio" : frac >= 0.4 ? "meio" : "normal";
      const faixa = p.r >= q1 ? "muito quente" : "quente";
      const ins = {};
      for (const x of tim.insights) if (x.corte === corte && x.faixa === faixa && x.est === est) ins[x.k] = { ...x, tipo: "time", frac };
      const m = (tim.minutos || []).find((x) => x.corte === corte && x.est === est && x.papel === (p.tit ? "titular" : "reserva"));
      out[p.aid] = { est, faixa, frac, ins, min: m?.dif ?? null };
    }
  }
  return out;
}
// dois insights na mesma estatística: de acordo → o mais forte; em conflito → nenhum
const juntar = (a, b) => (!a ? b || null : !b ? a : Math.sign(a.z) !== Math.sign(b.z) ? null : Math.abs(a.z) >= Math.abs(b.z) ? a : b);

export function sinaisJogo(g, s, d) {
  const comp = s?.header?.competitions?.[0];
  const st = comp?.status;
  if (st?.type?.state !== "in" || !d?.ins?.insights) return [];
  const rel = relogio(st);
  const box = lerBox(s);
  const placar = Object.fromEntries((comp.competitors || []).map((c) => [c.team.abbreviation, Number(c.score) || 0]));
  const margemDe = (t) => placar[t] - (Object.entries(placar).find(([k]) => k !== t)?.[1] ?? 0);
  const hTime = (t) => (g.handicap == null ? null : t === g.casa ? g.handicap : -g.handicap);
  const out = [];
  const js = [];
  for (const j of g.jogadores) {
    const b = box[j.aid];
    if (!b || b.dnp || b.pf >= 6) continue;
    const minEsp = minEspDe(j);
    const mg = margemDe(j.time);
    js.push({ j, b, mg, x: estimar(j, b, rel, ajusteQ4(minEsp, mg, rel, d.pol?.times?.[j.time])) });
  }
  const cen = cenarioTime(d.tim, rel, js.map(({ j, b, x }) => ({ aid: j.aid, time: j.time, tit: b.starter, est: x.est })));
  for (const { j, b, mg, x } of js) {
    const ch = chanceAgora(d.cm, rel, mg, hTime(j.time));
    for (const [k, nome] of ESTATS) {
      const ins = juntar(insightDe(d.ins, k, x.est[k], rel, ch), cen[j.aid]?.ins?.[k]);
      if (!ins) continue;
      const meta = d.jog?.por_k?.[k];
      const pj = ins.tipo === "time" ? null : d.jog?.jogadores?.[j.aid]?.[k]; // o histórico por jogador foi medido nos insights começo × chance
      const fator = meta?.usa_jogador && pj && meta.liga > 0 ? pj[2] / meta.liga : 1;
      const ef = ins.z * fator, uj = ins.u * fator;
      if (Math.abs(ef) < 0.15 || fator < 0.5 || Math.abs(uj) < MIN_UNID[k]) continue;
      out.push({ j, k, nome, ins, fator, ef, uj, n: pj?.[0] ?? 0, usa: !!(meta?.usa_jogador && pj), justa: x.est[k].justa, feito: x.est[k].feito,
        quadra: emQuadra(s.plays || [], String(j.aid), b.starter).quadra, quando: quandoTxt(st), jogo: `${g.fora} @ ${g.casa}` });
    }
  }
  // jogador com Over numa estatística e Under em outra (pontos/rebotes/assist./PRA se sobrepõem): sem sinal dele
  const lados = {};
  for (const x of out) if (x.k !== "tpm") (lados[x.j.aid] ||= new Set()).add(Math.sign(x.ef));
  return out.filter((x) => x.k === "tpm" || lados[x.j.aid].size === 1);
}
const MIN_UNID = { pts: 1, pra: 1.2, reb: 0.5, ast: 0.5, tpm: 0.3 }; // efeito mínimo na unidade da estatística para virar sinal

export function sinaisHtml(sinais) {
  if (!sinais.length) return `<p class="muted">Nenhum sinal do Painel agora (insight ativo com 0,12+ desvio para o jogador).</p>`;
  sinais.sort((a, b) => Math.abs(b.ef) - Math.abs(a.ef));
  return `<div class="panel" style="border-color:var(--accent);margin-bottom:10px"><h2 style="margin:0 0 6px">Sinais do Painel agora (${sinais.length})</h2><ul class="regras">${sinais.map((x) => {
    const cor = x.ef > 0 ? COR_O : COR_U;
    const alvo = x.justa + x.uj;
    const lado = x.ef > 0 ? `Over se a casa estiver abaixo de ~${num(alvo)}` : `Under se a casa estiver acima de ~${num(alvo)}`;
    const dele = x.usa ? `ele segue esse tipo de insight ${num(x.fator, 1)}× a liga (${x.n} casos)` : x.k === "reb" || x.k === "ast" ? "efeito da liga (em rebotes e assistências o histórico por jogador não separou)" : "sem histórico dele: efeito da liga";
    return `<li style="border-left:4px solid ${cor};padding-left:8px${Math.abs(x.ef) >= 0.2 ? ";font-weight:600" : ""}"><span class="chip" style="color:${cor};border:1px solid ${cor};background:transparent">${x.ef > 0 ? "↑ Over" : "↓ Under"}</span>
      <b>${esc(x.j.nome)}</b> ${x.nome} <small class="muted">(${esc(x.jogo)}, ${esc(x.quando)}${x.quadra == null ? "" : x.quadra ? ", em quadra" : ", no banco"})</small><br>
      tem ${x.feito}; linha justa ${num(x.justa)} → <b>${num(alvo)}</b> com o insight · <b>${lado}</b><br>
      <small>${esc(insTxt(x.ins))}; ${esc(dele)} → ${x.ef > 0 ? "+" : "−"}${num(Math.abs(x.ef), 2)} desvio para ele.</small></li>`;
  }).join("")}</ul><p class="hint" style="margin:6px 0 0">Insight do Painel (começo × chance de blowout/clutch, mesmo sinal em 3 testes) ajustado pelo histórico do jogador nesses insights (pontos, PRA e 3PM: quem seguiu na 1ª metade dos jogos seguiu na 2ª; rebotes e assistências: liga). Só aparece com 0,12+ desvio. Medido contra a linha de antes do jogo, não contra a linha ao vivo das casas.</p></div>`;
}

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
function celula(e, ins, aid, k) {
  const alvo = `data-aid="${aid}" data-k="${k}" title="clique para registrar uma entrada"`;
  if (e.deveria == null) return `<td class="pc" ${alvo}><b class="pc-feito">${e.feito}</b></td>`;
  const insH = ins ? `<div class="pc-ins" style="color:${ins.z > 0 ? COR_O : COR_U}" title="${esc(insTxt(ins))}">${ins.z > 0 ? "↑" : "↓"} ${ins.u > 0 ? "+" : "−"}${num(Math.abs(ins.u))}${Math.abs(ins.z) >= 0.15 ? " ●" : ""}</div>` : "";
  const r = e.deveria >= 0.5 ? e.feito / e.deveria : null; // começo: pouca base, sem cor
  const cor = r == null ? "var(--ink-3)" : r >= 1.15 ? COR_O : r <= 0.85 ? COR_U : "var(--ink-3)";
  const forte = r != null && (r >= 1.4 || r <= 0.6);
  const larg = Math.min(100, Math.round(((r ?? 0) / 2) * 100));
  const d = e.justa - e.pre;
  const seta = Math.abs(d) < Math.max(0.5, 0.04 * e.pre) ? "" : d > 0 ? `<span style="color:${COR_O}">▲</span>` : `<span style="color:${COR_U}">▼</span>`;
  return `<td class="pc${forte ? " forte" : ""}" style="--cor:${cor}" ${alvo}>
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
  const corpo = linhas.map(({ j, b, x, quadra, mq, ins, cmin }) => {
    const notaMin = cmin ? `<small style="color:${COR_O}" title="${esc(`quente em pontos (${cmin.faixa}) com o time ${cmin.est}: o técnico costuma deixar em quadra; ${b?.starter ? "titular" : "reserva"} nessa situação joga em média ${num(cmin.min)} min a mais que os companheiros (mesmo sinal em 3 testes)`)}">+${num(cmin.min)} min (quente, time ${cmin.est})</small>` : "";
    const pf = b?.pf ?? 0;
    const pfCor = pf >= 5 ? "var(--bad)" : pf >= 4 ? "var(--warn)" : "var(--ink-3)";
    const md = b ? b.min - x.minAgora : 0;
    const minCor = !b || x.minAgora < 3 ? "var(--ink)" : md >= 3 ? COR_O : md <= -3 ? COR_U : "var(--ink)";
    const dot = quadra == null ? "" : `<span class="dot${quadra ? " on" : ""}" title="${quadra ? "em quadra" : "no banco"}"></span>`;
    return `<tr><td class="pj">${dot}<b>${esc(j.nome)}</b><small style="color:${pfCor}">${b ? `${pf} falta${pf === 1 ? "" : "s"}` : "não entrou"}</small></td>
      <td class="pmin"><b style="color:${minCor}">${b ? b.min : 0}</b><small>de ~${num(x.minAgora, 0)} · fim ~${num((b?.min || 0) + x.minResto, 0)}</small>${notaMin}</td>
      ${[1, 2, 3, 4].map((q) => celQuarto(mq?.[q - 1], x.espQ[q - 1], q, rel)).join("")}${pr ? `<td class="pq0"><b>${num((mq || []).slice(4).reduce((a, c) => a + c, 0))}</b></td>` : ""}
      ${ESTATS.map(([k]) => celula(x.est[k], ins?.[k], j.aid, k)).join("")}</tr>`;
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
    const minEsp = minEspDe(j);
    const x = estimar(j, b, rel, ajusteQ4(minEsp, margem, rel, PAINEL.pol?.times?.[j.time]));
    const quadra = st.type?.state === "in" && b ? emQuadra(plays, String(j.aid), b.starter).quadra : null;
    // minutos reais em cada quarto pelas substituições (soma conferida com o box: 161/161 a menos de 1 min, 08/11)
    const mq = b && st.type?.state !== "pre" ? segundosPorPeriodo(plays, String(j.aid), rel.fim ? null : { p: rel.p, resta: rel.p > 4 ? rel.resta : 720 * rel.p - rel.t }).map((v) => v / 60) : null;
    const ins = Object.fromEntries(ESTATS.map(([k]) => [k, b ? insightDe(PAINEL.ins, k, x.est[k], rel, chance[j.time]) : null]));
    (porTime[j.time] ||= []).push({ j, b, x, quadra, mq, ins });
  }
  // cenário do time (quente com os companheiros frios): junta aos insights e marca os minutos a mais
  const cen = cenarioTime(PAINEL.tim, rel, Object.values(porTime).flat().filter((p) => p.b).map(({ j, b, x }) => ({ aid: j.aid, time: j.time, tit: b.starter, est: x.est })));
  for (const p of Object.values(porTime).flat()) {
    const c = cen[p.j.aid];
    if (c) for (const [k] of ESTATS) p.ins[k] = juntar(p.ins[k], c.ins[k]);
    p.cmin = c?.min ? c : null;
    for (const [k, nome] of ESTATS) if (p.ins[k]) lista.push({ j: p.j, nome, x: p.ins[k] });
  }
  const semBase = Object.entries(box).filter(([id, b]) => !vistos.has(id) && !b.dnp && b.min > 0).map(([, b]) => b);
  // contexto para o registro das entradas (o que o Painel mostrava na hora)
  let sinais = [];
  try { sinais = sinaisJogo(g, s, { cm: PAINEL.cm, ins: PAINEL.ins, jog: PAINEL.jog, pol: PAINEL.pol, tim: PAINEL.tim }); } catch { /* sem sinais */ }
  PAINEL.ctx = {
    data: new Date().toISOString().slice(0, 10), jogo_id: g.id, jogo: `${g.fora} @ ${g.casa}`, quando: quandoTxt(st), t: Math.round(rel.t), chance,
    sinais: Object.fromEntries(sinais.map((x) => [`${x.j.aid}|${x.k}`, x])),
    jogadores: Object.fromEntries(Object.values(porTime).flat().map(({ j, b, x, ins }) => [j.aid, {
      nome: j.nome, time: j.time, min: b?.min ?? 0, margem: margemDe(j.time), ins,
      est: Object.fromEntries(ESTATS.map(([k]) => [k, { feito: x.est[k].feito, justa: x.est[k].justa == null ? null : +x.est[k].justa.toFixed(2), pre: x.est[k].pre ?? null }])),
    }])),
  };
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

const LEGENDA = `<p class="hint">Em cada estatística: <b>feito</b> / <b>deveria</b> (ritmo normal dele × minutos que já jogou) e a barra do ritmo (meio = no ritmo; <span style="color:var(--sig-o)">azul</span> = 15%+ acima, <span style="color:var(--sig-u)">laranja</span> = 15%+ abaixo; borda = 40%+). Embaixo: <b>linha justa</b> estimada para o fim × linha da DraftKings antes do jogo (<i>proj</i> = sem linha, projeção do Edgely). Linha justa = feito + ritmo × minutos que faltam; ritmo = normal dele misturado com o de hoje (peso de hoje = min ÷ (min + 60): 12 min → 17%, 24 → 29%); minutos que faltam = o esperado dos quartos que faltam, com o Q4 ajustado pelo placar (16+: titulares saem pela política do time, reservas +30%; parelho no Q4: quem joga 30+ ganha 20%). Minutos: jogou / esperado até agora · fim previsto; Q1–Q4 = minutos reais no quarto / esperados antes do jogo (total da nossa projeção de minutos — últimos jogos no time, quem está fora hoje, 240 min por time — repartido pela rotação dele nos últimos 10 jogos; quarto encerrado com 2+ min de diferença em cor; o quarto em andamento tem borda; os que faltam mostram só o esperado). Os minutos que faltam usam esses quartos. Compare a linha justa com a linha ao vivo da casa. Estimativa simples, não calibrada contra linhas ao vivo. Atualiza a cada 30 s com a aba aberta.</p>
<p class="hint"><b>Chance agora</b> (blowout = o time tira os titulares com 1:30+ faltando; clutch apertado = titulares até o fim e placar até 6 a 2:00): tabela da liga por minuto × placar em 2.448 jogos, com o placar projetado pelo handicap do dia e o fator do técnico (2025-26 + 2026-27, encolhido). <b>Insights</b> (↑/↓ na célula, ● = 0,15+ desvio): começo do jogador (feito ÷ deveria: muito frio &lt; 0,6, frio &lt; 0,85, média até 1,15, quente até 1,4, muito quente acima) × nível da chance de blowout (&lt; 20%, 20–40%, 40%+) e de clutch (&lt; 30%, 30–50%, 50%+) da liga, medido no fim do Q1 (vale no Q2), no intervalo (Q3) e no fim do Q3 (Q4); o valor é quanto o final ficou acima ou abaixo da linha justa. Só entram os que tiveram o mesmo sinal em 3 testes (linha 2025-27, linha 2024-25 e jogos sem linha): de 357 cruzamentos, 182 repetiram (~89 seria acaso), então parte ainda é ruído. Não medido contra a linha ao vivo das casas.</p>`;

export async function mostrarPainel(el, dia, espn, forcar = false) {
  if (!dia || PAINEL.carregando || document.hidden) return;
  PAINEL.carregando = true;
  try {
    if (!PAINEL.pol) PAINEL.pol = await fetch("data/padroes/cenarios.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.cm) PAINEL.cm = await fetch("data/padroes/chance_minuto.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.ins) PAINEL.ins = await fetch("data/padroes/insights_painel.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.jog) PAINEL.jog = await fetch("data/padroes/insights_jogador.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.tim) PAINEL.tim = await fetch("data/padroes/insights_time.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    // duas áreas: a do jogo (refeita a cada 30 s) e a do registro (o formulário não é apagado enquanto se digita)
    if (!el.querySelector("#pn-vivo")) {
      el.innerHTML = `<div id="pn-vivo"><p class="muted">buscando o jogo…</p></div><div id="pn-reg"></div>`;
      el.querySelector("#pn-vivo").addEventListener("click", (ev) => {
        const td = ev.target.closest("td[data-aid]");
        if (td) preencher(el.querySelector("#pn-reg"), td.dataset.aid, td.dataset.k);
      });
    }
    const vivo = el.querySelector("#pn-vivo"), reg = el.querySelector("#pn-reg");
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
    vivo.innerHTML = `${seletor(dia)}<p class="muted" style="margin:6px 0">atualizado às ${hora}</p>${jogoHtml(g, PAINEL.sum?.header?.id === g.id ? PAINEL.sum : null)}${LEGENDA}`;
    for (const b of vivo.querySelectorAll("[data-jogo]")) b.onclick = () => {
      PAINEL.sel = b.dataset.jogo;
      try { localStorage.setItem("traderpoly.painel", PAINEL.sel); } catch { /* sem armazenamento */ }
      PAINEL.carregando = false;
      vivo.querySelector(".placar-vivo")?.insertAdjacentHTML("afterend", `<p class="muted">carregando…</p>`);
      mostrarPainel(el, dia, espn, true);
    };
    if (PAINEL.ctx) PAINEL.ctx.data = dia.data; // data do jogo (dia da análise), não a do registro
    try { await resolverPendentes(espn, PAINEL.sum); } catch { /* tenta na próxima */ }
    atualizarRegistro(reg, PAINEL.ctx);
  } finally { PAINEL.carregando = false; }
}
