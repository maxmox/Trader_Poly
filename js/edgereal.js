// EDGE REAL (11/11/2026, nba_pbp/edge_real.py, 20 noites, 156 jogos, odds de fechamento da DK):
// a chance pela projeção sozinha (Edgely, DARKO ou a nossa) PERDE da odd sem margem da DK em log-loss em todas as
// estatísticas e é confiante demais (diz 34% de Over, sai ~45%) — o EV que ela mostrava era inflado. O que vale é o quanto
// a projeção ACRESCENTA à DK:
//   chance real = logit⁻¹( logit(DK sem margem) + w · (logit(chance da projeção com a dispersão) − logit(DK)) )
// com a dispersão medida (painel.js chanceLinha: φ da liga no início × faixa da média × fator do jogador) e w por
// fonte × estatística (data/padroes/edge_real.json; Edgely ~0,15–0,25, DARKO 0,10–0,25, nossa 0,15–0,35; rebotes do
// Edgely ~0). Linha inteira: empate devolve.
import { chanceLinha } from "./painel.js";
import { semMargem } from "./core.js";

export const K_EDGE = { points: "pts", rebounds: "reb", assists: "ast", threes: "tpm", pra: "pra" };
const corta = (p) => Math.min(Math.max(p, 1e-4), 1 - 1e-4);
const lg = (p) => Math.log(corta(p) / (1 - corta(p)));
const il = (z) => 1 / (1 + Math.exp(-z));

// → { lado, odd, chance, mercado, ev, modelo, w } ou null (sem peso validado para a fonte/estatística)
export function edgeReal(cal, pesos, fonte, tipo, aid, proj, linha, over, under) {
  const k = K_EDGE[tipo], w = pesos?.[fonte]?.[k];
  if (!k || w == null || !cal?.dispersao || proj == null || !(proj > 0.05) || linha == null || !over || !under) return null;
  const pdk = semMargem(over, under);
  if (pdk == null) return null;
  const ch = chanceLinha(cal, aid, 0, [[k, proj]], 0, linha);
  const pm = ch.over / Math.max(ch.over + ch.under, 1e-9);
  const q = il(lg(pdk) + w * (lg(pm) - lg(pdk))), push = ch.push || 0;
  const evO = q * (1 - push) * over + push - 1, evU = (1 - q) * (1 - push) * under + push - 1, ehO = evO >= evU;
  return { lado: ehO ? "Over" : "Under", odd: ehO ? over : under, chance: ehO ? q : 1 - q, mercado: ehO ? pdk : 1 - pdk,
    ev: ehO ? evO : evU, modelo: ehO ? pm : 1 - pm, w, fonte };
}
