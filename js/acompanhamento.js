// Aba "Acompanhamento" de props.html: as apostas registradas todo dia às 12 h de Brasília pelo lado de maior valor
// esperado da projeção do Edgely contra a DraftKings (scripts/apostas_edgely.mjs) e o resultado de cada uma.
// Stake fixo de 1 unidade; devolvida conta como aposta com lucro 0, anulada (não jogou) fica fora.
// Intervalo de 95% do ROI por bootstrap por JOGO inteiro (as props do mesmo jogo andam juntas).
import { esc, hora } from "./formato.js";
import { nomeChave } from "./core.js";

const TIPOS = { points: "Pontos", rebounds: "Rebotes", assists: "Assistências", threes: "Cestas de 3", pra: "PRA" };
const RES = { G: ["green", "Green"], R: ["red", "Red"], P: ["push", "Devolvida"], A: ["anulada", "Anulada"] };
let dados = null, erro = null, lidoEm = 0;

// todas as apostas de todos os meses, como objetos
export async function carregarAcomp() {
  lidoEm = Date.now(); // já marca: evita duas leituras ao mesmo tempo
  try {
    const t = Date.now();
    const ler = (n) => fetch(`data/apostas_edgely/${n}?t=${t}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    const ind = await ler("indice.json");
    const ms = ind ? await Promise.all((ind.meses || []).map((m) => ler(`${m}.json`))) : [];
    const apostas = [];
    for (const M of ms.filter(Boolean)) {
      const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
      for (const a of M.apostas) {
        const j = M.jogos[a[C.jogo]] || {};
        apostas.push({
          jogo: a[C.jogo], dia: j.dia, titulo: j.titulo || "", inicio: j.inicio, nome: M.nomes[a[C.atleta]] || `atleta ${a[C.atleta]}`,
          tipo: a[C.tipo], linha: a[C.linha], over: a[C.over], under: a[C.under], lado: a[C.lado] === "O" ? "Over" : "Under",
          odd: a[C.lado] === "O" ? a[C.over] : a[C.under], proj: a[C.proj], min: a[C.min], valor: a[C.valor], final: !!a[C.final], res: a[C.res], real: a[C.real],
        });
      }
    }
    dados = { apostas, em: ind?.em || null };
    erro = null;
  } catch (e) {
    erro = e;
  }
  lidoEm = Date.now();
}
export const acompVelho = () => Date.now() - lidoEm > 5 * 60e3;

const lucroDe = (a) => (a.res === "G" ? a.odd - 1 : a.res === "R" ? -1 : 0);
const num = (v, c = 1) => v.toFixed(c).replace(".", ",");
const sinal = (v, c = 1) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v), c)}`;

// resumo de um grupo de apostas resolvidas (sem as anuladas)
function resumo(L) {
  const v = L.filter((a) => a.res && a.res !== "A");
  const g = v.filter((a) => a.res === "G").length, r = v.filter((a) => a.res === "R").length;
  const lucro = v.reduce((s, a) => s + lucroDe(a), 0);
  return { n: v.length, g, r, lucro, roi: v.length ? lucro / v.length : null, acerto: g + r ? g / (g + r) : null, oddMedia: v.length ? v.reduce((s, a) => s + a.odd, 0) / v.length : null, v };
}
// intervalo de 95% do ROI sorteando jogos inteiros (1.000 reamostragens)
function intervalo(v) {
  const por = new Map();
  for (const a of v) { const x = por.get(a.jogo) || por.set(a.jogo, { l: 0, n: 0 }).get(a.jogo); x.l += lucroDe(a); x.n++; }
  const J = [...por.values()];
  if (J.length < 5) return null;
  const rois = [];
  for (let b = 0; b < 1000; b++) {
    let l = 0, n = 0;
    for (let i = 0; i < J.length; i++) { const x = J[(Math.random() * J.length) | 0]; l += x.l; n += x.n; }
    rois.push(l / n);
  }
  rois.sort((a, b) => a - b);
  return [rois[25], rois[974]];
}

const roiTxt = (s) => (s.roi == null ? "–" : `${sinal(100 * s.roi)}%`);
function linhaGrupo(rot, L) {
  const s = resumo(L), ic = intervalo(s.v);
  return `<tr><td>${rot}</td><td class="n">${s.n}</td><td class="n">${s.g}–${s.r}</td><td class="n">${s.acerto == null ? "–" : `${Math.round(100 * s.acerto)}%`}</td>
    <td class="n">${s.oddMedia == null ? "–" : num(s.oddMedia, 2)}</td><td class="n">${s.n ? sinal(s.lucro) : "–"}</td>
    <td class="n"><b>${roiTxt(s)}</b>${ic ? `<small>${sinal(100 * ic[0], 0)}% a ${sinal(100 * ic[1], 0)}%</small>` : ""}</td></tr>`;
}
function tabelaGrupos(titulo, grupos) {
  const linhas = grupos.filter(([, L]) => L.length).map(([rot, L]) => linhaGrupo(rot, L)).join("");
  return linhas ? `<div class="tbl-wrap"><table class="props-tab acomp-grupos"><thead><tr><th>${titulo}</th><th class="n">Apostas</th><th class="n">Green–Red</th><th class="n">Acerto</th><th class="n">Odd média</th><th class="n">Lucro (u)</th><th class="n">ROI <small>(95%)</small></th></tr></thead><tbody>${linhas}</tbody></table></div>` : "";
}

export function renderAcomp(el, f) {
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o acompanhamento.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!dados) { el.innerHTML = `<p class="muted">Carregando…</p>`; return; }
  const busca = nomeChave(f.busca), min = f.ev === "" ? -Infinity : +f.ev;
  const L = dados.apostas.filter((a) => (!f.tipo || a.tipo === f.tipo) && (!busca || nomeChave(a.nome).includes(busca)) && a.valor >= min);
  if (!L.length) {
    el.innerHTML = `<div class="vazio"><b>${dados.apostas.length ? "Nenhuma aposta com esses filtros." : "Ainda não há apostas registradas: o 1º registro é hoje às 12 h de Brasília (jogos que ainda não começaram)."}</b></div>`;
    return;
  }
  const s = resumo(L), ic = intervalo(s.v), pend = L.filter((a) => !a.res).length, anul = L.filter((a) => a.res === "A").length;
  const tiles = [
    ["Apostas resolvidas", `${s.n}`, `${pend} pendentes · ${anul} anuladas`],
    ["Green–Red", `${s.g}–${s.r}`, s.acerto == null ? "" : `acerto ${Math.round(100 * s.acerto)}% · odd média ${s.oddMedia ? num(s.oddMedia, 2) : "–"}`],
    ["Lucro", s.n ? `${sinal(s.lucro)} u` : "–", "1 unidade por aposta"],
    ["ROI", roiTxt(s), ic ? `95%: ${sinal(100 * ic[0], 1)}% a ${sinal(100 * ic[1], 1)}%` : "intervalo com ≥ 5 jogos"],
  ].map(([r, v, d]) => `<div class="tile"><span class="muted">${r}</span><b>${v}</b><small>${d}</small></div>`).join("");

  const faixas = [["0 a 5%", 0, 0.05], ["5 a 10%", 0.05, 0.10], ["10 a 20%", 0.10, 0.20], ["20 a 40%", 0.20, 0.40], ["40% ou mais", 0.40, Infinity]];
  const difs = [["até 1", 0, 1], ["1 a 2", 1, 2], ["2 a 4", 2, 4], ["4 ou mais", 4, Infinity]];
  const grupos = [
    tabelaGrupos("Estatística", Object.entries(TIPOS).map(([k, r]) => [r, L.filter((a) => a.tipo === k)])),
    tabelaGrupos("Lado", [["Over", L.filter((a) => a.lado === "Over")], ["Under", L.filter((a) => a.lado === "Under")]]),
    tabelaGrupos("Valor esperado no registro", faixas.map(([r, a, b]) => [r, L.filter((x) => x.valor >= a && x.valor < b)])),
    tabelaGrupos("|Projeção − linha|", difs.map(([r, a, b]) => [r, L.filter((x) => Math.abs(x.proj - x.linha) >= a && Math.abs(x.proj - x.linha) < b)])),
  ].join("");

  // por dia, do mais recente; o dia mais recente aberto
  const dias = [...new Set(L.map((a) => a.dia))].sort().reverse();
  const porDia = dias.map((d, i) => {
    const D = L.filter((a) => a.dia === d).sort((a, b) => a.inicio - b.inicio || a.titulo.localeCompare(b.titulo) || b.valor - a.valor);
    const sd = resumo(D);
    return `<details class="acomp-dia"${i === 0 ? " open" : ""}><summary><b>${d.split("-").reverse().join("/")}</b> · ${D.length} apostas · ${sd.g}–${sd.r}${sd.n ? ` · ${sinal(sd.lucro)} u (${roiTxt(sd)})` : ""}${D.some((a) => !a.res) ? ` · ${D.filter((a) => !a.res).length} pendentes` : ""}</summary>
      <div class="tbl-wrap"><table class="props-tab acomp-tab"><thead><tr><th>Jogo</th><th>Jogador</th><th>Estatística</th><th class="n">Projeção</th><th class="n">Aposta</th><th class="n">Odds O / U</th><th class="n">Valor esperado</th><th class="n">Resultado</th></tr></thead><tbody>
      ${D.map((a) => `<tr><td>${esc(a.titulo)}<small>${a.inicio ? hora(a.inicio) : ""}</small></td><td><b>${esc(a.nome)}</b></td><td>${TIPOS[a.tipo] || a.tipo}</td>
        <td class="n">${num(a.proj)}${a.min != null ? `<small>${num(a.min)} min</small>` : ""}</td>
        <td class="n"><b>${a.lado} ${String(a.linha).replace(".", ",")}</b> @ ${num(a.odd, 2)}</td><td class="n">${num(a.over, 2)} / ${num(a.under, 2)}</td>
        <td class="n">${sinal(100 * a.valor)}%</td>
        <td class="n">${a.res ? `<span class="res ${RES[a.res][0]}">${RES[a.res][1]}</span>${a.real != null ? `<small>fez ${String(a.real).replace(".", ",")}</small>` : ""}` : `<span class="muted">pendente</span>`}</td></tr>`).join("")}
      </tbody></table></div></details>`;
  }).join("");

  el.innerHTML = `<section class="panel"><h2>Resultado</h2><div class="tiles">${tiles}</div>${grupos}
      <p class="muted">Intervalo de 95% por sorteio de jogos inteiros (as props do mesmo jogo não são independentes). Com poucas semanas ele é largo: só confie num lado quando o intervalo inteiro ficar acima de zero.</p></section>
    <section class="panel"><h2>Apostas por dia</h2>${porDia}</section>`;
}
