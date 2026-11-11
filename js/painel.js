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
  // 11/11 (usuário): a projeção da linha é a MÉDIA com a odd sem margem (Over 8,5 a 1,50 ≈ 10; a 2,00 ≈ 8,6), não a linha
  if (j.linhas?.[mk]?.l != null) return { v: j.linhas[mk].m ?? j.linhas[mk].l, fonte: "DK", linha: j.linhas[mk].l };
  if (k === "pra") {
    const ps = ["pts", "reb", "ast"].map((s) => linhaPre(j, s));
    if (ps.every((x) => x)) return { v: ps.reduce((t, x) => t + x.v, 0), fonte: ps.every((x) => x.fonte === "DK") ? "DK" : "proj" };
  }
  const e = j.edgely?.[k] ?? j.recente?.media?.[k];
  return e != null ? { v: e, fonte: "proj" } : null;
}

// Minutos esperados antes do jogo: nossa projeção (minutos.py, erra menos que o Edgely: 6,4 × 7,1 min no teste de 09/11),
// senão Edgely, senão a média recente.
// 11/11: primeiro a previsão combinada (nossa projeção + média recente + minutos que a linha da DK precifica;
// nba_pbp/minutos_mercado.py: erro 4,50 min × 4,90 da nossa projeção sozinha nos jogadores com linha).
export const minEspDe = (j) => j.min_final ?? j.min_proj ?? (j.darko?.min || j.edgely?.min || j.recente?.media?.min || 0);  // 11/11: DARKO antes do Edgely (usuário)

// Minutos esperados por quarto antes do jogo: total projetado repartido como a rotação dele nos últimos 10 jogos no
// time atual (rotacao.min_q); sem rotação, 1/4 em cada quarto.
export function minutosQuarto(j) {
  const minEsp = minEspDe(j);
  const mq = j.rotacao?.min_q;
  const soma = mq ? mq.reduce((a, b) => a + b, 0) : 0;
  return [0, 1, 2, 3].map((q) => (soma > 0 ? (minEsp * mq[q]) / soma : minEsp / 4));
}

// Minutos que faltam pela rotação (11/11/2026, ideia do usuário: a linha justa "tica" com a rotação; nba_pbp/minutos_vivo.py):
// média do que ele jogou DEPOIS deste segundo nos 10 jogos anteriores em que, neste mesmo segundo, estava no mesmo lugar
// (no banco: sentado há pelo menos o mesmo tempo, então o relógio do banco vai tirando os jogos em que ele já tinha
// voltado), na escala da projeção de hoje. Q1–Q3: puxada para a conta por quarto pelo nº de jogos parecidos (n/(n+3)) +
// ajuste pelo que ele já jogou acima/abaixo do normal até aqui; Q4: sem puxar. Teste (453 mil momentos, 2025-27, 2ª
// metade): erro 3,42 min × 3,66 da conta por quarto; o viés (em quadra −1 a −2 min, no banco +1) quase some.
const COEF_ROT = [[0.55, 0.66], [0.55, 0.64], [0.14, 0.26], [0.01, 0.08]]; // [em quadra, no banco] por quarto
const K_ROT = 3;
const sobreS = (h, a, b) => { let s = 0; for (let i = 0; i + 1 < h.length; i += 2) s += Math.max(0, Math.min(h[i + 1], b) - Math.max(h[i], a)); return s / 60; };
function estadoH(h, t) {
  let ant = 0;
  for (let i = 0; i + 1 < h.length; i += 2) {
    if (h[i] <= t && t < h[i + 1]) return [true, t - h[i]];
    if (h[i + 1] <= t) ant = Math.max(ant, h[i + 1]);
  }
  return [false, t - ant];
}
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function minRestoRotacao(j, rel, agora, minEsp, base) {
  // 11/11 (nba_pbp/minutos_vivo2.py): até 20 jogos anteriores, cada um pesado pela semelhança do total de minutos com o
  // previsto de hoje (mesmo papel; σ 5 min), na escala dos minutos previstos (nossa projeção + média recente + mercado).
  // Minutos que faltam: erro 3,25 → 3,18 min; papel mudando 3,65 → 3,43.
  const hist = j.rotacao?.hist;
  if (!hist?.length || hist.length < 4 || !agora || rel.p < 1 || rel.p > 4 || rel.fim || !minEsp) return null;
  const t = rel.t;
  const tots = hist.map((h) => sobreS(h, 0, 2880));
  const pesos = tots.map((x) => Math.exp(-0.5 * ((x - minEsp) / 5) ** 2) + 0.05);
  const W = pesos.reduce((a, b) => a + b, 0), wmax = Math.max(...pesos);
  const tot = pesos.reduce((s, w, i) => s + w * tots[i], 0) / W;
  if (!tot) return null;
  const esc = minEsp / tot;
  const q = Math.min(3, Math.floor(t / 720));
  const espQ = [0, 1, 2, 3].map((k) => (pesos.reduce((s, w, i) => s + w * sobreS(hist[i], 720 * k, 720 * (k + 1)), 0) / W) * esc);
  const A = espQ[q] * (720 * (q + 1) - t) / 720 + espQ.slice(q + 1).reduce((a, b) => a + b, 0);
  let num = 0, den = 0, n = 0;
  hist.forEach((h, i) => {
    const [qd, d] = estadoH(h, t);
    if (qd !== agora.quadra || (!agora.quadra && d + 1 < agora.dur)) return;
    num += pesos[i] * sobreS(h, t, 2880) * esc;
    den += pesos[i];
    n += pesos[i] / wmax;
  });
  const B = den ? num / den : A;
  const ate = (pesos.reduce((s, w, i) => s + w * sobreS(hist[i], 0, t), 0) / W) * esc;
  const c = COEF_ROT[q][agora.quadra ? 0 : 1];
  const v = (q < 3 ? (n * B + K_ROT * A) / (n + K_ROT) : B) + c * (agora.jogou - ate);
  return { min: Math.max(0, Math.min(v, (2880 - t) / 60)), n: Math.round(n * 10) / 10 };
}

// Dispersão e chance de acerto (11/11/2026, pedido do usuário; nba_pbp/dispersao.py): o que falta até o fim é uma
// contagem com média μ (justa − feito) e dispersão φ = variância ÷ média (φ < 1 concentrado/binomial, 1 Poisson, > 1
// espalhado/binomial negativa). φ da liga por estatística × momento × tamanho de μ e fator de cada jogador (traço que
// repete entre metades dos jogos, encolhido), escolhidos por máxima verossimilhança; melhor que Poisson fora da amostra.
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  const tt = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(tt) - tt + Math.log(a);
}
function logp(k, mu, phi) {
  mu = Math.max(mu, 1e-6);
  if (phi > 1.02) {
    const r = mu / (phi - 1), p = r / (r + mu);
    return lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p);
  }
  if (phi < 0.98) {
    const pb = 1 - phi, n = mu / pb;
    if (k > n + 0.999) return -30;
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(Math.max(n - k + 1, 1e-9)) + k * Math.log(pb) + (n - k) * Math.log(1 - pb);
  }
  return k * Math.log(mu) - mu - lgamma(k + 1);
}
// P(o que falta ≥ falta), falta inteiro
export function chanceAcima(mu, phi, falta) {
  if (falta <= 0) return 1;
  let s = 0;
  for (let k = 0; k < falta; k++) s += Math.exp(logp(k, mu, phi));
  if (phi < 0.98) {
    const n = mu / (1 - phi);
    let tot = 0;
    for (let k = 0; k < Math.floor(n) + 2; k++) tot += Math.exp(logp(k, mu, phi));
    if (tot > 0) s /= tot;
  }
  return Math.max(0, Math.min(1, 1 - s));
}
// φ de uma estatística (pts/reb/ast/tpm/pra) para o jogador agora
export function phiDe(tab, k, t, mu, aid) {
  const dp = tab?.dispersao;
  const i = dp?.stats?.indexOf(k) ?? -1;
  if (i < 0) return 1;
  const m = t < 720 ? 0 : t < 1440 ? 1 : t < 2160 ? 2 : 3;
  const fb = dp.mu_lim.filter((x) => mu >= x).length;
  const linha = dp.liga[k][m];
  let v = null;
  for (const d of [0, -1, 1, -2, 2, -3, 3]) if (linha[fb + d] != null) { v = linha[fb + d]; break; }
  return (v ?? 1) * (dp.jogadores?.[aid]?.[i] ?? 1);
}
// Chance de Over/Under numa linha L com o que ele já fez (feito) e o que falta (lista de [k, μ]); combinações somam
// as variâncias. Devolve {over, under, push, dp}.
export function chanceLinha(tab, aid, t, partes, feito, L) {
  const mu = partes.reduce((s, [, m]) => s + Math.max(m, 0.05), 0);
  const varr = partes.reduce((s, [k, m]) => s + phiDe(tab, k, t, Math.max(m, 0.05), aid) * Math.max(m, 0.05), 0);
  const phi = varr / mu;
  const alvo = L - feito;
  if (alvo < 0) return { over: 1, under: 0, push: 0, dp: Math.sqrt(varr) };
  const over = chanceAcima(mu, phi, Math.floor(alvo) + 1);
  const ateL = chanceAcima(mu, phi, Math.ceil(alvo)); // P(resto ≥ alvo)
  const push = Number.isInteger(alvo) ? Math.max(0, ateL - over) : 0;
  return { over, under: Math.max(0, 1 - over - push), push, dp: Math.sqrt(varr) };
}

// Antes do jogo (11/11, nba_pbp/pre_jogo_chance.py): a chance pela dispersão com a linha como média PERDE da odd sem
// margem da DK (101 mil linhas; EV ≥ 5% do modelo: rebotes Under −7,6%, pontos −0,6%) — a linha é ~mediana e a DK já
// precifica a forma. Então, pré-jogo, a chance vem da DK: na mesma linha = odd sem margem dela; noutra linha = média que
// reproduz a chance da DK na linha dela, levada à linha da casa com a dispersão.
export function chanceLinhaPre(tab, aid, k, Ldk, pOverDk, L) {
  const falta = (x) => Math.floor(x) + 1;
  const phi = (mu) => phiDe(tab, k, 0, mu, aid);
  if (Ldk == null || pOverDk == null || !(pOverDk > 0 && pOverDk < 1)) return null;
  let lo = 0.05, hi = Math.max(5, 3 * Ldk + 5);
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (chanceAcima(mid, phi(mid), falta(Ldk)) < pOverDk) lo = mid; else hi = mid;
  }
  const mu = (lo + hi) / 2, ph = phi(mu);
  if (Math.abs(L - Ldk) < 1e-9) return { over: pOverDk, under: 1 - pOverDk, push: 0, dp: Math.sqrt(ph * mu), mu, dk: true };
  const over = chanceAcima(mu, ph, falta(L));
  const push = Number.isInteger(L) ? Math.max(0, chanceAcima(mu, ph, L) - over) : 0;
  return { over, under: Math.max(0, 1 - over - push), push, dp: Math.sqrt(ph * mu), mu, dk: true };
}

// Situação dele agora: em quadra ou no banco, há quanto tempo (s) e quantos minutos já jogou (tempo normal).
export function agoraDe(plays, aid, b, rel, st) {
  if (st?.type?.state !== "in" || !b || rel.p > 4) return null;
  const e = emQuadra(plays, String(aid), b.starter);
  const seg = segundosPorPeriodo(plays, String(aid), { p: rel.p, resta: 720 * rel.p - rel.t });
  const jogou = seg.slice(0, 4).reduce((a, x) => a + x, 0) / 60;
  return { quadra: e.quadra, dur: Math.max(0, rel.t - (e.desde || 0)), jogou: jogou || b.min || 0 };
}

// Calibração da linha justa (11/11/2026, nba_pbp/calibrar_justa.py → data/padroes/calibra_justa.json): fator de minutos e
// de ritmo por momento × placar projetado do time (placar + handicap pelo tempo que falta) × papel (minutos esperados),
// peso do ritmo de hoje por estatística (K) e nível do ritmo contra a linha da DK. Ajustado em metade dos jogos e
// medido na outra: viés médio por situação pontos 0,42 → 0,28, PRA 0,56 → 0,37, rebotes 0,12 → 0,08; com as estrelas
// e as faltas (jogos com lesão provável fora do ajuste e do teste) pontos 0,21, PRA 0,29.
export function placarProj(g, time, mg, rel) {
  if (mg == null) return null;
  const h = g.handicap == null ? 0 : time === g.casa ? g.handicap : -g.handicap; // negativo = favorito
  return mg - (h * Math.max(0, JOGO_S - rel.t)) / JOGO_S;
}
// Estrela nº 1 e nº 2 de cada time (calibração das estrelas, 11/11, hipótese do usuário: no jogo apertado a estrela
// pontua mais desde o Q3 e os outros somem): maiores linhas de pontos do dia (sem linha, média recente). {aid: 0|1}
export function estrelasDe(g) {
  const out = {};
  const por = {};
  for (const j of g.jogadores || []) (por[j.time] ||= []).push(j);
  for (const js of Object.values(por)) {
    const pts = (j) => j.linhas?.points?.l ?? j.recente?.media?.pts ?? j.edgely?.pts ?? 0;
    js.slice().sort((a, b) => pts(b) - pts(a)).slice(0, 2).forEach((j, i) => { out[j.aid] = i; });
  }
  return out;
}

// Quente em pontos com o time frio/meio/normal (revalidado contra a justa nova em 11/11, nba_pbp/revalidar_insights.py):
// jogadores do dia com 4+ min; 1–2 quentes (≥ 1,15 do ritmo normal em pontos); estado = fração dos outros < 0,85.
// Devolve {aid: [estado 0 normal/1 meio/2 frio, 0 quente/1 muito quente]}.
export function quentesDoJogo(g, box) {
  const out = {};
  const por = {};
  for (const j of g.jogadores || []) {
    const b = box?.[j.aid], L = linhaPre(j, "pts"), me = minEspDe(j);
    if (!b || b.dnp || !L || !me || (b.min || 0) < 4) continue;
    (por[j.time] ||= []).push({ aid: j.aid, r: b.pts / ((L.v / me) * b.min) });
  }
  for (const com of Object.values(por)) {
    const q = com.filter((x) => x.r >= 1.15);
    if (com.length < 4 || !q.length || q.length > 2) continue;
    for (const p of q) {
      const outros = com.filter((x) => x !== p);
      const frac = outros.filter((x) => x.r < 0.85).length / outros.length;
      out[p.aid] = [frac >= 0.6 ? 2 : frac >= 0.4 ? 1 : 0, p.r >= 1.4 ? 1 : 0];
    }
  }
  return out;
}

function celulaCal(cal, t, pm, me) {
  const tb = cal.tempo.findIndex(([a, b]) => a <= t && t < b);
  const mb = cal.placar.filter((x) => pm > x).length;
  const rb = cal.papel.filter((x) => me >= x).length;
  return tb < 0 ? null : [tb, mb, rb];
}

// Estimativa de um jogador: feito, deveria (ritmo normal × minutos jogados) e linha justa ao fim.
// `agora` (agoraDe) liga a conta dos minutos que faltam pela rotação; `cal` = {tab: calibra_justa.json, pm: placarProj}
// troca o ajuste antigo do Q4 pelos fatores calibrados. Sem eles, a conta antiga.
export function estimar(j, box, rel, ajQ4, agora = null, cal = null) {
  const minEsp = minEspDe(j);
  const min = box?.min || 0;
  const fora = (box?.pf ?? 0) >= 6;
  const espQ = minutosQuarto(j);
  const c = cal?.tab?.minutos && cal.pm != null && rel.p >= 1 && rel.p <= 4 && !rel.fim ? celulaCal(cal.tab, rel.t, cal.pm, minEsp) : null;
  // minutos que ainda deve jogar: o esperado dos quartos que faltam (o atual pela parte que falta), Q4 ajustado pelo placar
  let minResto = 0, rot = null;
  if (!rel.fim && !fora && minEsp) {
    if (rel.p > 4) minResto = (minEsp / JOGO_S) * rel.resta * 1.2; // prorrogação: quem joga muito fica
    else {
      const cur = Math.max(1, rel.p);
      const fracCur = rel.p ? (720 * cur - rel.t) / 720 : 1;
      let base = 0, q4 = 0;
      for (let q = cur; q <= 4; q++) {
        const m = espQ[q - 1] * (q === cur ? fracCur : 1);
        base += m;
        if (q === 4) q4 = m;
      }
      rot = minRestoRotacao(j, rel, agora, minEsp, base);
      const m0 = rot ? rot.min : base;
      if (c) minResto = Math.min(m0 * cal.tab.minutos[c[0]][c[1]][c[2]], (JOGO_S - rel.t) / 60);
      else minResto = base > 0 ? m0 * (1 + (q4 / base) * (ajQ4 - 1)) : 0; // placar no Q4 só sobre a parte do Q4
    }
  }
  const minAgora = minEsp * Math.min(1, rel.t / JOGO_S);
  const est = {};
  for (const [k] of ESTATS) {
    const L = linhaPre(j, k);
    const feito = box?.[k] ?? 0;
    if (!L || !minEsp) { est[k] = { feito }; continue; }
    const taxa0 = L.v / minEsp;
    const K = c && k !== "pra" ? (cal.tab.K?.[k] ?? 1e9) : PESO_HOJE;
    const w = min > 0 ? min / (min + K) : 0;
    let taxa = (1 - w) * taxa0 + (min > 0 ? w * (feito / min) : 0);
    if (c && k !== "pra") taxa *= (cal.tab.nivel?.[k] ?? 1) * (cal.tab.ritmo?.[k]?.[c[0]]?.[c[1]]?.[c[2]] ?? 1);
    est[k] = { feito, deveria: taxa0 * min, justa: feito + taxa * minResto, pre: L.v, fonte: L.fonte };
  }
  // estrela nº 1/nº 2: fator por cima do que falta (no parelho do Q3 em diante ~1,07–1,15; no blowout ~0,7–0,85)
  const fe = c && cal.rank != null ? cal.tab.estrelas?.[cal.rank] : null;
  if (fe) for (const k of ["pts", "reb", "ast", "tpm"]) {
    const e = est[k], f = fe[k]?.[c[0]]?.[c[1]];
    if (e?.justa != null && f) e.justa = e.feito + (e.justa - e.feito) * f;
  }
  // faltas (11/11, usuário: pivô caçado por faltas no Q1): fator por grande/outro × quarto × faixa de faltas; grande = C/PF
  // ou 0,24+ rebote por minuto pela linha (pega pivôs registrados como F); também corrige os rebotes dos grandes (~0,9)
  const ff = c ? cal.tab.faltas : null;
  if (ff?.f) {
    const rebMin = (j.linhas?.rebounds?.l ?? 0) / minEsp;
    const grande = ["C", "PF"].includes(j.pos) || rebMin >= 0.24 ? 1 : 0;
    const q = Math.min(3, Math.floor(rel.t / 720));
    const fb = Math.min(3, ff.lim[q].filter((x) => (box?.pf ?? 0) >= x).length);
    for (const k of ["pts", "reb", "ast", "tpm"]) {
      const e = est[k], f = ff.f[k]?.[grande]?.[q]?.[fb];
      if (e?.justa != null && f) e.justa = e.feito + (e.justa - e.feito) * f;
    }
  }
  // formato individual de pontos (11/11, pedido do usuário; nba_pbp/calibrar_individual.py): o que ELE faz do quarto
  // atual até o fim e conforme o placar, além da liga (já com estrelas e faltas); só 80+ jogos, encolhido pelo que
  // repetiu entre metades dos jogos (correlação ~0,2), produto travado em 0,75–1,30. Rebotes/assistências/3PM não ganharam.
  const fi = c ? cal.tab.individual?.jogadores?.[j.aid]?.pts : null;
  if (fi && est.pts?.justa != null) {
    const q = Math.min(3, Math.floor(rel.t / 720)), a = Math.abs(cal.pm);
    const f = Math.min(1.3, Math.max(0.75, (fi[0]?.[q] ?? 1) * (fi[1]?.[a <= 5.5 ? 0 : a <= 15.5 ? 1 : 2] ?? 1)));
    est.pts.justa = est.pts.feito + (est.pts.justa - est.pts.feito) * f;
  }
  // começo dele × momento × placar (11/11: o que sobrou dos insights antigos medido contra a justa nova; repete entre
  // metades dos jogos, correlação +0,62) e quente com o time frio/meio/normal (só pontos e cestas de 3)
  if (c && rel.t >= 720 && min >= 4) {
    const co = rel.t < 1440 ? 0 : rel.t < 2160 ? 1 : 2, a = Math.abs(cal.pm), mb = a <= 5.5 ? 0 : a <= 15.5 ? 1 : 2;
    for (const k of ["pts", "reb", "ast", "tpm"]) {
      const e = est[k];
      if (e?.justa == null || !e.deveria || e.justa - e.feito <= 0.05) continue;
      const r = e.feito / e.deveria, fb = r < 0.6 ? 0 : r < 0.85 ? 1 : r < 1.15 ? 2 : r < 1.4 ? 3 : 4;
      let f = cal.tab.comeco?.[k]?.[co]?.[fb]?.[mb] ?? 1;
      if (cal.quente && cal.tab.time?.[k]) f *= cal.tab.time[k][co]?.[cal.quente[0]]?.[cal.quente[1]] ?? 1;
      e.justa = e.feito + (e.justa - e.feito) * f;
    }
  }
  // PRA calibrado = soma das três (foi assim que se mediu)
  if (c && ["pts", "reb", "ast"].every((k) => est[k].justa != null) && est.pra?.pre != null) {
    est.pra.justa = est.pts.justa + est.reb.justa + est.ast.justa;
  }
  return { minEsp, minAgora, minResto, espQ, est, rot, agora, calibrada: !!c };
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
      if (!v.length) { // sem estatística: DNP, ou (ao vivo) ainda não entrou — este fica com zeros para a linha justa ir caindo
        out[a.athlete.id] = a.didNotPlay === false ? { min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, pra: 0, pf: 0, starter: !!a.starter, sigla: t.team.abbreviation, nome: a.athlete.displayName, naoEntrou: true }
          : { dnp: true, sigla: t.team.abbreviation, nome: a.athlete.displayName };
        continue;
      }
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
  const tab = { bmais: b[0], bmenos: b[1], b5mais: b[3], b5menos: b[4], clutch: c[2] };
  // 11/11/2026: antes do jogo e no começo, a tabela minuto × placar não tem placares grandes (no 1º minuto para em +10)
  // e subestimava o favorito grande (SA −15,5: 24% × 50,5% medido pelo handicap). Antes do jogo vale a chance pelo
  // handicap (blowout_minuto.py, por_handicap); ao longo dos primeiros 12 min ela dá lugar à tabela.
  const ph = cm.por_handicap, h = hTime;
  if (!ph || h == null) return tab;
  const a = Math.abs(h), lado = h <= -3 ? "fav" : h >= 3 ? "zebra" : null;
  const f = lado ? ph[`${lado} ${a >= 10 ? "10+" : a >= 6 ? "6-9,5" : "3-5,5"}`] : ph["±2,5"];
  if (!f) return tab;
  const w = rel.t < 60 ? 1 : Math.max(0, 1 - rel.t / 720);
  const mix = (x, y) => Math.round(w * 100 * y + (1 - w) * x);
  return { bmais: mix(tab.bmais, f.bmais), bmenos: mix(tab.bmenos, f.bmenos), b5mais: mix(tab.b5mais, f.bmais5), b5menos: mix(tab.b5menos, f.bmenos5), clutch: mix(tab.clutch, f.clutch6) };
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
  const quentes = quentesDoJogo(g, box);
  for (const j of g.jogadores) {
    const b = box[j.aid];
    if (!b || b.dnp || b.pf >= 6) continue;
    const minEsp = minEspDe(j);
    const mg = margemDe(j.time);
    js.push({ j, b, mg, x: estimar(j, b, rel, ajusteQ4(minEsp, mg, rel, d.pol?.times?.[j.time]), agoraDe(s.plays || [], j.aid, b, rel, st), { tab: d.cal, pm: placarProj(g, j.time, mg, rel), rank: estrelasDe(g)[j.aid], quente: quentes[j.aid] }) });
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

// ---------- quadro de blowout e clutch (12/11/2026, usuário: "informações cruciais, claras e destacadas"; substitui a aba
// Blowout e clutch): cenário provável do jogo em destaque, medidores por time (blowout a favor/contra, clutch apertado,
// com o fator do técnico), a política do técnico (cenarios.json) e quem perde/ganha minutos no blowout e quem assume
// ou some no clutch. Blowout alto ≥ 40%, clutch alto ≥ 50% (mesmos níveis dos insights).
const nomeCurto = (n) => esc(String(n).split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w)).slice(-1)[0] || n);
function polChip(p) {
  if (!p) return "";
  const v = p.vs_liga;
  const [t, c] = v < 0.85 ? ["tira cedo", "var(--sig-u)"] : v > 1.15 ? ["mantém", "var(--sig-o)"] : ["padrão", "var(--ink-3)"];
  return `<span class="chip" title="${num(p.min)} min no Q4 dos titulares × ${num(p.normal)} em jogo normal (${p.n} jogos); ${num(v, 2)} × a liga" style="color:${c};border:1px solid ${c};background:transparent">${t}</span>`;
}
function medidor(rot, v, cor, extra = "") {
  return `<div class="bc-linha"><span class="bc-rot">${rot}</span><span class="bc-barra"><span style="width:${Math.min(100, v)}%;background:${cor}"></span></span><b class="bc-val" style="color:${cor}">${v}%</b>${extra ? `<small>${extra}</small>` : ""}</div>`;
}
function blowoutClutchHtml(g, chance, fat, lim, rel) {
  const times = [g.fora, g.casa].filter((t) => chance[t]);
  if (!times.length) return "";
  const v = Object.fromEntries(times.map((t) => { const c = chance[t], f = fat(t); return [t, { mais: lim(c.bmais * f.fator), menos: lim(c.bmenos * f.fator), mais5: lim(c.b5mais * f.fator), menos5: lim(c.b5menos * f.fator), clutch: lim(c.clutch * f.fator_clutch), f }]; }));
  const lider = times.reduce((a, b) => (v[b].mais > v[a].mais ? b : a));
  const bMax = v[lider].mais, cMed = Math.round(times.reduce((s, t) => s + v[t].clutch, 0) / times.length);
  const [cls, titulo, sub] = bMax >= 40 ? ["blow", `⚠ Blowout provável · ${bMax}%`, `${esc(lider)} tirar os titulares ganhando (5+ min antes do fim: ${v[lider].mais5}%). Titulares dos dois lados perdem minutos no Q4; reservas ganham.`]
    : cMed >= 50 ? ["clutch", `🔥 Fim apertado provável · ${cMed}%`, "Titulares até o fim e placar até 6 a 2:00 do fim: estrelas rendem mais, assistências caem."]
    : ["aberto", "Jogo em aberto", `blowout ${bMax}% · fim apertado ${cMed}%`];
  const papel = (t) => (g.handicap == null || g.handicap === 0 ? "" : (t === g.casa) === (g.handicap < 0) ? `favorito por ${num(Math.abs(g.handicap))}` : "azarão");
  const cards = times.map((t) => {
    const x = v[t], T = PAINEL.pol?.times?.[t];
    const pol = T ? `ganhando 16+: ${polChip(T.ganhando_atual || T.ganhando) || "<span class=\"muted\">poucos jogos</span>"} · perdendo 16+: ${polChip(T.perdendo_atual || T.perdendo) || "<span class=\"muted\">poucos jogos</span>"}` : "";
    const blow = Math.max(x.mais, x.menos) >= 25 && T ? `<p class="bc-quem"><b>No blowout</b> perdem minutos: ${(T.perdem || []).slice(0, 3).map((j) => `${nomeCurto(j.nome)} <small>${num(j.normal)}→${num(j.blowout)}</small>`).join(", ") || "–"} · ganham: ${(T.ganham || []).slice(0, 3).map((j) => `${nomeCurto(j.nome)} <small>${num(j.normal)}→${num(j.blowout)}</small>`).join(", ") || "–"}</p>` : "";
    const assume = (T?.clutch || []).filter((j) => j.uso >= 1.12 || j.pts >= 1.1).slice(0, 3), some = (T?.clutch || []).filter((j) => j.uso <= 0.88).slice(0, 2);
    const clu = x.clutch >= 30 && (assume.length || some.length) ? `<p class="bc-quem"><b>No fim apertado</b> assumem: ${assume.map((j) => `${nomeCurto(j.nome)} <small>uso ${Math.round(100 * j.parte_antes)}→${Math.round(100 * j.parte)}%</small>`).join(", ") || "–"}${some.length ? ` · somem: ${some.map((j) => nomeCurto(j.nome)).join(", ")}` : ""}</p>` : "";
    return `<div class="bc-time"><div class="bc-top"><b>${esc(t)}</b> <span class="muted">${papel(t)}</span> <small class="muted" title="fator do técnico sobre a liga">técnico ×${num(x.f.fator, 2)}</small></div>
      ${medidor("Blowout a favor", x.mais, "var(--warn)", `5+ min ${x.mais5}%`)}${medidor("Blowout contra", x.menos, "var(--warn)", `5+ min ${x.menos5}%`)}${medidor("Fim apertado", x.clutch, "var(--accent)")}
      ${pol ? `<p class="bc-quem">${pol}</p>` : ""}${blow}${clu}</div>`;
  }).join("");
  return `<div class="bc-vivo"><div class="bc-cenario ${cls}"><b>${titulo}</b><span>${sub}</span><small>${rel.p === 0 || rel.t < 60 ? "antes do jogo, pelo handicap do dia" : "agora, pelo placar e o tempo que falta (placar projetado pelo handicap)"}</small></div><div class="bc-grid">${cards}</div></div>`;
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
  const quentes = quentesDoJogo(g, box);
  for (const j of g.jogadores) {
    const b = box[j.aid];
    vistos.add(String(j.aid));
    // fora do jogo: sem jogar (DNP), ou jogo começado e ele nem aparece no box (inativo), ou Out no relatório
    if (b?.dnp || (!b && (Object.keys(box).length || out.includes(j.nome)) && st.type?.state !== "pre")) continue;
    const margem = placar[j.time] != null ? placar[j.time] - (Object.entries(placar).find(([k]) => k !== j.time)?.[1] ?? 0) : null;
    const minEsp = minEspDe(j);
    const x = estimar(j, b, rel, ajusteQ4(minEsp, margem, rel, PAINEL.pol?.times?.[j.time]), agoraDe(plays, j.aid, b, rel, st), { tab: PAINEL.cal, pm: placarProj(g, j.time, margem, rel), rank: estrelasDe(g)[j.aid], quente: quentes[j.aid] });
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
  const chanceH = rel.fim ? "" : blowoutClutchHtml(g, chance, fat, lim, rel);
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

const LEGENDA = `<p class="hint">Em cada estatística: <b>feito</b> / <b>deveria</b> (ritmo normal dele × minutos que já jogou) e a barra do ritmo (meio = no ritmo; <span style="color:var(--sig-o)">azul</span> = 15%+ acima, <span style="color:var(--sig-u)">laranja</span> = 15%+ abaixo; borda = 40%+). Embaixo: <b>linha justa</b> estimada para o fim × linha da DraftKings antes do jogo (<i>proj</i> = sem linha, projeção do Edgely). Linha justa = feito + ritmo × minutos que faltam; ritmo = normal dele (linha da DK ÷ minutos esperados) misturado com o de hoje (peso de hoje = min ÷ (min + K), K 100 em pontos e 60 no resto); minutos que faltam = pela rotação dele: nos 10 jogos anteriores em que, neste mesmo momento, ele estava no mesmo lugar (em quadra, ou no banco há pelo menos o mesmo tempo), quanto jogou depois; enquanto ele não volta do banco a linha vai caindo, se volta antes do normal sobe (sem jogos parecidos: o esperado dos quartos que faltam, com ajuste por ter jogado a mais ou a menos até aqui), e, por cima, fatores calibrados em ~1.400 jogos para minutos e ritmo conforme o momento, o placar projetado do time (placar + handicap pelo tempo que falta) e o papel dele: titular pesado perdendo/ganhando por 21+ no Q4 joga ~0,4–0,6 do previsto, parelho no fim ~1,3; assistências e cestas de 3 rendem menos que a linha, e o PRA é a soma das três. Minutos: jogou / esperado até agora · fim previsto; Q1–Q4 = minutos reais no quarto / esperados antes do jogo (total da nossa projeção de minutos — últimos jogos no time, quem está fora hoje, 240 min por time — repartido pela rotação dele nos últimos 10 jogos; quarto encerrado com 2+ min de diferença em cor; o quarto em andamento tem borda; os que faltam mostram só o esperado). Os minutos que faltam usam esses quartos. Compare a linha justa com a linha ao vivo da casa. Estimativa simples, não calibrada contra linhas ao vivo. Atualiza a cada 30 s com a aba aberta.</p>
<p class="hint"><b>Chance agora</b> (blowout = o time tira os titulares com 1:30+ faltando; clutch apertado = titulares até o fim e placar até 6 a 2:00): tabela da liga por minuto × placar em 2.448 jogos, com o placar projetado pelo handicap do dia e o fator do técnico (2025-26 + 2026-27, encolhido). <b>Linha justa calibrada</b> (11/11): além da rotação e do placar, entram fatores medidos em ~1.400 jogos com linha e conferidos fora da amostra: estrela nº 1/nº 2 conforme o placar (no parelho rende mais desde o Q3), faltas (por grande/outro, quarto e nº de faltas), formato individual de pontos (232 jogadores com 80+ jogos), começo dele (feito ÷ deveria) × momento × placar e, em pontos e cestas de 3, quente com o time frio. Os antigos insights ↑/↓ e os sinais com alvo foram desligados: o que deles se sustentou já está dentro da linha justa. Compare a justa com a linha ao vivo da casa (aba Casa × Painel).</p>`;

export async function mostrarPainel(el, dia, espn, forcar = false) {
  if (!dia || PAINEL.carregando || document.hidden) return;
  PAINEL.carregando = true;
  try {
    if (!PAINEL.pol) PAINEL.pol = await fetch("data/padroes/cenarios.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    if (!PAINEL.cm) PAINEL.cm = await fetch("data/padroes/chance_minuto.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
    // insights antigos (insights_painel/jogador/time) DESLIGADOS em 11/11: foram medidos contra a justa antiga e contavam
    // duas vezes o que a justa calibrada já tem; o que ainda se sustentou (começo × momento × placar, quente com o time)
    // virou fator da própria justa (calibra_justa.json). Setas, alvos e sinais ficam vazios.
    PAINEL.ins = PAINEL.ins || {}; PAINEL.jog = PAINEL.jog || {}; PAINEL.tim = PAINEL.tim || {};
    if (!PAINEL.cal) PAINEL.cal = await fetch("data/padroes/calibra_justa.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
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
