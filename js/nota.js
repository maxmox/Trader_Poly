// Blocos visuais dos cards e tabelas: nota da entrada, tamanho da aposta, como o trader sai e selo do
// mercado. As contas ficam em core.js (notaEntrada, tamanhoAposta, seguraMelhor, historicoNoMercado).
import { odd, seguraMelhor } from "./core.js";
import { esc } from "./formato.js";

const ROT = { forte: "Entrada forte", boa: "Entrada boa", neutra: "Entrada neutra", fraca: "Entrada fraca" };
const GRUPO = { trader: "Trader", mercado: "Mercado", odd: "Odd e tempo" };
const pts = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")}`;

export function blocoNota(n) {
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

// Trader que vende antes do fim: como ele costuma sair e o que fazer (padrão medido em
// polymarket_traders/saidas_analise.py, gravado em trader.saida)
// roi_* de trader.saida já vêm em % (ex.: 12.5)
const pctTxt = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${String(Math.abs(v)).replace(".", ",")}%`);
export function blocoSaida(sd, preco) {
  if (!sd) return "";
  const alvo = sd.lucro_c && preco ? Math.min(0.99, preco + sd.lucro_c / 100) : null;
  const stop = sd.perda_c && preco ? Math.max(0.01, preco + sd.perda_c / 100) : null;
  return `<div class="saida-ent">
    <strong>🚪 Ele vende antes do fim (em ${sd.pct_sai}% das apostas)</strong>
    <ul>
      ${sd.pct_lucro ? `<li>Realiza lucro em ${sd.pct_lucro}% das saídas, com ~+${sd.lucro_c}¢${alvo ? ` → aqui, perto de <b>${Math.round(100 * alvo)}¢ (odd ${odd(alvo)})</b>` : ""}</li>` : ""}
      ${sd.pct_perda ? `<li>Corta perda em ${sd.pct_perda}% das saídas, com ~${sd.perda_c}¢${stop ? ` → aqui, perto de ${Math.round(100 * stop)}¢ (odd ${odd(stop)})` : ""}</li>` : ""}
      ${sd.min_med ? `<li>Tempo típico até sair: ~${sd.min_med} min${sd.pct_tudo != null ? ` · vende tudo de uma vez em ${sd.pct_tudo}% das saídas` : ""}</li>` : ""}
    </ul>
    ${seguraMelhor(sd)
      ? `<p><b>Como copiar:</b> no histórico, <b>segurar até o fim rendeu mais</b> (${pctTxt(sd.roi_segurando)} contra ${pctTxt(sd.roi_saida)} saindo junto com ele).
         O alerta <b>SAIR</b> é só informativo: sair junto garante o lucro dele, segurar rendeu mais na média.</p>`
      : `<p><b>Como copiar:</b> entre e siga o alerta <b>SAIR</b> do Telegram (chega quando ele vende). Se não puder acompanhar,
         deixe logo após entrar uma ordem de venda limitada${alvo ? ` a ${Math.round(100 * alvo)}¢` : ""}. Na simulação, copiar a saída dele rendeu ${pctTxt(sd.roi_saida)}
         contra ${pctTxt(sd.roi_segurando)} segurando até o fim.</p>`}
  </div>`;
}

// Selo do histórico dele no mercado da aposta. Dentro do nicho não precisa; fora, diz se ele
// lucra ali (pode valer a entrada), perde (não vale) ou se não há evidência.
export function seloMercado(h, dentro) {
  if (dentro) return `<span class="selo nicho">no nicho dele</span>`;
  const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
  const recorte = (k) => k.split("|").filter((v) => v !== "*").length >= 2 ? "neste tipo de mercado" : "neste esporte";
  if (!h) return `<span class="selo incerto" title="sem histórico dele aqui">fora do nicho · sem histórico</span>`;
  const det = `cópia ${pct(h.roi_copia)} em ${h.jogos} jogos · acerto ${h.acerto}%`;
  if (h.veredito === "lucra") return `<span class="selo lucra" title="${esc(det)} (chance de ser sorte ${Math.round(100 * h.p0)}%). Fora do nicho, o histórico passado quase não se repetiu nos testes: a nota pesa isso.">fora do nicho, mas lucrou ${recorte(h.chave)}: ${esc(det)}</span>`;
  if (h.veredito === "perde") return `<span class="selo perde" title="${esc(det)}">fora do nicho e PERDE ${recorte(h.chave)}: ${esc(det)}. Não vale.</span>`;
  return `<span class="selo incerto" title="poucos jogos ou resultado indefinido">fora do nicho · ${recorte(h.chave)}: ${esc(det)} (sem evidência)</span>`;
}

export function pilulaNota(n) {
  return n ? `<span class="nota-pill ${n.rotulo}" title="trader ${n.trader} · mercado ${n.mercado} · odd e tempo ${n.odd}">${n.nota}</span>` : "–";
}
