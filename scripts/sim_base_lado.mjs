// Taxa base do Simulador (18/11/2026): a linha justa é uma MÉDIA e o que falta é assimétrico (muitas formas de terminar
// um pouco abaixo, poucas de ir muito acima) → o final fica abaixo da justa mais da metade das vezes (87 jogos: Under
// 53–57% do Q1 ao intervalo, 59% no Q3 6:00, 72% no Q4 6:00). Com pagamento 1:1, "sempre Under" ganharia sem saber nada.
// Este script mede, em TODOS os jogadores da base do simulador, P(final > justa) por momento × estatística; a página
// paga cada lado com a odd justa dessa taxa (1 ÷ chance), e "sempre o mesmo lado" fica ≈ 0.
// Uso (no PC, rodar quando a base crescer): node scripts/sim_base_lado.mjs [pasta de cache dos summaries]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.argv[2] || "C:/Users/caval/nba_pbp_dados/sim_summary";
fs.mkdirSync(CACHE, { recursive: true });
const fetchReal = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (/^https?:/.test(u)) return fetchReal(u, o);
  const p = path.join(SITE, String(u).split("?")[0]);
  return { ok: fs.existsSync(p), status: 200, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
globalThis.localStorage ??= { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } };
const { congelar, MOMENTOS } = await import(pathToFileURL(path.join(SITE, "js/simulador.js")));
const P = await import(pathToFileURL(path.join(SITE, "js/painel.js")));
await P.tabelasPainel();

const idx = JSON.parse(fs.readFileSync(path.join(SITE, "data/padroes/sim/indice.json"), "utf8"));
const cont = {};
const LIN = [];
let jogos = 0;
for (const q of idx.jogos) {
  const f = path.join(CACHE, `${q.id}.json`);
  let s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  if (!s?.header?.competitions?.[0]?.status?.type?.completed) {
    s = await fetchReal(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${q.id}`).then((r) => r.json()).catch(() => null);
    if (!s?.header?.competitions?.[0]?.status?.type?.completed) continue;
    fs.writeFileSync(f, JSON.stringify(s));
  }
  const g = JSON.parse(fs.readFileSync(path.join(SITE, `data/padroes/sim/${q.data}.json`), "utf8")).jogos.find((x) => x.id === q.id);
  if (!g) continue;
  jogos++;
  const fin = P.lerBox(s);
  for (const m of MOMENTOS) {
    const r = P.painelCongelado(g, congelar(s, m));
    for (const [aid, j] of Object.entries(r.ctx.jogadores)) {
      const b = fin[aid];
      if (!b || b.dnp) continue;
      for (const k of ["pts", "reb", "ast", "tpm", "pra"]) {
        const e = j.est[k];
        if (e.justa == null) continue;
        const L = Math.round(e.justa * 10) / 10;
        if (b[k] === L) continue;
        // por momento × estatística e, mais fino, × estado (em quadra/banco × titular/reserva): no Q4 6:00 quem está no
        // banco quase não passa mais da justa — sem separar, "em quadra → Over" pagava +36% sem ler nada (18/11)
        for (const ch of [`${m.k}|${k}`, `${m.k}|${k}|${j.quadra ? 1 : 0}${j.tit ? 1 : 0}`]) {
          const c = (cont[ch] ||= [0, 0]);
          c[0]++;
          if (b[k] > L) c[1]++;
        }
        // linhas .5 em volta da justa (a mais perto e ±1) para recalibrar a chance do modelo (ver abaixo)
        for (const d of [-1, 0, 1]) {
          const Lm = Math.floor(e.justa) + 0.5 + d;
          if (Lm < e.feito + 0.5) continue;
          const c = P.chanceJusta(aid, m.t, k, e, Lm);
          if (c) LIN.push({ m: m.k, k, o: c.over, y: b[k] > Lm ? 1 : 0, est: `${j.quadra ? 1 : 0}${j.tit ? 1 : 0}`, rem: e.justa - e.feito });
        }
      }
    }
  }
}
const base = Object.fromEntries(Object.entries(cont).map(([ch, [n, o]]) => [ch, [Math.round((o / n) * 1e4) / 1e4, n]]));
// 18/11 (usuário: "transforma a projeção em odd de Over e Under", linhas de 0,5 em 0,5): a chance do modelo (dispersão
// em volta da justa, a mesma da Casa × Painel) dava o Over BAIXO nestes jogos (pontos 37,9% × real 42,4%; Q4 6:00 24% ×
// 31%) → "sempre Over" na odd do modelo +12% a +17% (Q4 +40–50%). Recalibração logística por momento:
// logit(P real) = b·logit(P modelo) + a[estatística] + c[estado] + d[falta < 0,5] + e[falta 0,5–1]; ajuste nos pares ×
// teste nos ímpares: sempre Over +1% a +5%, sempre Under −1% a −4% (era +12–17% / −2 a −7%). Grava ajustado em todos.
const KS = ["pts", "reb", "ast", "tpm", "pra"], ES = ["10", "01", "00"];
const lg = (p) => { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); };
const sg = (x) => 1 / (1 + Math.exp(-x));
const feat = (r) => [lg(r.o), ...KS.map((k) => (r.k === k ? 1 : 0)), ...ES.map((e) => (r.est === e ? 1 : 0)), r.rem < 0.5 ? 1 : 0, r.rem >= 0.5 && r.rem < 1 ? 1 : 0];
function resolver(A, b) {
  const n = b.length; A = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let mx = i; for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[mx][i])) mx = j;
    [A[i], A[mx]] = [A[mx], A[i]];
    for (let j = i + 1; j < n; j++) { const f = A[j][i] / A[i][i]; for (let c = i; c <= n; c++) A[j][c] -= f * A[i][c]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = A[i][n]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
function ajustar(rows) {
  const X = rows.map(feat), y = rows.map((r) => r.y), n = X[0].length;
  let w = Array(n).fill(0); w[0] = 1;
  for (let it = 0; it < 30; it++) {
    const H = Array.from({ length: n }, () => Array(n).fill(0)), g = Array(n).fill(0);
    X.forEach((x, i) => {
      const p = sg(x.reduce((s, v, j) => s + v * w[j], 0)), d = y[i] - p, ww = p * (1 - p) + 1e-9;
      for (let a = 0; a < n; a++) { g[a] += d * x[a]; for (let b2 = 0; b2 < n; b2++) H[a][b2] += ww * x[a] * x[b2]; }
    });
    for (let a = 0; a < n; a++) H[a][a] += 1e-3 + (a > 0 ? 2 : 0); // encolhe um pouco os interceptos
    const st = resolver(H, g);
    w = w.map((v, j) => v + st[j]);
    if (Math.max(...st.map(Math.abs)) < 1e-6) break;
  }
  return w.map((v) => Math.round(v * 1e4) / 1e4);
}
const recal = { gerado_em: new Date().toISOString(), termos: "logit(P modelo), pts/reb/ast/tpm/pra, estado 10/01/00 (quadra·titular; 11 = base), falta < 0,5, falta 0,5–1", w: {} };
for (const m of MOMENTOS) { const r = LIN.filter((x) => x.m === m.k); if (r.length > 200) recal.w[m.k] = ajustar(r); }
fs.writeFileSync(path.join(SITE, "data/padroes/sim/base_lado.json"), JSON.stringify({ gerado_em: new Date().toISOString(), jogos, base, recal }));
console.log("recalibração:", Object.entries(recal.w).map(([m, w]) => `${m} b ${w[0]}`).join(" · "), `(${LIN.length} linhas)`);
console.log(`base_lado.json: ${jogos} jogos, ${Object.keys(base).length} células`);
for (const m of MOMENTOS) console.log(m.nome.padEnd(10), ["pts", "reb", "ast", "tpm", "pra"].map((k) => `${k} ${Math.round(100 * (base[`${m.k}|${k}`]?.[0] ?? 0))}%`).join("  "), "| pts quadra·tit/quadra·res/banco·tit/banco·res", ["11", "10", "01", "00"].map((e) => `${Math.round(100 * (base[`${m.k}|pts|${e}`]?.[0] ?? 0))}%`).join("/"));
