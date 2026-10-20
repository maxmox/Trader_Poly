// Placar: desempenho recente de cada trader (data/desempenho.json, gerado pela Action) e os
// sinais reais enviados ao Telegram (GET /registro no Worker), com o resultado conferido.
import { odd, taxa } from "./core.js";
import { esc, pct, dataHora } from "./formato.js";

const FORMA = { entregando: "Entregando", "na média": "Na média", abaixo: "Abaixo", "pouca amostra": "Pouca amostra" };
const classe = (f) => ({ entregando: "good", "na média": "mid", abaixo: "bad" }[f] || "none");

// resumo dos sinais reais de um trader (ROI comprando na odd que estava disponível no envio)
// valor por cota de quem seguiu o sinal: vendeu nas saídas dele (sx = [[preço, fração], ...], com a taxa)
// e segurou o resto até o resultado; null se ainda não dá para fechar a conta
function valorFinal(s) {
  let resto = 1, v = 0;
  for (const [p, f] of s.sx || []) { const q = resto * f; v += q * (p - taxa(p)); resto -= q; }
  if (resto <= 0.02) return v;
  return s.r === 0 || s.r === 1 ? v + resto * s.r : null;
}

export function resumoRegistro(sinais) {
  const res = sinais.filter((s) => valorFinal(s) != null);
  // ROI comprando na odd disponível no envio, pagando a taxa de taker (5% x p x (1-p)), com as saídas
  const roi = res.filter((s) => s.a).map((s) => valorFinal(s) / (s.a + taxa(s.a)) - 1);
  return {
    enviados: sinais.length, abertos: sinais.length - res.length, acertos: res.filter((s) => valorFinal(s) / (s.a || 1) > 1).length, resolvidos: res.length,
    roi: roi.length ? roi.reduce((a, b) => a + b, 0) / roi.length : null,
  };
}

export function linhaPlacar(d, sinais) {
  if (!d && !sinais.length) return "";
  const s = d?.d30, s7 = d?.d7;
  const bolinhas = (d?.ultimas || []).map((l) => {
    const st = l.res === 1 ? "win" : l.res === 0 ? "loss" : "open";
    const tit = `${new Date(l.t0).toLocaleDateString("pt-BR")} · ${l.evento} · ${l.lado} · odd ${odd(l.precoDele)}${l.nota ? ` · nota ${l.nota.nota}` : ""}${l.roiCopia != null ? ` · cópia ${pct(l.roiCopia)}` : ""}`;
    return `<i class="bol ${st}" title="${esc(tit)}"></i>`;
  }).join("");
  const r = resumoRegistro(sinais);
  return `<div class="placar">
    ${d ? `<span class="forma ${classe(d.forma)}">${FORMA[d.forma] || d.forma}</span>
    <span>30 dias: <b>${s.acertos}/${s.resolvidas}</b> acertos${s.odd_media ? ` (odd média ${s.odd_media.toFixed(2).replace(".", ",")})` : ""} · cópia <b class="${s.roi_copia > 0 ? "pos" : s.roi_copia < 0 ? "neg" : ""}">${pct(s.roi_copia)}</b> (${s.copiaveis} copiáveis)</span>
    <span>7 dias: <b>${s7.acertos}/${s7.resolvidas}</b> · cópia <b>${pct(s7.roi_copia)}</b></span>
    <span class="bolinhas" title="últimas entradas no nicho dele, da mais recente para a mais antiga">${bolinhas}</span>` : ""}
    ${sinais.length ? `<span>Sinais enviados: <b>${r.enviados}</b> · ${r.acertos}✓ ${r.resolvidos - r.acertos}✗ ${r.abertos} abertos · ROI <b>${pct(r.roi)}</b></span>` : ""}
  </div>`;
}

export function secaoPlacar({ desempenho, registro, traders }) {
  const D = desempenho?.traders || {};
  const porW = {};
  for (const s of registro || []) (porW[s.w] ||= []).push(s);
  const linhas = traders.map(({ t, momento }) => {
    const d = D[t.carteira], s = d?.d30, r = resumoRegistro(porW[t.carteira] || []);
    return `<tr><td>${esc(t.nome)}</td><td>${momento}</td>
      <td>${d ? `<span class="forma ${classe(d.forma)}">${FORMA[d.forma] || d.forma}</span>` : "–"}</td>
      <td class="n">${s ? `${s.acertos}/${s.resolvidas}` : "–"}</td><td class="n">${s?.odd_media ? s.odd_media.toFixed(2).replace(".", ",") : "–"}</td><td class="n">${pct(s?.roi_dele)}</td>
      <td class="n">${pct(s?.roi_copia)}</td><td class="n">${pct(d?.d7?.roi_copia)}</td>
      <td class="n">${r.enviados ? `${r.acertos}/${r.resolvidos}${r.abertos ? ` +${r.abertos}` : ""}` : "–"}</td><td class="n">${pct(r.roi)}</td></tr>`;
  }).join("");

  // futebol Under (observação): sinais reais por regra
  const under = ["pre", "vivo"].map((f) => {
    const r = resumoRegistro((porW["under-fut"] || []).filter((x) => x.rt === f));
    return `<tr><td>Futebol: Under ${f === "pre" ? "(pré-jogo, retirado em 19/10)" : "(0x0 aos 30')"}</td><td>${f === "pre" ? "pré-jogo" : "ao vivo"} · futebol</td><td>${f === "pre" ? "retirado" : "observar"}</td><td class="n">–</td><td class="n">–</td><td class="n">–</td>
      <td class="n">${f === "pre" ? "+11% a +13%*" : "+16%*"}</td><td class="n">–</td>
      <td class="n">${r.enviados ? `${r.acertos}/${r.resolvidos}${r.abertos ? ` +${r.abertos}` : ""}` : "–"}</td><td class="n">${pct(r.roi)}</td></tr>`;
  }).join("");

  // basquete ao vivo, seguir quem disparou (observação): sinais reais por força
  const bkt = ["forte", "moderado"].map((f) => {
    const r = resumoRegistro((porW["seguir-bkt"] || []).filter((x) => x.rt === f));
    return `<tr><td>Basquete: seguir ${f === "forte" ? "🟢 forte (≥ 10%)" : "🟡 moderado (5–10%)"}</td><td>ao vivo · basquete fora da NBA</td><td>observar</td><td class="n">–</td><td class="n">–</td><td class="n">–</td>
      <td class="n">${f === "forte" ? "+16% a +46%*" : "+13% a +19%*"}</td><td class="n">–</td>
      <td class="n">${r.enviados ? `${r.acertos}/${r.resolvidos}${r.abertos ? ` +${r.abertos}` : ""}` : "–"}</td><td class="n">${pct(r.roi)}</td></tr>`;
  }).join("");

  // conferência da nota: 30 dias simulados (todos os traders) + sinais reais
  const agg = {};
  for (const d of Object.values(D)) for (const [rot, v] of Object.entries(d.porNota || {})) {
    const a = (agg[rot] ||= { n: 0, soma: 0, acertos: 0, resolvidas: 0 });
    if (v.roi_copia != null) { a.soma += v.roi_copia * v.copiaveis; a.n += v.copiaveis; }
    a.acertos += v.acertos; a.resolvidas += v.resolvidas;
  }
  const reaisPorNota = {};
  for (const s of registro || []) if (s.rt) (reaisPorNota[s.rt] ||= []).push(s);
  const notas = ["forte", "boa", "neutra", "fraca"].map((rot) => {
    const a = agg[rot], r = resumoRegistro(reaisPorNota[rot] || []);
    return `<tr><td><span class="nota-pill ${rot}">${rot}</span></td>
      <td class="n">${a ? `${a.acertos}/${a.resolvidas}` : "–"}</td><td class="n">${a?.n ? pct(a.soma / a.n) : "–"}</td>
      <td class="n">${r.enviados ? `${r.acertos}/${r.resolvidos}` : "–"}</td><td class="n">${pct(r.roi)}</td></tr>`;
  }).join("");

  const quando = dataHora(desempenho?.geradoEm);
  return `<div class="sec-head"><h2>Placar</h2><span class="muted">últimos 30 dias atualizados em ${quando} · sinais reais desde o início do registro</span></div>
    <p class="muted lede"><b>30 dias</b>: entradas do trader na especialidade/nicho dele, como se tivessem virado sinal; "cópia" = comprar 1 min depois, na odd negociada, só se ainda estava acima da odd mínima. <b>Sinais reais</b>: o que o Telegram mandou, com o resultado conferido depois do jogo (ROI na odd disponível no envio).</p>
    <div class="tbl-wrap"><table><thead><tr><th>Trader</th><th>Tipo</th><th>Situação</th><th class="n">Acertos 30d</th><th class="n">Odd média</th><th class="n">ROI dele</th><th class="n">ROI cópia 30d</th><th class="n">Cópia 7d</th><th class="n">Sinais reais</th><th class="n">ROI sinais</th></tr></thead><tbody>${linhas}${under}${bkt}</tbody></table></div>
    <p class="muted">* Futebol, Under: Under 0,5 do 1º tempo com 0x0 aos 30 min (placar da ESPN). O Under pré-jogo (1º tempo e Under 1,5 a 0,25–0,40, 10–30 min antes) foi retirado em 19/10 depois de dar prejuízo nos sinais reais; a linha fica para o histórico; backtest de 60 dias com preço real, positivo nos dois períodos de 30 dias. Basquete, seguir: comprar o time cuja odd caiu ≥ 5% até os 20–30 min, só fora da NBA/WNBA; backtest de 90 dias com preço real, mercados rasos. Os sinais reais mostram se isso se mantém.</p>
    <h3>A nota está acertando?</h3>
    <div class="tbl-wrap"><table class="estreita"><thead><tr><th>Nota</th><th class="n">Acertos 30d</th><th class="n">ROI cópia 30d</th><th class="n">Sinais reais</th><th class="n">ROI sinais</th></tr></thead><tbody>${notas}</tbody></table></div>`;
}
