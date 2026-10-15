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
  return `<div class="nota-ent ${n.rotulo}">
    <div class="nota-top"><b class="nota-num">${n.nota}</b><div><strong>${ROT[n.rotulo]}</strong>
      <small>vantagem esperada ${pts(n.esperado)} pts de probabilidade</small></div></div>
    ${n.aviso ? `<p class="nota-aviso">${esc(n.aviso)}</p>` : ""}
    <div class="barras">${barras}</div>
    <details><summary>Por que essa nota</summary><ul>${fatores}</ul>
      ${faltam.length ? `<p class="falta">Sem dado para: ${esc(faltam.join(", "))}.</p>` : ""}
      <p class="falta">50 = neutro. Em teste com entradas que o modelo não viu, notas fortes (66+) renderam +4% copiando e fracas (abaixo de 50) −16%; entre 50 e 65 a diferença é pequena.</p></details>
  </div>`;
}

// linha do tamanho da aposta dele, embaixo do valor ("12% da aposta típica dele ($1.624)")
export function tamanhoTxt(t) {
  if (!t || t.classe === "sem-ref") return "";
  const rel = t.razao == null ? "" : t.razao < 0.995 ? (t.razao < 0.01 ? "menos de 1%" : `${Math.round(100 * t.razao)}%`) + " do normal dele" : `${t.razao.toFixed(1).replace(".", ",")}× o normal dele`;
  return `<em class="tam ${t.classe}" title="${t.rotulo}${t.mediana ? ` · aposta típica dele: $${Math.round(t.mediana).toLocaleString("pt-BR")}` : ""}">${rel || t.rotulo}</em>`;
}

export function pilulaNota(n) {
  return n ? `<span class="nota-pill ${n.rotulo}" title="trader ${n.trader} · mercado ${n.mercado} · odd e tempo ${n.odd}">${n.nota}</span>` : "–";
}
