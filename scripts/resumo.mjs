// Resumos das abas Acompanhamento e Filtros de props.html (24/10/2026): a página lia a temporada inteira e simulava no
// navegador (~37 MB e vários segundos em abril). Roda na Action depois de apostas_edgely.mjs e grava, só no site
// publicado (data/resumo/ fica fora do git: é derivado de data/apostas_edgely/):
//   data/resumo/acomp.json       placar, recortes e comportamento já somados + a lista de jogos (js/acompanhamento.js: montarResumo)
//   data/resumo/jogos/<id>.json  as linhas e as apostas de UM jogo, baixado quando ele é aberto na página
//   data/resumo/filtros.json     simulação dos filtros, persistência e retratos das 12 h (js/filtros.js: montarFiltros)
// Local: node scripts/resumo.mjs
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { montarDados, montarResumo } from "../js/acompanhamento.js";
import { propsDoArquivo, montarFiltros } from "../js/filtros.js";

const raiz = new URL("../", import.meta.url), DIR = new URL("data/apostas_edgely/", raiz), OUT = new URL("data/resumo/", raiz);
const ler = (n) => readFile(new URL(n, DIR), "utf8").then(JSON.parse).catch(() => null);
// números com 4 casas no máximo (a simulação tem ROI e intervalos com 16): arquivo ~30% menor
const json = (o) => JSON.stringify(o, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v));
const t0 = Date.now();
const ind = await ler("indice.json");
const meses = ind?.meses || [];
const ms = await Promise.all(meses.map((m) => ler(`${m}.json`))), mk = await Promise.all(meses.map((m) => ler(`mercado-${m}.json`)));

await rm(OUT, { recursive: true, force: true });
await mkdir(new URL("jogos/", OUT), { recursive: true });

// Acompanhamento
const dados = montarDados(ms, mk);
const acomp = montarResumo(dados);
await writeFile(new URL("acomp.json", OUT), json(acomp));
// detalhe de cada jogo: o mesmo formato dos arquivos do mês, só com aquele jogo (a página usa montarDados nele)
const sub = (M, id, chave) => {
  if (!M) return null;
  const C = Object.fromEntries(M.campos.map((k, i) => [k, i])), rows = M[chave].filter((a) => a[C.jogo] === id);
  const nomes = {};
  for (const a of rows) { const at = a[C.atleta]; if (M.nomes[at]) nomes[at] = M.nomes[at]; }
  return { campos: M.campos, jogos: M.jogos[id] ? { [id]: M.jogos[id] } : {}, nomes, [chave]: rows };
};
const vazio = (chave) => ({ campos: ["jogo"], jogos: {}, nomes: {}, [chave]: [] });
let nj = 0;
for (const g of acomp.jogos) {
  const i = meses.indexOf((g.dia || "").slice(0, 7));
  const ap = (i >= 0 && sub(ms[i], g.id, "apostas")) || vazio("apostas"), mm = (i >= 0 && sub(mk[i], g.id, "props")) || vazio("props");
  await writeFile(new URL(`jogos/${g.id}.json`, OUT), JSON.stringify({ ap, mk: mm }));
  nj++;
}

// Filtros
const filtros = montarFiltros(propsDoArquivo(mk), ms.slice(-2));
await writeFile(new URL("filtros.json", OUT), json(filtros));

const kb = (o) => `${Math.round(json(o).length / 1024)} KB`;
console.log(`Resumo: acomp ${kb(acomp)} (${acomp.jogos.length} jogos), ${nj} detalhes de jogo, filtros ${kb(filtros)} · ${Date.now() - t0} ms`);
