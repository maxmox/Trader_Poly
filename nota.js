// Bloco visual da nota da entrada (cards e tabelas). A conta fica em core.js (notaEntrada).
const ROT = { forte: "Entrada forte", boa: "Entrada boa", neutra: "Entrada neutra", fraca: "Entrada fraca" };
const GRUPO = { trader: "Trader", mercado: "Mercado", odd: "Odd e tempo" };
const pts = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")}`;

export function blocoNota(n, esc) {
  if (!n) return "";
  const barras = ["trader", "mercado", "odd"].map((g) => `
    <div class="barra"><span>${GRUPO[g]}</span><i><em style="width:${n[g]}%"></em></i><b>${n[g]}</b></div>`).join("");
  const fatores = n.fatores.filter((f) => f.faixa)
    .sort((a, b) => Math.abs(b.efeito) - Math.abs(a.efeito))
    .map((f) => `<li><span>${esc(f.rotulo)}: ${esc(f.faixa)}</span><b class="${f.efeito >= 0 ? "pos" : "neg"}">${pts(f.efeito)}</b></li>`).join("");
  const faltam = n.fatores.filter((f) => !f.faixa).map((f) => f.rotulo.toLowerCase());
  return `<div class="nota ${n.rotulo}">
    <div class="nota-top"><b class="nota-num">${n.nota}</b><div><strong>${ROT[n.rotulo]}</strong>
      <small>vantagem esperada ${pts(n.esperado)} pts de probabilidade</small></div></div>
    <div class="barras">${barras}</div>
    <details><summary>Por que essa nota</summary><ul>${fatores}</ul>
      ${faltam.length ? `<p class="falta">Sem dado para: ${esc(faltam.join(", "))}.</p>` : ""}
      <p class="falta">50 = neutro. Em teste com entradas que o modelo não viu, notas fortes renderam +2,7% copiando e fracas −12%.</p></details>
  </div>`;
}

export function pilulaNota(n) {
  return n ? `<span class="nota-pill ${n.rotulo}" title="trader ${n.trader} · mercado ${n.mercado} · odd e tempo ${n.odd}">${n.nota}</span>` : "–";
}
