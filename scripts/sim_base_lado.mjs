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
      }
    }
  }
}
const base = Object.fromEntries(Object.entries(cont).map(([ch, [n, o]]) => [ch, [Math.round((o / n) * 1e4) / 1e4, n]]));
fs.writeFileSync(path.join(SITE, "data/padroes/sim/base_lado.json"), JSON.stringify({ gerado_em: new Date().toISOString(), jogos, base }));
console.log(`base_lado.json: ${jogos} jogos, ${Object.keys(base).length} células`);
for (const m of MOMENTOS) console.log(m.nome.padEnd(10), ["pts", "reb", "ast", "tpm", "pra"].map((k) => `${k} ${Math.round(100 * (base[`${m.k}|${k}`]?.[0] ?? 0))}%`).join("  "), "| pts quadra·tit/quadra·res/banco·tit/banco·res", ["11", "10", "01", "00"].map((e) => `${Math.round(100 * (base[`${m.k}|pts|${e}`]?.[0] ?? 0))}%`).join("/"));
