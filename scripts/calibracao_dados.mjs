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
// Células para a Casa × Painel (23/11/2026, pedido do usuário): por estatística × titular × linha DK × quadra × placar
// do time (até 6 / 7–14 / 15+) × momento, janela de ±2 min em volta de cada momento da grade: n (linhas), Over real,
// esperado e o erro-padrão da diferença (real − esperado) agrupado por jogo. Chave "k|tit|dk|quadra|placar".
const JAN = 120;
const cel = {};
ent.jog.forEach((j, i) => {
  const jj = jog[i];
  KS.forEach((k, ki) => {
    const dk = (jj[8] >> ki) & 1;
    for (let m = 0; m < NM; m++) {
      const x = d[k][i * NM + m];
      if (x == null) continue;
      const e = est[i * NM + m];
      const chave = `${k}|${j.tit ? 1 : 0}|${dk}|${e & 1}|${e >> 1}`;
      const arr = (cel[chave] ||= ent.grade.map(() => ({ n: 0, o: 0, p: 0, g: new Map(), pj: new Set() })));
      const t = ent.grade[m], o = x > 0 ? 1 : 0, pp = p[k][i * NM + m] / 1000;
      ent.grade.forEach((tc, mc) => {
        if (Math.abs(tc - t) > JAN) return;
        const c = arr[mc];
        c.n++; c.o += o; c.p += pp; c.pj.add(i);
        const gg = c.g.get(j.g) || [0, 0]; gg[0]++; gg[1] += o - pp; c.g.set(j.g, gg);
      });
    }
  });
});
// Jogador e time (23/11/2026, usuário: "é para olhar o time e o jogador"): o jogo todo (todos os momentos), como a lista de
// jogadores da aba. Jogador: aid|k (todas as situações). Time: time|k|linha DK|placar do momento (e time|k|dk|* = qualquer placar).
const agr = {};
const somaAgr = (chave, gid, pj, o, pp) => {
  const c = (agr[chave] ||= { n: 0, o: 0, p: 0, g: new Map(), pj: new Set() });
  c.n++; c.o += o; c.p += pp; c.pj.add(pj);
  const gg = c.g.get(gid) || [0, 0]; gg[0]++; gg[1] += o - pp; c.g.set(gid, gg);
};
ent.jog.forEach((j, i) => {
  const jj = jog[i];
  KS.forEach((k, ki) => {
    const dk = (jj[8] >> ki) & 1;
    for (let m = 0; m < NM; m++) {
      const x = d[k][i * NM + m];
      if (x == null) continue;
      const o = x > 0 ? 1 : 0, pp = p[k][i * NM + m] / 1000, pl = est[i * NM + m] >> 1;
      somaAgr(`j|${j.a}|${k}`, j.g, i, o, pp);
      somaAgr(`t|${j.tm}|${k}|${dk}|${pl}`, j.g, i, o, pp);
      somaAgr(`t|${j.tm}|${k}|${dk}|*`, j.g, i, o, pp);
    }
  });
});
const fechar = (c) => {
  const dif = (c.o - c.p) / c.n;
  let s2 = 0;
  for (const [n, z] of c.g.values()) s2 += (z - n * dif) ** 2;
  return [c.pj.size, Math.round((1000 * c.o) / c.n), Math.round((1000 * c.p) / c.n), Math.round((1000 * Math.sqrt(s2)) / c.n), c.g.size];
};
const jogOut = {}, timeOut = {};
for (const [chave, c] of Object.entries(agr)) (chave[0] === "j" ? jogOut : timeOut)[chave.slice(2)] = fechar(c);
const celOut = {};
for (const [chave, arr] of Object.entries(cel)) {
  celOut[chave] = arr.map((c) => {
    if (!c.n) return [0, 0, 0, 0];
    const dif = (c.o - c.p) / c.n;
    let s2 = 0;
    for (const [n, z] of c.g.values()) s2 += (z - n * dif) ** 2;
    return [c.pj.size, Math.round((1000 * c.o) / c.n), Math.round((1000 * c.p) / c.n), Math.round((1000 * Math.sqrt(s2)) / c.n)];
  });
}
fs.writeFileSync(path.join(out, "celulas.json"), JSON.stringify({
  gerado: new Date().toISOString().slice(0, 16), grade: ent.grade, janela_s: JAN, dias: [ent.jog[0].d, ent.jog[ent.jog.length - 1].d],
  leia: "c[k|titular|linha DK|em quadra|placar 0:≤6 1:7–14 2:15+][momento] = [n jogadores-jogo, Over real ‰, esperado ‰, erro-padrão da diferença ‰ (por jogo)]",
  c: celOut,
  jog: jogOut, time: timeOut,
  leia_jt: "jog[aid|k] e time[time|k|linha DK|placar 0/1/2 ou *] = [n jogadores-jogo, Over real ‰, esperado ‰, erro-padrão ‰ por jogo, jogos], jogo todo",
}));
const tam = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0);
console.log(`células ${Object.keys(celOut).length} (${tam("celulas.json")} KB); ${ent.jog.length} jogadores-jogo × ${NM} momentos em ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out} (meta ${tam("meta.json")} KB, pts ${tam("pts.json")} KB)`);
