// Aba "Acompanhamento" de props.html: as apostas registradas por scripts/apostas_edgely.mjs e o resultado de cada uma:
// o lado de maior valor esperado pela projeção do Edgely (12 h de Brasília e ~30 min antes do jogo) e as ESTRATÉGIAS
// de mercado (~10 min antes: seguir o movimento da linha, projeção confirmada/contrariada, controle Under).
// SEMPRE SEPARADO POR MERCADO (24/10/2026, pedido do usuário: uma aposta de vencedor não tem nada a ver com uma de
// rebotes): placar estratégia × mercado, recortes por mercado e, do arquivo do mercado (todas as linhas de cada jogo
// encerrado, data/apostas_edgely/mercado-AAAA-MM.json), como as linhas se comportaram em cada mercado e em cada jogo.
// Stake fixo de 1 unidade; devolvida conta como aposta com lucro 0, anulada (não jogou) fica fora.
// Intervalo de 95% do ROI por bootstrap por JOGO inteiro (as props do mesmo jogo andam juntas).
// Lado "O" = Over ou VISITANTE (handicap/vencedor), "U" = Under ou mandante.
import { esc, hora } from "./formato.js";
import { nomeChave, TIPOS_PROP, MERCADOS_JOGO, semMargem, movimentoMercado, resultadoA } from "./core.js";
import { MERCADOS, mercadoDe } from "./filtros.js";

// props + mercados do jogo ("jogo-<k>")
const TIPOS = { ...TIPOS_PROP, ...Object.fromEntries(Object.entries(MERCADOS_JOGO).map(([k, m]) => [`jogo-${k}`, m.nome])) };
// registro/estratégia (campo momento): [nome, rótulo curto da lista]
const MOMENTOS = {
  mov: ["Seguir o movimento da linha (≥ 3 pp)", "seguir movimento"],
  conf: ["Projeção confirmada pela linha", "proj. confirmada"],
  contra: ["Linha contra a projeção: lado da linha", "linha × projeção"],
  mudou: ["Projeção mudou e a linha acompanhou", "proj. mudou"],
  "mov-under": ["Linha andou p/ Under → Under", "andou p/ Under"],
  "linha-volta": ["Linha andou e a odd voltou → lado da linha", "linha andou, odd voltou"],
  "contra-mudou": ["Projeção mudou sozinha → contra ela", "contra a projeção"],
  under: ["Controle: Under em tudo", "controle Under"],
  "12h": ["Edgely, registro das 12 h", "Edgely 12 h"],
  "30m": ["Edgely, ~30 min antes do jogo", "Edgely 30 min"],
};
const RES = { G: ["green", "Green"], R: ["red", "Red"], P: ["push", "Devolvida"], A: ["anulada", "Anulada"] };
const ANDOU = 0.03; // movimento equivalente (linha + odd) que conta como "andou"
const SIT_N = 30;   // abaixo disso a célula fica cinza (amostra pequena)
let dados = null, erro = null, lidoEm = 0;
// o conteúdo de cada jogo só é montado quando ele é aberto (todas as apostas de todos os jogos passam de 1 MB);
// quem está aberto (jogos e dias) sobrevive ao redesenho de cada minuto
const abertos = new Set(), diasMudados = new Map();
let ctx = null; // { X, L } do último desenho, para montar um jogo aberto depois

const ehTime = (tipo) => tipo === "jogo-spread" || tipo === "jogo-ml";
// sigla dos times do título "VIS @ MAN"
const times = (titulo) => { const [fora, casa] = String(titulo || "").split(" @ "); return { fora: fora || "visitante", casa: casa || "mandante" }; };
// lado como texto: Over/Under; no handicap e no vencedor, a sigla do time
const ladoTxt = (tipo, ladoA, titulo) => (ehTime(tipo) ? times(titulo)[ladoA ? "fora" : "casa"] : ladoA ? "Over" : "Under");
const num = (v, c = 1) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(c).replace(".", ","));
const sinal = (v, c = 1) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v), c)}`;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
const media = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const diaTxt = (d) => (d ? d.split("-").reverse().slice(0, 2).join("/") : "");
// texto da linha de um lado: handicap do mandante = −linha do visitante; vencedor não tem linha
const linhaDe = (tipo, linha, ladoA) => (tipo === "jogo-ml" ? "" : ` ${lin(tipo === "jogo-spread" && !ladoA ? -linha : linha)}`);

// ---------- dados ----------
// apostas de todos os meses + arquivo do mercado (todas as linhas de cada jogo encerrado)
export async function carregarAcomp() {
  lidoEm = Date.now(); // já marca: evita duas leituras ao mesmo tempo
  try {
    const t = Date.now();
    const ler = (n) => fetch(`data/apostas_edgely/${n}?t=${t}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    const ind = await ler("indice.json");
    const meses = ind?.meses || [];
    const [ms, mk] = await Promise.all([Promise.all(meses.map((m) => ler(`${m}.json`))), Promise.all(meses.map((m) => ler(`mercado-${m}.json`).catch(() => null)))]);
    const jogos = {}, apostas = [], linhas = [];
    for (const M of ms.filter(Boolean)) {
      Object.assign(jogos, M.jogos);
      const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
      for (const a of M.apostas) {
        const j = M.jogos[a[C.jogo]] || {}, tipo = a[C.tipo], ladoA = a[C.lado] === "O";
        apostas.push({
          jogo: a[C.jogo], dia: j.dia, titulo: j.titulo || "", inicio: j.inicio, atleta: a[C.atleta], tipo, merc: mercadoDe(tipo),
          nome: a[C.atleta] === "jogo" ? TIPOS[tipo] || tipo : M.nomes[a[C.atleta]] || `atleta ${a[C.atleta]}`,
          linha: a[C.linha], over: a[C.over], under: a[C.under], ladoA, lado: ladoTxt(tipo, ladoA, j.titulo),
          odd: ladoA ? a[C.over] : a[C.under], proj: a[C.proj], min: a[C.min], valor: a[C.valor], final: !!a[C.final], res: a[C.res], real: a[C.real],
          momento: a[C.momento] || "12h", mov: C.mov == null ? null : a[C.mov],
        });
      }
    }
    const porChave = new Map();
    for (const M of mk.filter(Boolean)) {
      for (const [id, j] of Object.entries(M.jogos)) jogos[id] = { ...jogos[id], ...j };
      const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
      for (const a of M.props) {
        const j = M.jogos[a[C.jogo]] || {};
        const x = linhaDoArquivo({ jogo: a[C.jogo], dia: j.dia, titulo: j.titulo || "", atleta: a[C.atleta], tipo: a[C.tipo],
          L0: a[C.L0], O0: a[C.O0], U0: a[C.U0], L1: a[C.L1], O1: a[C.O1], U1: a[C.U1], proj12: a[C.proj12], proj30: a[C.proj30], real: a[C.real] });
        x.nome = x.atleta === "jogo" ? TIPOS[x.tipo] || x.tipo : M.nomes[x.atleta] || `atleta ${x.atleta}`;
        linhas.push(x);
        porChave.set(`${x.jogo}|${x.atleta}|${x.tipo}`, x);
      }
    }
    // cada aposta ganha o FECHAMENTO da mesma linha (para ver se a linha foi a favor depois do registro)
    for (const a of apostas) {
      const x = porChave.get(`${a.jogo}|${a.atleta}|${a.tipo}`);
      if (!x) continue;
      a.fech = x;
      const d = movimentoMercado(a.tipo, a.linha, x.L1, semMargem(a.over, a.under), semMargem(x.O1, x.U1));
      a.depois = d == null ? null : a.ladoA ? d : -d; // > 0 = a linha andou a favor da aposta depois do registro
    }
    dados = { apostas, linhas, jogos, em: ind?.em || null };
    erro = null;
  } catch (e) {
    erro = e;
  }
  lidoEm = Date.now();
}
export const acompVelho = () => Date.now() - lidoEm > 5 * 60e3;

// uma linha do arquivo com o que interessa já calculado
function linhaDoArquivo(x) {
  x.merc = mercadoDe(x.tipo);
  const p0 = semMargem(x.O0, x.U0), p1 = semMargem(x.O1, x.U1);
  x.m = movimentoMercado(x.tipo, x.L0, x.L1, p0, p1);
  x.dir = x.m == null ? null : x.m >= ANDOU ? "O" : x.m <= -ANDOU ? "U" : null;
  const temLinha = x.tipo === "jogo-ml" || x.L1 != null;
  x.rA = temLinha ? resultadoA(x.tipo, x.real, x.L1) : null; // 1 = Over/visitante ganha na linha de fechamento
  const r0 = x.tipo === "jogo-ml" || x.L0 != null ? resultadoA(x.tipo, x.real, x.L0) : null;
  // a linha andou para um lado: o resultado foi para esse lado em relação à ABERTURA?
  x.acertou = x.dir && r0 ? (r0 > 0) === (x.dir === "O") : null;
  x.lO = x.rA == null || !x.O1 ? null : x.rA === 0 ? 0 : x.rA > 0 ? x.O1 - 1 : -1;
  x.lU = x.rA == null || !x.U1 ? null : x.rA === 0 ? 0 : x.rA < 0 ? x.U1 - 1 : -1;
  // real − linha (handicap: margem do visitante + a linha dele; vencedor não tem linha) e erro da DK × Edgely
  const proj = x.proj30 ?? x.proj12;
  if (x.real != null && x.L1 != null && x.tipo !== "jogo-ml") {
    x.dif = x.tipo === "jogo-spread" ? x.real + x.L1 : x.real - x.L1;
    x.eDk = Math.abs(x.dif);
    // o Edgely projeta a margem do mandante: visitante esperado = −proj
    if (proj != null) x.eEd = Math.abs(x.tipo === "jogo-spread" ? x.real + proj : x.real - proj);
  }
  return x;
}

const lucroDe = (a) => (a.res === "G" ? a.odd - 1 : a.res === "R" ? -1 : 0);
// resumo de um grupo de apostas resolvidas (sem as anuladas)
function resumo(L) {
  const v = L.filter((a) => a.res && a.res !== "A");
  const g = v.filter((a) => a.res === "G").length, r = v.filter((a) => a.res === "R").length;
  const lucro = v.reduce((s, a) => s + lucroDe(a), 0);
  return { n: v.length, g, r, lucro, roi: v.length ? lucro / v.length : null, acerto: g + r ? g / (g + r) : null, oddMedia: v.length ? v.reduce((s, a) => s + a.odd, 0) / v.length : null, v };
}
// intervalo de 95% do ROI sorteando jogos inteiros; v = [{jogo, l}] ou apostas
function intervalo(v, lucro = lucroDe, sorteios = 1000) {
  const por = new Map();
  for (const a of v) { const x = por.get(a.jogo) || por.set(a.jogo, { l: 0, n: 0 }).get(a.jogo); x.l += lucro(a); x.n++; }
  const J = [...por.values()];
  if (J.length < 5) return null;
  const rois = [];
  for (let b = 0; b < sorteios; b++) {
    let l = 0, n = 0;
    for (let i = 0; i < J.length; i++) { const x = J[(Math.random() * J.length) | 0]; l += x.l; n += x.n; }
    rois.push(l / n);
  }
  rois.sort((a, b) => a - b);
  return [rois[Math.floor(sorteios * 0.025)], rois[Math.floor(sorteios * 0.975) - 1]];
}
const roiTxt = (s) => (s.roi == null ? "–" : `${sinal(100 * s.roi)}%`);
const icTxt = (ic) => (ic ? `${sinal(100 * ic[0], 0)}% a ${sinal(100 * ic[1], 0)}%` : "");
function situacao(s, ic) {
  if (s.n < SIT_N) return "pouco";
  if (s.roi >= 0.10 && ic && ic[0] > 0) return "forte";
  if (s.roi >= 0.05) return "bom";
  if (s.roi <= -0.10) return "ruim";
  return "neutro";
}

// ---------- tabelas de apostas ----------
// célula estratégia/recorte × mercado: ROI e nº de apostas; cor = situação
function celula(L, vazio = "–") {
  const s = resumo(L), pend = L.filter((a) => !a.res).length;
  if (!s.n) return `<td class="n cel"><span class="muted">${pend ? `${pend} pend.` : vazio}</span></td>`;
  const ic = intervalo(s.v, lucroDe, 400);
  return `<td class="n cel sit-${situacao(s, ic)}" title="${esc(`${s.n} apostas · ${s.g}–${s.r} · lucro ${sinal(s.lucro)} u${ic ? ` · 95%: ${icTxt(ic)}` : ""}${pend ? ` · ${pend} pendentes` : ""}`)}"><b>${roiTxt(s)}</b><small>${s.n} · ${s.g}–${s.r}</small></td>`;
}
const cabMercados = (mercs, L) => mercs.map((m) => `<th class="n">${esc(MERCADOS[m] || m)}<small>${L.filter((a) => a.merc === m && a.res && a.res !== "A").length} apostas</small></th>`).join("");
// matriz: linhas = recortes [rótulo, filtro], colunas = mercados
function matriz(titulo, recortes, L, mercs, vazio) {
  const corpo = recortes.map(([rot, ok]) => { const R = L.filter(ok); return `<tr><td>${rot}</td>${mercs.map((m) => celula(R.filter((a) => a.merc === m), vazio)).join("")}</tr>`; }).join("");
  return `<div class="tbl-wrap"><table class="props-tab filtros-matriz acomp-matriz"><thead><tr><th>${titulo}</th>${cabMercados(mercs, L)}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}
// um mercado só: tabela com o detalhe de cada recorte
function linhaGrupo(rot, L) {
  const s = resumo(L), ic = intervalo(s.v);
  const pend = L.filter((a) => !a.res).length;
  if (!s.n) return `<tr><td>${rot}</td><td class="n" colspan="6"><span class="muted">${pend ? `${pend} pendentes` : "sem apostas"}</span></td></tr>`;
  return `<tr class="sit-${situacao(s, ic)}"><td>${rot}</td><td class="n">${s.n}${pend ? `<small>+${pend} pendentes</small>` : ""}</td><td class="n">${s.g}–${s.r}</td><td class="n">${s.acerto == null ? "–" : `${Math.round(100 * s.acerto)}%`}</td>
    <td class="n">${s.oddMedia == null ? "–" : num(s.oddMedia, 2)}</td><td class="n">${sinal(s.lucro)}</td>
    <td class="n"><b>${roiTxt(s)}</b>${ic ? `<small>${icTxt(ic)}</small>` : ""}</td></tr>`;
}
function tabelaGrupos(titulo, recortes, L) {
  return `<div class="tbl-wrap"><table class="props-tab acomp-grupos"><thead><tr><th>${titulo}</th><th class="n">Apostas</th><th class="n">Green–Red</th><th class="n">Acerto</th><th class="n">Odd média</th><th class="n">Lucro (u)</th><th class="n">ROI <small>(95%)</small></th></tr></thead><tbody>${recortes.map(([rot, ok]) => linhaGrupo(rot, L.filter(ok))).join("")}</tbody></table></div>`;
}
const recorte = (titulo, recortes, L, mercs) => (mercs.length === 1 ? tabelaGrupos(titulo, recortes, L) : matriz(titulo, recortes, L, mercs));

// ---------- comportamento das linhas (arquivo do mercado) ----------
function comportamento(X) {
  const r = X.filter((x) => x.rA != null), mov = X.filter((x) => x.dir), julg = mov.filter((x) => x.acertou != null), dec = r.filter((x) => x.rA !== 0);
  const lO = r.map((x) => x.lO).filter((v) => v != null), lU = r.map((x) => x.lU).filter((v) => v != null);
  const e = X.filter((x) => x.eDk != null && x.eEd != null), eDif = e.filter((x) => x.eEd !== x.eDk);
  return {
    n: X.length, nr: r.length, nMov: mov.length, up: mov.filter((x) => x.dir === "O").length, down: mov.filter((x) => x.dir === "U").length,
    ac: julg.filter((x) => x.acertou).length, nj: julg.length, over: dec.filter((x) => x.rA > 0).length, dec: dec.length,
    roiO: lO.length ? media(lO) : null, roiU: lU.length ? media(lU) : null, dif: media(r.map((x) => x.dif).filter((v) => v != null)),
    eDk: media(e.map((x) => x.eDk)), eEd: media(e.map((x) => x.eEd)), ne: e.length, edPerto: eDif.filter((x) => x.eEd < x.eDk).length, neDif: eDif.length,
  };
}
const rotA = (m) => (ehTime(m) ? "visitante" : "Over"), rotB = (m) => (ehTime(m) ? "mandante" : "Under");
function tabelaComportamento(X, mercs) {
  const corpo = mercs.map((m) => {
    const c = comportamento(X.filter((x) => x.merc === m));
    if (!c.n) return "";
    return `<tr><td><b>${esc(MERCADOS[m] || m)}</b></td><td class="n">${c.nr}${c.n > c.nr ? `<small>${c.n - c.nr} sem resultado</small>` : ""}</td>
      <td class="n">${pct(c.nMov, c.n)}<small>▲ ${rotA(m)} ${c.up} · ▼ ${rotB(m)} ${c.down}</small></td>
      <td class="n">${c.nj ? `<b>${pct(c.ac, c.nj)}</b><small>${c.ac} de ${c.nj}</small>` : "–"}</td>
      <td class="n">${c.dec ? `<b>${pct(c.over, c.dec)}</b><small>${c.over}–${c.dec - c.over}</small>` : "–"}</td>
      <td class="n">${c.dif == null ? "–" : sinal(c.dif)}</td>
      <td class="n">${c.roiO == null ? "–" : `${sinal(100 * c.roiO)}%`}<small>${rotB(m)}: ${c.roiU == null ? "–" : `${sinal(100 * c.roiU)}%`}</small></td>
      <td class="n">${c.ne ? `${num(c.eDk)} × ${num(c.eEd)}<small>Edgely mais perto ${pct(c.edPerto, c.neDif)}</small>` : "–"}</td></tr>`;
  }).join("");
  return corpo ? `<div class="tbl-wrap"><table class="props-tab acomp-comport"><thead><tr><th>Mercado</th><th class="n">Linhas</th><th class="n">Andaram (≥ 3 pp)</th><th class="n">Movimento acertou<small>resultado p/ o lado que andou</small></th>
    <th class="n">Over (ou visitante) bateu<small>na linha de fechamento</small></th><th class="n">Real − linha<small>média</small></th><th class="n">ROI Over (ou visitante)<small>no fechamento</small></th><th class="n">Erro médio DK × Edgely</th></tr></thead><tbody>${corpo}</tbody></table></div>` : "";
}
// frases automáticas: só o que foge do comum (limites menores num jogo só)
function insights(X, mercs, minMov, minN) {
  const out = [];
  for (const m of mercs) {
    const c = comportamento(X.filter((x) => x.merc === m)), M = MERCADOS[m] || m;
    if (c.nj >= minMov && (c.ac / c.nj >= 0.65 || c.ac / c.nj <= 0.35))
      out.push([c.ac / c.nj >= 0.5 ? "pos" : "neg", `<b>${esc(M)}:</b> quando a linha andou, o resultado foi para o lado do movimento em <b>${c.ac} de ${c.nj}</b> (${pct(c.ac, c.nj)})${c.ac / c.nj <= 0.35 ? " — o movimento errou mais do que acertou" : " — seguir o movimento funcionou"}${c.up && c.down ? ` (▲ ${c.up} · ▼ ${c.down})` : ""}.`]);
    if (c.dec >= minN && (c.over / c.dec >= 0.62 || c.over / c.dec <= 0.38)) {
      const a = c.over / c.dec >= 0.5;
      out.push([a ? "pos" : "neg", `<b>${esc(M)}:</b> ${a ? rotA(m) : rotB(m)} bateu na linha de fechamento em <b>${a ? c.over : c.dec - c.over} de ${c.dec}</b> (${pct(a ? c.over : c.dec - c.over, c.dec)}); ROI ${rotA(m)} ${c.roiO == null ? "–" : `${sinal(100 * c.roiO)}%`}, ${rotB(m)} ${c.roiU == null ? "–" : `${sinal(100 * c.roiU)}%`}${c.dif != null ? `; real − linha em média ${sinal(c.dif)}` : ""}.`]);
    }
    if (c.ne >= minN && c.eDk && Math.abs(c.eEd - c.eDk) / c.eDk >= 0.08)
      out.push(["", `<b>${esc(M)}:</b> a ${c.eEd < c.eDk ? "projeção do Edgely" : "linha da DraftKings"} ficou mais perto do resultado (erro médio ${num(Math.min(c.eEd, c.eDk))} contra ${num(Math.max(c.eEd, c.eDk))}; Edgely mais perto em ${pct(c.edPerto, c.neDif)} das linhas).`]);
  }
  return out;
}
const listaInsights = (I) => (I.length ? `<ul class="acomp-insights">${I.map(([c, t]) => `<li class="${c}">${t}</li>`).join("")}</ul>` : "");

// ---------- jogo a jogo ----------
const movTxt = (x, titulo) => (x.m == null ? "–" : `${sinal(100 * x.m)} pp<small>${x.dir ? `p/ ${esc(ehTime(x.tipo) ? times(titulo)[x.dir === "O" ? "fora" : "casa"] : x.dir === "O" ? "Over" : "Under")}` : "parada"}</small>`);
const oddsTxt = (o, u) => (o || u ? `<small>${num(o, 2)} / ${num(u, 2)}</small>` : "");
function placarDe(G, titulo) {
  const tot = G.find((x) => x.tipo === "jogo-total")?.real, mg = G.find((x) => x.tipo === "jogo-spread" || x.tipo === "jogo-ml")?.real;
  if (tot == null || mg == null) return "";
  const t = times(titulo);
  return `${t.fora} ${(tot + mg) / 2} × ${(tot - mg) / 2} ${t.casa}`;
}
function resultadoTxt(x, titulo) {
  if (x.rA == null) return `<span class="muted">–</span>`;
  if (x.rA === 0) return `<span class="res push">devolvida</span>`;
  const t = times(titulo), a = x.rA > 0;
  const txt = x.tipo === "jogo-ml" ? `${a ? t.fora : t.casa} venceu` : x.tipo === "jogo-spread" ? `${a ? t.fora : t.casa} cobriu` : a ? "Over" : "Under";
  return `<span class="res ${a ? "green" : "red"}">${esc(txt)}</span>`;
}
function projJogoTxt(x, titulo) {
  const p = x.proj30 ?? x.proj12;
  if (p == null) return "–";
  if (!ehTime(x.tipo)) return num(p);
  const t = times(titulo);
  return p === 0 ? "empate" : `${esc(p > 0 ? t.casa : t.fora)} por ${num(Math.abs(p))}`;
}
function blocoJogo(id, j, X, A) {
  const titulo = j.titulo || "", G = X.filter((x) => x.atleta === "jogo"), P = X.filter((x) => x.atleta !== "jogo");
  const c = comportamento(P), sa = resumo(A), pend = A.filter((a) => !a.res).length, placar = placarDe(G, titulo);
  const resumoTxt = [placar && `<b>${esc(placar)}</b>`, X.length && `${X.length} linhas`, c.nMov && `andaram ▲ ${c.up} · ▼ ${c.down}${c.nj ? ` (movimento acertou ${pct(c.ac, c.nj)})` : ""}`,
    c.dec && `Over bateu ${pct(c.over, c.dec)} nas props`, A.length && `nossas apostas ${sa.g}–${sa.r}${sa.n ? ` · ${sinal(sa.lucro)} u` : ""}${pend ? ` · ${pend} pendentes` : ""}`].filter(Boolean).join(" · ");
  const aberto = abertos.has(id);
  return `<details class="acomp-jogo" data-jogo="${esc(id)}"${aberto ? " open" : ""}><summary><b>${esc(titulo)}</b> <span class="muted">${j.inicio ? hora(j.inicio) : ""}</span> · ${resumoTxt || "sem dados"}</summary><div class="corpo">${aberto ? corpoJogo(j, X, A) : ""}</div></details>`;
}
const tabJogo = (G, titulo) => (G.length ? `<h4>Mercados do jogo</h4><div class="tbl-wrap"><table class="props-tab acomp-tab"><thead><tr><th>Mercado</th><th class="n">Abertura<small>linha (visitante) · odds O / U</small></th><th class="n">Fechamento</th><th class="n">Movimento</th><th class="n">Edgely</th><th class="n">Real</th><th class="n">Resultado</th></tr></thead><tbody>
    ${G.sort((a, b) => (MERCADOS_JOGO[a.tipo.slice(5)]?.ordem || 9) - (MERCADOS_JOGO[b.tipo.slice(5)]?.ordem || 9)).map((x) => `<tr><td><b>${esc(TIPOS[x.tipo] || x.tipo)}</b></td>
      <td class="n">${x.tipo === "jogo-ml" ? "" : lin(x.L0)}${oddsTxt(x.O0, x.U0)}</td><td class="n"><b>${x.tipo === "jogo-ml" ? "" : lin(x.L1)}</b>${oddsTxt(x.O1, x.U1)}</td>
      <td class="n">${movTxt(x, titulo)}</td><td class="n">${projJogoTxt(x, titulo)}</td>
      <td class="n">${x.real == null ? "–" : ehTime(x.tipo) ? `${esc(times(titulo).fora)} ${sinal(x.real, 0)}` : x.real}</td><td class="n">${resultadoTxt(x, titulo)}${x.acertou != null ? `<small>movimento ${x.acertou ? "acertou" : "errou"}</small>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : "");
// as linhas de jogador que mais andaram neste jogo
function tabTop(P, titulo) {
  const top = P.filter((x) => x.dir).sort((a, b) => Math.abs(b.m) - Math.abs(a.m)).slice(0, 10);
  return top.length ? `<h4>Linhas que mais andaram</h4><div class="tbl-wrap"><table class="props-tab acomp-tab"><thead><tr><th>Jogador</th><th>Mercado</th><th class="n">Abertura<small>odds O / U</small></th><th class="n">Fechamento</th><th class="n">Movimento</th><th class="n">Edgely<small>12 h → antes do jogo</small></th><th class="n">Fez</th><th class="n">Resultado</th></tr></thead><tbody>
    ${top.map((x) => `<tr><td><b>${esc(x.nome)}</b></td><td>${esc(TIPOS[x.tipo] || x.tipo)}</td><td class="n">${lin(x.L0)}${oddsTxt(x.O0, x.U0)}</td><td class="n"><b>${lin(x.L1)}</b>${oddsTxt(x.O1, x.U1)}</td>
      <td class="n">${movTxt(x, titulo)}</td><td class="n">${x.proj12 != null && x.proj30 != null && Math.abs(x.proj30 - x.proj12) >= 0.5 ? `${num(x.proj12)} → ` : ""}${num(x.proj30 ?? x.proj12)}</td>
      <td class="n">${x.real ?? "–"}</td><td class="n">${resultadoTxt(x, titulo)}${x.acertou != null ? `<small>movimento ${x.acertou ? "acertou" : "errou"}</small>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : "";
}
const tabAp = (A) => (A.length ? `<h4>Nossas apostas neste jogo</h4><div class="tbl-wrap"><table class="props-tab acomp-tab"><thead><tr><th>Jogador</th><th>Mercado</th><th class="n">Projeção</th><th class="n">Aposta</th><th class="n">Odds O / U</th><th class="n">Valor esperado</th><th>Registro</th><th class="n">Fechamento<small>depois do registro</small></th><th class="n">Resultado</th></tr></thead><tbody>
    ${A.sort((a, b) => a.merc.localeCompare(b.merc) || a.nome.localeCompare(b.nome) || a.momento.localeCompare(b.momento)).map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(TIPOS[a.tipo] || a.tipo)}</td>
      <td class="n">${num(a.proj)}${a.min != null ? `<small>${num(a.min)} min</small>` : ""}</td>
      <td class="n"><b>${esc(a.lado)}${linhaDe(a.tipo, a.linha, a.ladoA)}</b> @ ${num(a.odd, 2)}</td><td class="n">${num(a.over, 2)} / ${num(a.under, 2)}</td>
      <td class="n">${a.valor == null ? "–" : `${sinal(100 * a.valor)}%`}</td><td>${MOMENTOS[a.momento]?.[1] || a.momento}${a.mov != null ? `<small>linha ${sinal(100 * a.mov)} pp até ali</small>` : ""}</td>
      <td class="n">${a.fech ? `${linhaDe(a.tipo, a.fech.L1, a.ladoA)} @ ${num(a.ladoA ? a.fech.O1 : a.fech.U1, 2)}${a.depois != null ? `<small class="${a.depois >= ANDOU ? "pos" : a.depois <= -ANDOU ? "neg" : ""}">${a.depois >= ANDOU ? "a favor" : a.depois <= -ANDOU ? "contra" : "parada"} ${sinal(100 * a.depois)} pp</small>` : ""}` : "–"}</td>
      <td class="n">${a.res ? `<span class="res ${RES[a.res][0]}">${RES[a.res][1]}</span>${a.real != null ? `<small>fez ${String(a.real).replace(".", ",")}</small>` : ""}` : `<span class="muted">pendente</span>`}</td></tr>`).join("")}
    </tbody></table></div>` : "");
function corpoJogo(j, X, A) {
  const titulo = j.titulo || "", G = X.filter((x) => x.atleta === "jogo"), P = X.filter((x) => x.atleta !== "jogo");
  const mercs = Object.keys(MERCADOS).filter((m) => X.some((x) => x.merc === m));
  return `${j.fechamento ? `<p class="muted">Fechamento ${esc(j.fechamento)}.</p>` : ""}
    ${listaInsights(insights(X, mercs, 3, 5))}${tabJogo(G, titulo)}${P.length ? `<h4>Como as linhas se comportaram, por mercado</h4>${tabelaComportamento(P, mercs.filter((m) => !m.startsWith("jogo-")))}` : ""}${tabTop(P, titulo)}${tabAp(A)}`;
}

// abrir um jogo monta o conteúdo dele; jogos e dias abertos/fechados ficam assim nos próximos desenhos
function ouvir(el) {
  if (el._acompOuvindo) return;
  el._acompOuvindo = true;
  el.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.dataset?.dia != null) { diasMudados.set(d.dataset.dia, d.open); return; }
    const id = d.dataset?.jogo;
    if (!id) return;
    if (!d.open) { abertos.delete(id); return; }
    abertos.add(id);
    const corpo = d.querySelector(":scope > .corpo");
    if (corpo && !corpo.innerHTML && ctx) corpo.innerHTML = corpoJogo(dados.jogos[id] || {}, ctx.X.filter((x) => x.jogo === id), ctx.L.filter((a) => a.jogo === id));
  }, true); // "toggle" não sobe: escuta na captura
}

// ---------- página ----------
export function renderAcomp(el, f) {
  ouvir(el);
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o acompanhamento.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!dados) { el.innerHTML = `<p class="muted">Carregando…</p>`; return; }
  const busca = nomeChave(f.busca), min = f.ev === "" ? -Infinity : +f.ev;
  const doMercado = (x) => !f.merc || x.merc === f.merc;
  const L0 = dados.apostas.filter((a) => doMercado(a) && (!busca || nomeChave(a.nome).includes(busca)) && (f.ev === "" || (a.valor != null && a.valor >= min)));
  const L = L0.filter((a) => !f.mom || a.momento === f.mom);
  const X = dados.linhas.filter((x) => doMercado(x) && (!busca || nomeChave(x.nome).includes(busca)));
  const mercsAp = Object.keys(MERCADOS).filter((m) => L0.some((a) => a.merc === m));
  const mercsX = Object.keys(MERCADOS).filter((m) => X.some((x) => x.merc === m));
  const nomeM = f.merc ? MERCADOS[f.merc] || f.merc : "";

  // 1) placar: estratégia × mercado (ignora o filtro "Registro")
  const placar = `<section class="panel"><h2>Placar das estratégias por mercado${nomeM ? ` · ${esc(nomeM)}` : ""}</h2>
    ${mercsAp.length ? (mercsAp.length === 1 ? tabelaGrupos("Estratégia / registro", Object.keys(MOMENTOS).map((k) => [MOMENTOS[k][0], (a) => a.momento === k]), L0)
      : matriz("Estratégia / registro", Object.keys(MOMENTOS).map((k) => [MOMENTOS[k][0], (a) => a.momento === k]), L0, mercsAp, "aguardando")) : `<div class="vazio"><b>Nenhuma aposta com esses filtros.</b></div>`}
    <p class="muted">Cada mercado é avaliado à parte (uma aposta de vencedor não diz nada sobre uma de rebotes). Célula: ROI e nº de apostas resolvidas · green–red; passe o mouse para o lucro e o intervalo de 95%. Cor: <span class="sit forte">forte</span> ROI ≥ 10% com o intervalo acima de zero · <span class="sit bom">promissor</span> ROI ≥ 5% · <span class="sit ruim">evitar</span> ROI ≤ −10% · cinza = menos de ${SIT_N} apostas. Estratégias registradas ~10 min antes de cada jogo com as odds daquele momento; o controle (Under em tudo) mostra se o mercado favoreceu o Under. Escolha um mercado e um registro nos filtros para os recortes.</p></section>`;

  // 2) recortes da estratégia escolhida, por mercado
  let detalhe;
  if (!f.mom) detalhe = `<section class="panel"><h2>Recortes por mercado</h2><div class="vazio"><b>Escolha um registro no filtro "Registro" para ver os recortes.</b><span>Cada estratégia tem a sua lógica (a mesma prop pode entrar em várias), então os recortes são sempre de uma estratégia, separados por mercado.</span></div></section>`;
  else {
    const mercs = Object.keys(MERCADOS).filter((m) => L.some((a) => a.merc === m));
    const s = resumo(L), ic = intervalo(s.v), pend = L.filter((a) => !a.res).length, anul = L.filter((a) => a.res === "A").length;
    const tiles = f.merc ? `<div class="tiles">${[
      ["Apostas resolvidas", `${s.n}`, `${pend} pendentes · ${anul} anuladas`],
      ["Green–Red", `${s.g}–${s.r}`, s.acerto == null ? "" : `acerto ${Math.round(100 * s.acerto)}% · odd média ${s.oddMedia ? num(s.oddMedia, 2) : "–"}`],
      ["Lucro", s.n ? `${sinal(s.lucro)} u` : "–", "1 unidade por aposta"],
      ["ROI", roiTxt(s), ic ? `95%: ${icTxt(ic)}` : "intervalo com ≥ 5 jogos"],
    ].map(([r, v, d]) => `<div class="tile"><span class="muted">${r}</span><b>${v}</b><small>${d}</small></div>`).join("")}</div>` : "";
    const faixas = [["0 a 5%", 0, 0.05], ["5 a 10%", 0.05, 0.10], ["10 a 20%", 0.10, 0.20], ["20 a 40%", 0.20, 0.40], ["40% ou mais", 0.40, Infinity]];
    const difs = [["até 1", 0, 1], ["1 a 2", 1, 2], ["2 a 4", 2, 4], ["4 ou mais", 4, Infinity]];
    const favor = (a) => (a.mov == null ? null : a.ladoA ? a.mov : -a.mov);
    detalhe = !L.length ? `<section class="panel"><h2>${esc(MOMENTOS[f.mom]?.[0] || f.mom)}</h2><div class="vazio"><b>Nenhuma aposta deste registro com esses filtros.</b></div></section>`
      : `<section class="panel"><h2>${esc(MOMENTOS[f.mom]?.[0] || f.mom)}${nomeM ? ` · ${esc(nomeM)}` : " · por mercado"}</h2>${tiles}
      ${recorte("Linha até o registro", [["andou a favor da aposta (≥ 3 pp)", (a) => favor(a) >= ANDOU], ["parada (< 3 pp)", (a) => favor(a) != null && Math.abs(favor(a)) < ANDOU], ["andou contra a aposta (≥ 3 pp)", (a) => favor(a) != null && favor(a) <= -ANDOU]], L, mercs)}
      ${recorte("Linha depois do registro (até o fechamento)", [["foi a favor (pegamos linha melhor que o fechamento)", (a) => a.depois >= ANDOU], ["parada", (a) => a.depois != null && Math.abs(a.depois) < ANDOU], ["foi contra (o fechamento ficou melhor)", (a) => a.depois != null && a.depois <= -ANDOU]], L, mercs)}
      ${recorte("Lado", [["Over (ou visitante)", (a) => a.ladoA], ["Under (ou mandante)", (a) => !a.ladoA]], L, mercs)}
      ${recorte("Valor esperado no registro", faixas.map(([r, a, b]) => [r, (x) => x.valor != null && x.valor >= a && x.valor < b]), L, mercs)}
      ${recorte("|Projeção − linha|", difs.map(([r, a, b]) => [r, (x) => x.proj != null && x.linha != null && Math.abs(x.proj - x.linha) >= a && Math.abs(x.proj - x.linha) < b]), L, mercs)}
      <p class="muted">"Linha depois do registro" compara a linha e a odd que pegamos com o fechamento (~10 min antes do jogo): pegar linha melhor que o fechamento costuma ser o melhor sinal de que a aposta tinha valor, mesmo antes do resultado. Intervalo de 95% por sorteio de jogos inteiros; com poucas semanas ele é largo.</p></section>`;
  }

  // 3) como as linhas se comportaram em cada mercado (todas as linhas do arquivo, não só as nossas apostas)
  const I = insights(X, mercsX, 15, 30);
  const comport = `<section class="panel"><h2>Como as linhas se comportaram, por mercado</h2>
    <p class="muted">Todas as linhas da DraftKings de ${new Set(X.map((x) => x.jogo)).size} jogos encerrados (não só as nossas apostas), da abertura ao fechamento (~10 min antes do jogo). <b>Andaram</b> = a linha + a odd mudaram o equivalente a ≥ 3 pp de chance. <b>Movimento acertou</b> = o resultado foi para o lado em que a linha andou (em relação à abertura). <b>Real − linha</b> &gt; 0 = as linhas fecharam baixas (no handicap, o visitante foi melhor que a linha). <b>Erro médio</b> = distância média entre o resultado e a linha de fechamento × a projeção do Edgely.</p>
    ${listaInsights(I)}${tabelaComportamento(X, mercsX) || `<div class="vazio"><b>Sem linhas no arquivo com esses filtros.</b></div>`}</section>`;

  // 4) jogo a jogo, por dia (do mais recente); arquivo + apostas (jogos de hoje só têm as apostas até encerrar)
  const ids = [...new Set([...X.map((x) => x.jogo), ...L.map((a) => a.jogo)])];
  const porDia = new Map();
  for (const id of ids) { const j = dados.jogos[id] || {}; if (!porDia.has(j.dia)) porDia.set(j.dia, []); porDia.get(j.dia).push(id); }
  const dias = [...porDia.keys()].sort().reverse();
  ctx = { X, L };
  const jogoAJogo = dias.map((d, i) => {
    const J = porDia.get(d).sort((a, b) => (dados.jogos[a]?.inicio || 0) - (dados.jogos[b]?.inicio || 0));
    const Ad = L.filter((a) => a.dia === d), sd = resumo(Ad);
    return `<details class="acomp-dia" data-dia="${esc(d)}"${diasMudados.get(d) ?? i === 0 ? " open" : ""}><summary><b>${diaTxt(d)}</b> · ${J.length} jogos${Ad.length ? ` · nossas apostas ${sd.g}–${sd.r}${sd.n ? ` · ${sinal(sd.lucro)} u` : ""}` : ""}</summary>
      ${J.map((id) => blocoJogo(id, dados.jogos[id] || {}, X.filter((x) => x.jogo === id), L.filter((a) => a.jogo === id))).join("")}</details>`;
  }).join("");

  el.innerHTML = placar + detalhe + comport + `<section class="panel"><h2>Jogo a jogo</h2><p class="muted">Clique num jogo: os mercados do jogo (abertura → fechamento → resultado), como as linhas de cada mercado se comportaram, as linhas que mais andaram e as nossas apostas${f.mom ? ` (${esc(MOMENTOS[f.mom]?.[1] || f.mom)})` : ""}, com a linha de fechamento de cada uma.</p>${jogoAJogo || `<div class="vazio"><b>Nenhum jogo com esses filtros.</b></div>`}</section>`;
}
