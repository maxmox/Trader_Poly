// Backtest FORA DA AMOSTRA da confiança 0–100 da aba Filtros (js/filtros.js: evidencias + decidir), 24/10/2026.
// Para cada noite de teste, a simulação dos filtros é refeita SÓ com as outras noites e aplicada às linhas da noite de
// teste no fechamento (linha e odds ~10 min antes do jogo):
//   - "adiante": treina com as noites ANTERIORES (o que a página faria de verdade naquele dia);
//   - "uma fora": treina com todas as outras noites (mais dados de teste; supõe que o mercado não mudou entre as noites).
// Mede, por faixa de confiança: apostas, ROI (IC 95% por sorteio de jogos), ROI esperado médio (calibração) e o mesmo
// conjunto de linhas apostado no Under em tudo (régua: o sinal acrescenta algo além de "Under"?).
// O objetivo NÃO é achar os parâmetros que mais lucram: é ver se a confiança ordena (mais confiança → mais ROI) e se o
// "ROI esperado" bate com o realizado; os parâmetros só mudam se o ordenamento/calibração pedir.
// Local: node scripts/backtest_confianca.mjs   (GRADE=1 roda a grade de parâmetros)
import { readFile } from "node:fs/promises";
import { simular, evidencias, decidir, persistencia, PARAM } from "../js/filtros.js";
import { resultadoA } from "../js/core.js";

const raiz = new URL("../", import.meta.url);
const ler = (n) => readFile(new URL(`data/apostas_edgely/${n}`, raiz), "utf8").then(JSON.parse).catch(() => null);
const ind = await ler("indice.json");
const props = [];
for (const m of ind.meses) {
  const M = await ler(`mercado-${m}.json`);
  if (!M) continue;
  const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
  for (const a of M.props) {
    const j = M.jogos[a[C.jogo]] || {};
    props.push({ jogo: a[C.jogo], dia: j.dia, tipo: a[C.tipo], L0: a[C.L0], O0: a[C.O0], U0: a[C.U0], L1: a[C.L1], O1: a[C.O1], U1: a[C.U1], proj12: a[C.proj12], proj30: a[C.proj30], real: a[C.real], L12: a[C.L12] ?? null, O12: a[C.O12] ?? null, U12: a[C.U12] ?? null });
  }
}
const dias = [...new Set(props.map((x) => x.dia))].sort();
const lucro = (x, l) => { const o = l === "O" ? x.O1 : x.U1, r = o && (x.L1 != null || x.tipo === "jogo-ml") ? resultadoA(x.tipo, x.real, x.L1) : null; return r == null ? null : r === 0 ? 0 : (r > 0) === (l === "O") ? o - 1 : -1; };
const temUnder = (x) => x.tipo !== "jogo-spread" && x.tipo !== "jogo-ml";

// simulações por dobra (cache: a simulação é a parte cara)
const sims = new Map();
// simulação E persistência só com as noites de treino (a persistência deixa cada noite de treino de fora por vez)
const simDe = (treino) => { const k = treino.join(","); if (!sims.has(k)) { const T = props.filter((x) => treino.includes(x.dia)).map((x) => ({ ...x })); sims.set(k, { sim: simular(T, 300), pers: persistencia(T) }); } return sims.get(k); };
const DOBRAS = {
  adiante: dias.slice(1).map((d) => ({ teste: d, treino: dias.filter((e) => e < d) })),
  "uma fora": dias.map((d) => ({ teste: d, treino: dias.filter((e) => e !== d) })),
};

function rodar(modo, P, minN) {
  const out = [];
  for (const { teste, treino } of DOBRAS[modo]) {
    const { sim, pers } = simDe(treino);
    for (const x0 of props) {
      if (x0.dia !== teste || x0.real == null) continue;
      const x = { ...x0 }; // o filtro guarda o movimento em x._m: cópia limpa por dobra
      const d = decidir(evidencias(x, minN, sim, P, pers));
      if (!d) continue;
      const l = lucro(x, d.lado);
      if (l == null) continue;
      out.push({ jogo: x.jogo, dia: x.dia, tipo: x.tipo, fora: d.filtros > 0, conf: d.conf, esp: d.esperado, lado: d.lado, l, lu: temUnder(x) ? lucro(x, "U") : null, lo: lucro(x, d.lado === "O" ? "U" : "O") });
    }
  }
  return out;
}
function est(v, campo = "l") {
  const w = v.filter((r) => r[campo] != null);
  if (!w.length) return null;
  const por = new Map();
  for (const r of w) { const q = por.get(r.jogo) || por.set(r.jogo, { l: 0, n: 0 }).get(r.jogo); q.l += r[campo]; q.n++; }
  const J = [...por.values()], rs = [];
  for (let b = 0; b < 1000 && J.length >= 5; b++) { let l = 0, n = 0; for (let i = 0; i < J.length; i++) { const q = J[(Math.random() * J.length) | 0]; l += q.l; n += q.n; } rs.push(l / n); }
  rs.sort((a, b) => a - b);
  return { n: w.length, roi: w.reduce((t, r) => t + r[campo], 0) / w.length, ic: rs.length ? [rs[25], rs[974]] : null };
}
const pc = (v) => (v == null ? "   –  " : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1)}%`.padStart(7));
const FAIXAS = [[0, 20], [20, 40], [40, 60], [60, 101]];
function relatorio(rot, R) {
  console.log(`\n## ${rot}: ${R.length} linhas com sinal (${[...new Set(R.map((r) => r.dia))].join(", ")})`);
  console.log("  confiança   apostas   ROI      IC 95%              esperado  | mesmas linhas: Under em tudo · lado oposto | Under/Over");
  for (const [a, b] of [...FAIXAS, [0, 101]]) {
    const v = R.filter((r) => r.conf >= a && r.conf < b), s = est(v);
    if (!s) continue;
    const u = est(v, "lu"), o = est(v, "lo"), nu = v.filter((r) => r.lado === "U").length;
    console.log(`  ${a === 0 && b === 101 ? "todas    " : `${String(a).padStart(3)}–${String(b === 101 ? 100 : b - 1).padStart(3)}  `}  ${String(s.n).padStart(5)}  ${pc(s.roi)}  [${s.ic ? `${pc(s.ic[0])} ${pc(s.ic[1])}` : "        –        "}]  ${pc(v.reduce((t, r) => t + r.esp, 0) / v.length)}  |  ${pc(u?.roi)} · ${pc(o?.roi)}  | ${nu}/${v.length - nu}`);
  }
  for (const d of [...new Set(R.map((r) => r.dia))]) {
    const v = R.filter((r) => r.dia === d), s40 = est(v.filter((r) => r.conf >= 40)), s = est(v);
    console.log(`  noite ${d}: todas ${pc(s?.roi)} (${s?.n ?? 0}) · conf ≥ 40 ${pc(s40?.roi)} (${s40?.n ?? 0})`);
  }
}

console.log(`Arquivo: ${props.length} linhas, noites ${dias.join(", ")}. Parâmetros atuais: ${JSON.stringify(PARAM)}`);
for (const modo of ["adiante", "uma fora"]) {
  const R = rodar(modo, PARAM, 30);
  relatorio(`${modo} · TODAS as linhas (lado = margem + filtros com peso)`, R);
  relatorio(`${modo} · só FORA DO PADRÃO (filtros com peso somam algo além da margem)`, R.filter((r) => r.fora));
  if (modo === "uma fora") for (const { teste, treino } of DOBRAS[modo]) console.log(`  pesos treinando com ${treino.join(" + ")}: ${Object.entries(simDe(treino).pers).filter(([, q]) => q.b > 0).map(([g, q]) => `${g} ${q.b.toFixed(2)}`).join(", ") || "nenhum grupo com peso"}`);
}

if (process.env.GRADE === "1") {
  console.log("\n# GRADE (uma fora): só o τ (encolhimento) — procura ORDENAMENTO por faixa, não o máximo");
  for (const tau of [0.03, 0.06, 0.1]) for (const minN of [10, 30, 60]) {
    const R = rodar("uma fora", { ...PARAM, tau }, minN);
    const cel = (v) => (v.length ? `${pc(v.reduce((t, r) => t + r.l, 0) / v.length)}(${String(v.length).padStart(4)})` : "     –      ");
    console.log(`  tau ${tau.toFixed(2)} minN ${String(minN).padStart(3)} | ${FAIXAS.map(([a, b]) => cel(R.filter((r) => r.conf >= a && r.conf < b))).join(" ")} | fora do padrão ${cel(R.filter((r) => r.fora))}`);
  }
}
