// Placar: desempenho recente de cada trader (data/desempenho.json, gerado pela Action) e os
// sinais reais enviados ao Telegram (GET /registro no Worker), com o resultado conferido.
const pct = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1).replace(".", ",")}%`);
const FORMA = { entregando: "Entregando", "na média": "Na média", abaixo: "Abaixo", "pouca amostra": "Pouca amostra" };
const classe = (f) => ({ entregando: "good", "na média": "mid", abaixo: "bad" }[f] || "none");

// resumo dos sinais reais de um trader (ROI comprando na odd que estava disponível no envio)
export function resumoRegistro(sinais) {
  const res = sinais.filter((s) => s.r === 0 || s.r === 1);
  // ROI comprando na odd disponível no envio, pagando a taxa de taker (5% x p x (1-p))
  const roi = res.filter((s) => s.a).map((s) => s.r / (s.a + 0.05 * s.a * (1 - s.a)) - 1);
  return {
    enviados: sinais.length, abertos: sinais.length - res.length, acertos: res.filter((s) => s.r === 1).length, resolvidos: res.length,
    roi: roi.length ? roi.reduce((a, b) => a + b, 0) / roi.length : null,
  };
}

export function linhaPlacar(d, sinais, esc) {
  if (!d && !sinais.length) return "";
  const s = d?.d30, s7 = d?.d7;
  const bolinhas = (d?.ultimas || []).map((l) => {
    const st = l.res === 1 ? "win" : l.res === 0 ? "loss" : "open";
    const tit = `${new Date(l.t0).toLocaleDateString("pt-BR")} · ${l.evento} · ${l.lado} · odd ${(1 / l.precoDele).toFixed(2).replace(".", ",")}${l.nota ? ` · nota ${l.nota.nota}` : ""}${l.roiCopia != null ? ` · cópia ${pct(l.roiCopia)}` : ""}`;
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

export function secaoPlacar({ desempenho, registro, traders, esc }) {
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

  const quando = desempenho?.geradoEm ? new Date(desempenho.geradoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
  return `<div class="sec-head"><h2>Placar</h2><span class="muted">últimos 30 dias atualizados em ${quando} · sinais reais desde o início do registro</span></div>
    <p class="muted lede"><b>30 dias</b>: entradas do trader na especialidade/nicho dele, como se tivessem virado sinal; "cópia" = comprar 1 min depois, na odd negociada, só se ainda estava acima da odd mínima. <b>Sinais reais</b>: o que o Telegram mandou, com o resultado conferido depois do jogo (ROI na odd disponível no envio).</p>
    <div class="tbl-wrap"><table><thead><tr><th>Trader</th><th>Tipo</th><th>Situação</th><th class="n">Acertos 30d</th><th class="n">Odd média</th><th class="n">ROI dele</th><th class="n">ROI cópia 30d</th><th class="n">Cópia 7d</th><th class="n">Sinais reais</th><th class="n">ROI sinais</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <h3>A nota está acertando?</h3>
    <div class="tbl-wrap"><table class="estreita"><thead><tr><th>Nota</th><th class="n">Acertos 30d</th><th class="n">ROI cópia 30d</th><th class="n">Sinais reais</th><th class="n">ROI sinais</th></tr></thead><tbody>${notas}</tbody></table></div>`;
}
