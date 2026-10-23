// Quadro "Entradas recentes", em ordem cronológica, boas ou ruins:
//  - traders: todas as entradas no nicho deles (data/desempenho.json, "ultimas" de cada trader, gerado pela Action)
//  - estratégias: nenhuma ativa (futebol Under e basquete seguir retirados em 24/10/2026); o código fica para quando
//    uma voltar (sinais reais do GET /registro no Worker, relidos a cada 5 min)
import { rotuloTipo, linkMercado, odd, taxa } from "./core.js";
import { esc, usd, ha, dataHora, hora, pct as pctCasas } from "./formato.js";

const CHAVE = "entradas-filtros";
const PASSO = 100;
const pct = (v) => pctCasas(v, 0);
const FILTROS = { origem: "", momento: "", nivel: "", situacao: "", trader: "" };
// estratégias que entram no quadro (as retiradas — steam, contra o movimento, futebol Under, basquete seguir — ficam de fora)
const ESTRATEGIAS = {};

function lerFiltros() {
  try { return { ...FILTROS, ...JSON.parse(localStorage.getItem(CHAVE) || "{}") }; }
  catch { return { ...FILTROS }; }
}

// sinal de estratégia do registro -> mesma forma de uma entrada de trader
function deSinal(s) {
  const vivo = s.w === "seguir-bkt" || s.rt === "vivo";
  const regra = s.w === "under-fut" ? (vivo ? "0x0 aos 30'" : "pré-jogo") : s.rt;
  const res = s.r === 0 || s.r === 1 ? s.r : null;
  return {
    origem: "estrategia", t0: s.env, w: s.w, nome: `${ESTRATEGIAS[s.w]} (${regra})`, momento: vivo ? "ao vivo" : "pré-jogo", nivel: "observar",
    lado: s.l, evento: s.e, esporte: s.sp, tipo: s.tp, slug: s.s, eventSlug: s.ev, precoDele: s.p, usd: null, nota: null, res,
    pCopia: s.a ?? null, roiCopia: res != null && s.a ? res / (s.a + taxa(s.a)) - 1 : null,
  };
}

export function iniciarEntradas({ el }) {
  let f = lerFiltros(), limite = PASSO, todas = [], geradoEm = null;

  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(f)); } catch { /* sem armazenamento: só nesta visita */ } }

  function juntar(desempenho, traders, registro) {
    const nivel = new Map(traders.map(({ t, momento }) => [`${t.carteira}|${momento}`, t.nivel]));
    const out = [];
    for (const [w, d] of Object.entries(desempenho?.traders || {})) {
      const nv = nivel.get(`${w}|${d.momento}`);
      if (!nv) continue; // trader que saiu do site
      for (const l of d.ultimas || []) out.push({ ...l, origem: "trader", w, nome: d.nome, momento: d.momento, nivel: nv });
    }
    const desde = Date.now() - 30 * 864e5;
    for (const s of registro || []) if (ESTRATEGIAS[s.w] && s.env >= desde) out.push(deSinal(s));
    return out.sort((a, b) => b.t0 - a.t0);
  }

  function situacao(l) { return l.res === 1 ? "ganhou" : l.res === 0 ? "perdeu" : "aberta"; }

  function linha(l) {
    const st = situacao(l);
    const res = st === "aberta"
      ? `<span class="ent-st aberta">aberta</span>`
      : `<span class="ent-st ${st}">${st === "ganhou" ? "✓ ganhou" : "✗ perdeu"}</span><small>${l.roiCopia != null ? `cópia ${pct(l.roiCopia)}` : `dele ${pct(l.roiDele)}`}</small>`;
    const copia = l.origem === "estrategia" ? (l.pCopia != null ? `${odd(l.pCopia)}<small>odd no alerta</small>` : "–")
      : l.pCopia != null ? `${odd(l.pCopia)}<small>dava para copiar</small>`
      : l.p60 != null ? `${odd(l.p60)}<small class="neg">fora da faixa</small>` : `–<small>sem negócio</small>`;
    return `<tr class="${st}">
      <td class="n"><b>${dataHora(l.t0)}</b><small>${ha(l.t0)}</small></td>
      <td>${esc(l.nome)}<small><span class="nv ${l.nivel}">${l.nivel}</span> · ${l.momento}</small></td>
      <td><a href="${linkMercado(l)}" target="_blank" rel="noopener">${esc(l.lado)}</a><small>${esc(l.evento)} · ${esc(l.esporte || "")}${l.tipo ? " · " + esc(rotuloTipo(l.tipo)) : ""}</small></td>
      <td class="n">${odd(l.precoDele)}<small>${usd(l.usd)}</small></td>
      <td>${l.nota ? `<span class="nota-pill ${l.nota.rotulo}">${l.nota.nota}</span>` : "–"}</td>
      <td class="n">${copia}</td>
      <td>${res}</td></tr>`;
  }

  function render() {
    const raiz = el();
    if (!raiz) return;
    const nomes = [...new Set(todas.map((l) => l.nome))].sort((a, b) => a.localeCompare(b));
    const L = todas.filter((l) => (!f.origem || l.origem === f.origem) && (!f.momento || l.momento === f.momento) && (!f.nivel || l.nivel === f.nivel)
      && (!f.situacao || situacao(l) === f.situacao) && (!f.trader || l.nome === f.trader));
    const res = L.filter((l) => l.res != null), cop = res.filter((l) => l.roiCopia != null);
    const roi = cop.length ? cop.reduce((s, l) => s + l.roiCopia, 0) / cop.length : null;
    const sel = (id, atual, ops) => `<select data-f="${id}">${ops.map(([v, t]) => `<option value="${esc(v)}"${v === atual ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    const quando = geradoEm ? hora(geradoEm) : "–";
    raiz.innerHTML = `<div class="sec-head"><h2>Entradas recentes</h2><span class="muted">entradas dos traders no nicho deles e sinais das estratégias, da mais nova para a mais antiga · traders atualizados às ${quando}</span></div>
      <div class="ent-filtros">
        ${sel("origem", f.origem, [["", "traders e estratégias"], ["trader", "só traders"], ["estrategia", "só estratégias"]])}
        ${sel("momento", f.momento, [["", "pré-jogo e ao vivo"], ["pré-jogo", "pré-jogo"], ["ao vivo", "ao vivo"]])}
        ${sel("nivel", f.nivel, [["", "copiar e observar"], ["copiar", "só copiar"], ["observar", "só observar"]])}
        ${sel("situacao", f.situacao, [["", "todas"], ["aberta", "abertas"], ["ganhou", "ganhou"], ["perdeu", "perdeu"]])}
        ${sel("trader", f.trader, [["", "todos"], ...nomes.map((n) => [n, n])])}
      </div>
      <p class="muted">${L.length} entradas · ${L.length - res.length} abertas · ${res.filter((l) => l.res === 1).length}/${res.length} acertos ·
        ROI de quem entrou ${pct(roi)} (${cop.length} com resultado e odd de entrada)</p>
      <div class="tbl-wrap"><table class="ent-tab"><thead><tr><th class="n">Quando</th><th>Trader / estratégia</th><th>Aposta</th><th class="n">Odd dele</th><th>Nota</th><th class="n">Odd para entrar</th><th>Resultado</th></tr></thead>
        <tbody>${L.slice(0, limite).map(linha).join("") || `<tr><td colspan="7" class="muted">Nenhuma entrada com esses filtros.</td></tr>`}</tbody></table></div>
      ${L.length > limite ? `<button type="button" data-mais>Mostrar mais ${Math.min(PASSO, L.length - limite)}</button>` : ""}
      <p class="hint">Traders: só entram apostas no nicho em que o trader está liberado (as que virariam sinal); apostas simbólicas (menos de $20 ou de 10% da aposta típica dele) ficam de fora.
        “Odd para entrar” = 1º negócio do lado da compra 60 s após a entrada dele; “fora da faixa” = já tinha passado da odd mínima ou caído mais de 10¢.
        As entradas dos traders são recalculadas a cada ~10–20 min no servidor.
        Estratégias: cada sinal enviado ao Telegram, com a odd disponível no alerta (taxa incluída no ROI); aparecem em até 5 min.</p>`;
    raiz.querySelectorAll("select[data-f]").forEach((s) => s.addEventListener("change", () => { f[s.dataset.f] = s.value; limite = PASSO; salvar(); render(); }));
    raiz.querySelector("[data-mais]")?.addEventListener("click", () => { limite += PASSO; render(); });
  }

  return {
    atualizar({ desempenho, traders, registro }) {
      todas = juntar(desempenho, traders, registro);
      geradoEm = desempenho?.geradoEm ?? null;
      render();
    },
  };
}
