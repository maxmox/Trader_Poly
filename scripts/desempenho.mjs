// Desempenho recente (7 e 30 dias) de cada trader do site, só nas entradas que teriam
// virado sinal: especialidade/nicho dele e o momento da lista (pré-jogo ou ao vivo).
// Para cada entrada resolvida: acertou?, ROI dele, ROI de quem copiasse 1 min depois
// (1º negócio de compra após 60 s + 0,5¢, só se ficou até a odd mínima) e a nota da entrada.
// Roda na GitHub Action (sem bloqueio de DNS). Local: RELAY=https://... node scripts/desempenho.mjs
import { readFile, writeFile } from "node:fs/promises";
import {
  criarApi, vigentes, esporte, liberado, tipoDoMercado, inicioDoMercado, volumeDoMercado,
  resultadoMercado, entradasDe, precosEntrada, tetoDe, pisoDe, notaEntrada, descreverAposta, custoCopia, tamanhoAposta,
} from "../core.js";

const raiz = new URL("../", import.meta.url);
const ler = async (p) => JSON.parse(await readFile(new URL(p, raiz), "utf8"));
const api = criarApi({ relay: process.env.RELAY || "", timeoutMs: 30000 });
const DIAS = 30, MAX_ENTRADAS = 80, SLIP = 0.005;
const agora = Date.now();

const prefixos = await ler("data/prefixos.json");
const indices = await ler("data/indices.json").catch(() => null);
const listas = [
  ...vigentes((await ler("data/traders.json")).traders).map((t) => ({ t, momento: "pré-jogo" })),
  ...vigentes((await ler("data/traders_live.json")).traders).map((t) => ({ t, momento: "ao vivo" })),
];
const eventos = new Map();
async function evento(slug) {
  if (!eventos.has(slug)) eventos.set(slug, api.get("gamma", `/events?slug=${encodeURIComponent(slug)}`).then((r) => r?.[0] || null).catch(() => null));
  return eventos.get(slug);
}

async function atividade(w) {
  const out = [];
  for (let off = 0; off < 1500; off += 500) {
    const p = await api.get("data", `/activity?user=${w}&type=TRADE&limit=500&offset=${off}`).catch(() => null);
    if (!p?.length) break;
    out.push(...p);
    if (p.length < 500 || p[p.length - 1].timestamp * 1000 < agora - DIAS * 864e5) break;
  }
  return out;
}

function resumo(L) {
  const res = L.filter((x) => x.res != null);
  const cop = res.filter((x) => x.roiCopia != null);
  const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return {
    entradas: L.length, abertas: L.length - res.length, resolvidas: res.length,
    acertos: res.filter((x) => x.res === 1).length,
    roi_dele: media(res.map((x) => x.roiDele)), copiaveis: cop.length, roi_copia: media(cop.map((x) => x.roiCopia)),
    // odd média: 35/35 acertos com odd 1,08 é favorito pesado, não habilidade rara
    odd_media: res.length ? res.length / res.reduce((s, x) => s + x.precoDele, 0) : null,
  };
}

async function trader({ t, momento }) {
  const ativ = await atividade(t.carteira);
  const linhas = [];
  for (const e of entradasDe(ativ)) {
    if (e.t0 * 1000 < agora - DIAS * 864e5 || linhas.length >= MAX_ENTRADAS) break;
    if (!(e.preco > 0.02 && e.preco < 0.98)) continue;
    // aposta simbólica nunca vira sinal, então também não entra no placar
    const tamanho = tamanhoAposta(e.usdTotal, indices?.mediana_total?.[t.carteira]);
    if (tamanho?.classe === "simbolica") continue;
    const x = e.ex, ev = await evento(x.eventSlug);
    const sp = esporte(x.eventSlug || x.slug, ev, prefixos), tipo = tipoDoMercado(ev, x.slug), inicio = inicioDoMercado(ev, x.slug);
    const mom = inicio == null ? "–" : e.t0 * 1000 >= inicio ? "ao vivo" : "pré-jogo";
    if (mom !== momento || !liberado(t, sp, tipo, mom).ok) continue;
    const res = resultadoMercado(ev, x.slug, x.outcomeIndex);
    const l = { t0: e.t0 * 1000, evento: ev?.title || x.title, lado: descreverAposta(x.title, x.outcome), slug: x.slug, eventSlug: x.eventSlug, esporte: sp, tipo,
      precoDele: e.preco, usd: e.usd, res, roiDele: res == null ? null : res / e.precoPago - 1, roiCopia: null, pCopia: null, nota: null };
    if (res != null) {
      const { p60, antes } = await precosEntrada(api, x.conditionId, x.asset, t.carteira, e.t0);
      // quem copia paga o preço negociado 1 min depois + a taxa de taker
      if (p60 != null && p60 <= tetoDe(e.preco) && p60 >= pisoDe(e.preco) && custoCopia(p60) < 0.99) { l.pCopia = p60; l.roiCopia = res / custoCopia(p60) - 1; }
      const n = notaEntrada({ precoDele: e.preco, usdEntrada: e.usd, valorDele: e.usdTotal, tamanho, antes, momento: mom, volMercado: volumeDoMercado(ev, x.slug),
        ask: p60 ?? e.preco, inicio, entrouEm: e.t0 * 1000 }, t, indices);
      if (n) l.nota = { nota: n.nota, rotulo: n.rotulo };
    }
    linhas.push(l);
  }
  const d7 = linhas.filter((l) => l.t0 >= agora - 7 * 864e5);
  const s30 = resumo(linhas);
  const forma = s30.copiaveis < 8 ? "pouca amostra" : s30.roi_copia > 0.03 ? "entregando" : s30.roi_copia < -0.10 ? "abaixo" : "na média";
  const porNota = {};
  for (const r of ["forte", "boa", "neutra", "fraca"]) porNota[r] = resumo(linhas.filter((l) => l.nota?.rotulo === r));
  return [t.carteira, { nome: t.nome, momento, forma, d7: resumo(d7), d30: s30, porNota, ultimas: linhas.slice(0, 15) }];
}

const out = {};
for (let i = 0; i < listas.length; i += 4) {
  const lote = await Promise.all(listas.slice(i, i + 4).map((x) => trader(x).catch((e) => [x.t.carteira, { nome: x.t.nome, erro: String(e.message || e) }])));
  for (const [w, r] of lote) out[w] = r;
}
await writeFile(new URL("data/desempenho.json", raiz), JSON.stringify({ geradoEm: agora, dias: DIAS, traders: out }));
for (const r of Object.values(out)) {
  const s = r.d30 || {};
  console.log(`${(r.nome || "").padEnd(20)} ${r.momento || ""} 30d: ${s.entradas ?? "-"} entradas, ${s.acertos ?? 0}/${s.resolvidas ?? 0} acertos, cópia ${s.roi_copia == null ? "–" : (100 * s.roi_copia).toFixed(1) + "%"} (${s.copiaveis ?? 0}) → ${r.forma || r.erro}`);
}
