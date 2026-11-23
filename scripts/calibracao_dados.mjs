// Dados da aba "Calibração" (padroes.html, 23/11/2026). Entrada: <dados>/calibracao_int.json de nba_pbp/calibracao_site.py
// (base viva, temporada atual: justa do site, feito e final por jogador-jogo × momento). Aqui, com o código do site
// (js/painel.js chanceLinha + calibra_justa.json), a chance de Over que o modelo dá na PRÓPRIA justa em cada momento —
// o "esperado" (a justa é média e a contagem é assimétrica: calibrado ≠ 50%).
// Saída: data/padroes/calibracao/meta.json (jogadores-jogo, estado por momento) e <estatística>.json (d = (final − justa)
// × 10, inteiro com o sinal preservado; p = chance de Over esperada × 1000), índice = jogador-jogo × nº de momentos + momento.
// Uso: node scripts/calibracao_dados.mjs <calibracao_int.json>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = await import(pathToFileURL(path.join(SITE, "js/painel.js")));
const TAB = JSON.parse(fs.readFileSync(path.join(SITE, "data/padroes/calibra_justa.json"), "utf8"));
const ent = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const KS = ent.ks;
const NM = ent.grade.length;
const out = path.join(SITE, "data/padroes/calibracao");
fs.mkdirSync(out, { recursive: true });

const d = Object.fromEntries(KS.map((k) => [k, []]));
const p = Object.fromEntries(KS.map((k) => [k, []]));
const est = [];
const t0 = Date.now();
ent.jog.forEach((j, i) => {
  const rows = ent.rows[i];
  rows.forEach(([quadra, mg, f4, js], m) => {
    const t = ent.grade[m];
    const feito = [...f4, f4[0] + f4[1] + f4[2]];
    const am = Math.abs(mg ?? 0);
    est.push((quadra ? 1 : 0) + 2 * (am <= 6 ? 0 : am < 15 ? 1 : 2));
    KS.forEach((k, ki) => {
      const justa = js[ki], fin = j.fin[ki];
      if (justa == null || fin == null) { d[k].push(null); p[k].push(null); return; }
      const dif = fin - justa;
      let v = Math.round(dif * 10);
      if (v === 0 && dif !== 0) v = dif > 0 ? 1 : -1;
      d[k].push(v);
      const mu = Math.max(justa - feito[ki], 0);
      const ctx = { quadra: !!quadra, tit: !!j.tit, mg, pre: j.pre[k] ? { l: j.pre[k][0], over: j.pre[k][1] } : null };
      const ch = P.chanceLinha(TAB, j.a, t, [[k, mu]], feito[ki], justa, ctx);
      p[k].push(Math.round((ch?.over ?? 0) * 1000));
    });
  });
});
const jog = ent.jog.map((j) => [j.g, j.d, j.a, j.tm, j.op, j.pos, j.gr, j.tit, KS.reduce((s, k, i) => s + (j.pre[k] ? 1 << i : 0), 0), ...j.fin]);
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({
  gerado: new Date().toISOString().slice(0, 16), base: ent.base, grade: ent.grade, ks: KS,
  campos: "g, dia, aid, time, adversário, posição (G/F/C), grande, titular, linha DK (bit por estatística), finais",
  est: "por jogador-jogo × momento: quadra (1) + 2 × placar do time (0: até 6, 1: 7–14, 2: 15+)",
  jog, nomes: ent.nomes, est_m: est,
}));
for (const k of KS) fs.writeFileSync(path.join(out, `${k}.json`), JSON.stringify({ d: d[k], p: p[k] }));
const tam = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0);
console.log(`${ent.jog.length} jogadores-jogo × ${NM} momentos em ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out} (meta ${tam("meta.json")} KB, pts ${tam("pts.json")} KB)`);
