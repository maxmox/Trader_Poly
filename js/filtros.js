// Aba "Filtros" de props.html (22/10/2026; segmentada por mercado em 23/10): catálogo de filtros de mercado na NBA
// (DraftKings), props dos jogadores e mercados do jogo.
//  1) TEMPORADA (simulado): cada filtro aplicado ao arquivo do mercado (data/apostas_edgely/mercado-AAAA-MM.json:
//     todas as linhas de cada jogo encerrado, com abertura, fechamento ~10 min antes, projeções do Edgely e resultado),
//     entrando no FECHAMENTO dos dois lados (o do filtro e o oposto), no GERAL e em CADA MERCADO (pontos, rebotes…,
//     total do jogo, handicap, vencedor, 1º tempo/quartos). Stake 1; IC 95% por sorteio de jogos inteiros.
//  2) HOJE: as mesmas regras nas linhas de hoje com a linha e as odds de AGORA; cada sinal usa o resultado do filtro
//     NO MESMO MERCADO quando há amostra (senão o geral, marcado). Filtros de CONTROLE (Under/Over em tudo,
//     visitante) só servem de régua: aparecem na tabela, nunca como sinal.
// Uma linha "x" tem: tipo, L0/O0/U0 (abertura), L1/O1/U1 (fechamento ou agora), proj12 (Edgely às 12 h), proj30
// (Edgely mais recente antes do jogo). Lado "O" = Over ou VISITANTE (handicap/vencedor), "U" = Under ou mandante.
import { esc, hora } from "./formato.js";
import { semMargem, movimentoMercado, nomeChave, TIPOS_PROP, ORDEM_PROJ, MERCADOS_JOGO, ladoDaProjecao, ladoDaMudanca, resultadoA } from "./core.js";

// mercados (segmentos): cada estatística de jogador; no jogo, total, handicap, vencedor e "1º tempo e quartos"
export const MERCADOS = {
  ...Object.fromEntries(Object.entries(TIPOS_PROP).map(([k, v]) => [k, v])),
  "jogo-total": "Total do jogo", "jogo-spread": "Handicap", "jogo-ml": "Vencedor", "jogo-parcial": "1º tempo e quartos",
};
export const mercadoDe = (tipo) => (/^jogo-(h1|q\d)$/.test(tipo) ? "jogo-parcial" : tipo);
const TIPOS = { ...Object.fromEntries(Object.entries(TIPOS_PROP).map(([k, v]) => [k, v.toLowerCase()])), pra: "PRA",
  ...Object.fromEntries(Object.entries(MERCADOS_JOGO).map(([k, m]) => [`jogo-${k}`, m.nome.toLowerCase()])) };
const temUnder = (x) => x.tipo !== "jogo-spread" && x.tipo !== "jogo-ml"; // Over/Under existe (props e totais)
const ANDOU = 0.03;
const mov = (x) => { if (x._m === undefined) x._m = movimentoMercado(x.tipo, x.L0, x.L1, semMargem(x.O0, x.U0), semMargem(x.O1, x.U1)); return x._m; };
const ladoMov = (x, c = ANDOU) => { const m = mov(x); return m == null ? null : m >= c ? "O" : m <= -c ? "U" : null; };
const dirDe = (m, c = ANDOU) => (m == null ? null : m >= c ? "O" : m <= -c ? "U" : null);
// movimento da MANHÃ (abertura → 12 h de Brasília) e da TARDE (12 h → agora/fechamento); null sem a linha das 12 h
const tarde = (x) => { if (x._t === undefined) x._t = x.L12 == null || x.O12 == null ? null : movimentoMercado(x.tipo, x.L12, x.L1, semMargem(x.O12, x.U12), semMargem(x.O1, x.U1)); return x._t; };
const cedo = (x) => { if (x._c === undefined) x._c = x.L12 == null || x.O12 == null ? null : movimentoMercado(x.tipo, x.L0, x.L12, semMargem(x.O0, x.U0), semMargem(x.O12, x.U12)); return x._c; };
// linha "alta" (estrela) por mercado
const ALTA = { points: 22.5, rebounds: 8.5, assists: 6.5, threes: 3.5, pra: 33.5, pa: 27.5, pr: 28.5, ra: 12.5 };
// a LINHA mudou para qual lado (props/totais: subiu → Over; handicap: linha do visitante caiu → visitante) e a ODD
// (chance sem margem, cada uma na sua linha) para qual lado
const ladoLinha = (x) => (x.L0 == null || x.L1 == null || x.L0 === x.L1 ? null : x.tipo === "jogo-spread" ? (x.L1 < x.L0 ? "O" : "U") : (x.L1 > x.L0 ? "O" : "U"));
const ladoOdd = (x, c = 0.01) => { const p0 = semMargem(x.O0, x.U0), p1 = semMargem(x.O1, x.U1); return p0 == null || p1 == null || Math.abs(p1 - p0) < c ? null : p1 > p0 ? "O" : "U"; };
const projAtual = (x) => x.proj30 ?? x.proj12;
const dirProj = (x) => ladoDaProjecao(x.tipo, projAtual(x), x.L0 ?? x.L1);
// lado da projeção em relação à linha ATUAL se a distância for ≥ d (vencedor: não tem linha)
const difProj = (x, d) => { const p = projAtual(x); return p == null || x.L1 == null || x.tipo === "jogo-ml" || Math.abs(p - x.L1) < d ? null : ladoDaProjecao(x.tipo, p, x.L1); };
const mudouLado = (x) => (x.proj12 == null || x.proj30 == null || Math.abs(x.proj30 - x.proj12) < 0.5 ? null : ladoDaMudanca(x.tipo, x.proj12, x.proj30));
const oposto = (l) => (l === "O" ? "U" : "O");

// catálogo: [id, grupo, nome, lado(x)]; grupo "Controle" = régua, nunca sinal
export const FILTROS = [
  ["mov", "Linha andou", "Seguir o movimento (≥ 3 pp)", (x) => ladoMov(x)],
  ["mov6", "Linha andou", "Seguir o movimento forte (≥ 6 pp)", (x) => ladoMov(x, 0.06)],
  ["mov-over", "Linha andou", "Andou p/ Over (ou visitante) → esse lado", (x) => (ladoMov(x) === "O" ? "O" : null)],
  ["mov-under", "Linha andou", "Andou p/ Under (ou mandante) → esse lado", (x) => (ladoMov(x) === "U" ? "U" : null)],
  ["parada-under", "Linha andou", "Linha parada (< 3 pp) → Under", (x) => (temUnder(x) && mov(x) != null && !ladoMov(x) ? "U" : null)],
  ["linha-odd", "Linha e odd", "Linha andou e a odd foi junto → esse lado", (x) => { const l = ladoLinha(x); return l && ladoOdd(x) === l ? l : null; }],
  ["linha-volta", "Linha e odd", "Linha andou e a odd voltou → lado da linha", (x) => { const l = ladoLinha(x), o = ladoOdd(x); return l && o && o !== l ? l : null; }],
  ["so-odd", "Linha e odd", "Só a odd andou (≥ 3 pp, mesma linha) → esse lado", (x) => (x.L0 === x.L1 || x.tipo === "jogo-ml" ? ladoOdd(x, ANDOU) : null)],
  ["conf", "Projeção × linha", "Projeção confirmada pela linha → lado da projeção", (x) => (dirProj(x) && ladoMov(x) === dirProj(x) ? dirProj(x) : null)],
  ["contra", "Projeção × linha", "Linha contra a projeção → lado da linha", (x) => (dirProj(x) && ladoMov(x) && ladoMov(x) !== dirProj(x) ? ladoMov(x) : null)],
  ["proj-parada", "Projeção × linha", "Linha parada → lado da projeção", (x) => (dirProj(x) && mov(x) != null && !ladoMov(x) ? dirProj(x) : null)],
  ["proj-lado", "Projeção × linha", "Lado da projeção (qualquer distância da linha atual)", (x) => (x.tipo === "jogo-ml" ? ladoDaProjecao(x.tipo, projAtual(x), null) : difProj(x, 0.01))],
  ["dif1", "Projeção × linha", "Projeção a ≥ 1 da linha atual → lado da projeção", (x) => difProj(x, 1)],
  ["dif2", "Projeção × linha", "Projeção a ≥ 2 da linha atual → lado da projeção", (x) => difProj(x, 2)],
  ["mudou-seguiu", "Projeção mudou", "Projeção mudou ≥ 0,5 e a linha foi junto → esse lado", (x) => { const l = mudouLado(x); return l && ladoMov(x) === l ? l : null; }],
  ["mudou-sozinha", "Projeção mudou", "Projeção mudou ≥ 0,5 e a linha NÃO foi junto → lado da projeção", (x) => { const l = mudouLado(x); return l && ladoMov(x) !== l ? l : null; }],
  ["over-loteria", "Over de loteria", "Over pagando ≥ 2,10 → Under", (x) => (temUnder(x) && x.O1 >= 2.1 ? "U" : null)],
  ["under-fav", "Over de loteria", "Under favorito (odd ≤ 1,75) → Under", (x) => (temUnder(x) && x.U1 && x.U1 <= 1.75 ? "U" : null)],
  ["linha-baixa", "Over de loteria", "Linha baixa (≤ 1,5) → Under", (x) => (temUnder(x) && x.L1 != null && x.L1 <= 1.5 ? "U" : null)],
  // 24/10: o movimento separado em manhã e tarde, e a linha alta
  ["tarde", "Linha à tarde", "Andou à tarde (desde as 12 h, ≥ 3 pp) → esse lado", (x) => dirDe(tarde(x))],
  ["tarde-under", "Linha à tarde", "Caiu à tarde e desde a abertura → Under", (x) => (temUnder(x) && tarde(x) != null && tarde(x) <= -ANDOU && ladoMov(x) === "U" ? "U" : null)],
  ["cedo", "Linha de manhã", "Andou só de manhã (até as 12 h) → esse lado", (x) => { const c = dirDe(cedo(x)); return c && tarde(x) != null && !dirDe(tarde(x)) ? c : null; }],
  ["estrela", "Linha alta", "Linha alta (estrela) → Under", (x) => (ALTA[x.tipo] != null && x.L1 >= ALTA[x.tipo] ? "U" : null)],
  ["under", "Controle", "Under em tudo", (x) => (temUnder(x) ? "U" : null)],
  ["over", "Controle", "Over em tudo", (x) => (temUnder(x) ? "O" : null)],
  ["visitante", "Controle", "Visitante (handicap e vencedor)", (x) => (temUnder(x) ? null : "O")],
];
const ehControle = (id) => FILTROS.find((f) => f[0] === id)?.[1] === "Controle";

const lucro = (x, lado) => {
  const o = lado === "O" ? x.O1 : x.U1;
  const r = o ? resultadoA(x.tipo, x.real, x.L1) : null; // 1 = lado A ganha, 0 devolve, −1 perde
  if (r == null || (x.L1 == null && x.tipo !== "jogo-ml")) return null;
  return r === 0 ? 0 : (r > 0) === (lado === "O") ? o - 1 : -1;
};
function estat(v, sorteios = 600) { // v: [{jogo, dia, l}]
  if (!v.length) return null;
  const tot = v.reduce((s, a) => s + a.l, 0), g = v.filter((a) => a.l > 0).length, r = v.filter((a) => a.l < 0).length;
  const por = new Map(), dias = new Map();
  for (const a of v) {
    const q = por.get(a.jogo) || por.set(a.jogo, { l: 0, n: 0 }).get(a.jogo); q.l += a.l; q.n++;
    dias.set(a.dia, (dias.get(a.dia) || 0) + a.l);
  }
  const J = [...por.values()];
  let ic = null;
  if (J.length >= 5) {
    const rs = [];
    for (let b = 0; b < sorteios; b++) { let l = 0, n = 0; for (let i = 0; i < J.length; i++) { const q = J[(Math.random() * J.length) | 0]; l += q.l; n += q.n; } rs.push(l / n); }
    rs.sort((a, b) => a - b);
    ic = [rs[Math.floor(sorteios * 0.025)], rs[Math.floor(sorteios * 0.975) - 1]];
  }
  return { n: v.length, g, r, roi: tot / v.length, lucro: tot, ic, dias: dias.size, diasPos: [...dias.values()].filter((l) => l > 0).length, jogos: J.length };
}
// simulação de cada filtro, nos dois lados, no geral e por mercado: sim[id] = { lado, oposto, por: { mercado: {lado, oposto} } }
export function simular(props, sorteios = 600) {
  const sim = {};
  for (const [id, , , regra] of FILTROS) {
    const a = [], b = [], pa = {}, pb = {}, ld = {}, lo = {};
    for (const x of props) {
      const l = regra(x);
      if (!l) continue;
      const la = lucro(x, l), lb = lucro(x, oposto(l)), m = mercadoDe(x.tipo);
      if (la != null) { const r = { jogo: x.jogo, dia: x.dia, l: la }; a.push(r); (pa[m] ||= []).push(r); (ld[l] ||= []).push(r); (ld[`${m}|${l}`] ||= []).push(r); }
      if (lb != null) { const r = { jogo: x.jogo, dia: x.dia, l: lb }; b.push(r); (pb[m] ||= []).push(r); (lo[oposto(l)] ||= []).push(r); (lo[`${m}|${oposto(l)}`] ||= []).push(r); }
    }
    sim[id] = { lado: estat(a, sorteios), oposto: estat(b, sorteios), por: Object.fromEntries(Object.keys(pa).map((m) => [m, { lado: estat(pa[m], sorteios), oposto: estat(pb[m] || [], sorteios) }])),
      // porLado["O"|"U"] (todos os mercados) e porLado["<mercado>|O"|"<mercado>|U"]: apostando no lado do filtro
      porLado: Object.fromEntries(Object.entries(ld).map(([k, v]) => [k, estat(v, sorteios)])),
      // porOp[...]: apostando CONTRA o filtro, chave = lado da aposta (ex.: filtro aponta Over → porOp["points|U"])
      porOp: Object.fromEntries(Object.entries(lo).map(([k, v]) => [k, estat(v, sorteios)])) };
  }
  return sim;
}

// ---------- dados ----------
let arquivo = null, p12 = {}, pj12 = {}, lidoEm = 0, erro = null;
// linhas do arquivo do mercado (mercado-AAAA-MM.json) → objetos dos filtros
export function propsDoArquivo(Ms) {
  const props = [];
  for (const M of Ms.filter(Boolean)) {
    const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
    for (const a of M.props) {
      const j = M.jogos[a[C.jogo]] || {};
      props.push({ jogo: a[C.jogo], dia: j.dia, tipo: a[C.tipo], L0: a[C.L0], O0: a[C.O0], U0: a[C.U0], L1: a[C.L1], O1: a[C.O1], U1: a[C.U1], proj12: a[C.proj12], proj30: a[C.proj30], real: a[C.real], L12: a[C.L12] ?? null, O12: a[C.O12] ?? null, U12: a[C.U12] ?? null });
    }
  }
  return props;
}
// resumo da temporada para a página (data/resumo/filtros.json, gravado pela Action em scripts/resumo.mjs): simulação,
// persistência e os retratos das 12 h dos jogos que ainda vão começar (A = arquivos de apostas dos meses recentes)
export function montarFiltros(props, A, agora = Date.now()) {
  const p12 = {}, pj12 = {};
  for (const M of A.filter(Boolean)) for (const [id, j] of Object.entries(M.jogos || {})) {
    if (j.inicio && j.inicio < agora - 12 * 3600e3) continue;
    if (j.p12) p12[id] = j.p12;
    if (j.pj12) pj12[id] = j.pj12;
  }
  const porMercado = {};
  for (const x of props) if (x.real != null) porMercado[mercadoDe(x.tipo)] = (porMercado[mercadoDe(x.tipo)] || 0) + 1;
  return { em: agora, sim: simular(props), pers: persistencia(props), dims: montarDims(props), porMercado, nProps: props.length, dias: new Set(props.map((x) => x.dia)).size, jogos: new Set(props.map((x) => x.jogo)).size, p12, pj12 };
}
// LEVE (24/10): a página lê o resumo pronto (antes baixava a temporada inteira e simulava no navegador)
export async function carregarFiltros() {
  lidoEm = Date.now();
  try {
    const r = await fetch(`data/resumo/filtros.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`resumo indisponível (${r.status})`);
    arquivo = await r.json();
    p12 = arquivo.p12 || {}; pj12 = arquivo.pj12 || {};
    erro = null;
  } catch (e) { erro = e; }
  lidoEm = Date.now();
}
export const filtrosVelho = () => Date.now() - lidoEm > 10 * 60e3;

// ---------- render ----------
// linha que apareceu há menos de 2 h: minutos desde a 1ª vez vista (props.js preenche x.vistoEm)
const novaDesde = (x) => (x.vistoEm != null && Date.now() - x.vistoEm < 2 * 3600e3 ? Math.max(1, Math.round((Date.now() - x.vistoEm) / 60e3)) : 0);
// hora do jogo; "amanhã" quando é do dia seguinte (a página carrega hoje e amanhã)
const quandoJogo = (j) => { const d = new Date(j.inicio), h = new Date(); return d.toDateString() === h.toDateString() ? hora(j.inicio) : `amanhã ${hora(j.inicio)}`; };
const num = (v, c = 1) => (v == null ? "–" : v.toFixed(c).replace(".", ","));
const pc = (v, c = 1) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${num(Math.abs(100 * v), c)}%`);
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
// situação do filtro na temporada
function situacao(s, minN) {
  if (!s || s.n < minN) return ["pouco", "amostra pequena"];
  if (s.roi >= 0.10 && s.ic && s.ic[0] > 0) return ["forte", "forte"];
  if (s.roi >= 0.05) return ["bom", "promissor"];
  if (s.roi <= -0.10) return ["ruim", "evitar (o oposto ganha)"];
  return ["neutro", "sem vantagem"];
}
// mercados que entram na visão escolhida ("" = todos; "jogo" = só os do jogo; uma estatística = só ela)
const mercadosDaVisao = (tipo) => Object.keys(MERCADOS).filter((m) => arquivo.porMercado[m] && (!tipo || (tipo === "jogo" ? m.startsWith("jogo-") : m === tipo)));

// visão geral: matriz filtro × mercado (ROI e nº de apostas; cor = situação com a amostra mínima)
function matriz(minN, mercs) {
  const celula = (s) => { const [cls] = situacao(s, minN); return s ? `<td class="n cel sit-${cls}"><b>${pc(s.roi, 0)}</b><small>${s.n}</small></td>` : `<td class="n cel"><span class="muted">–</span></td>`; };
  const grupos = [...new Set(FILTROS.map((f) => f[1]))];
  const corpo = grupos.map((g) => `<tr class="grupo"><th colspan="${mercs.length + 2}">${esc(g)}${g === "Controle" ? " (régua, não é sinal)" : ""}</th></tr>` +
    FILTROS.filter((f) => f[1] === g).map(([id, , nome]) => `<tr${g === "Controle" ? ' class="controle"' : ""}><td>${esc(nome)}</td>${celula(arquivo.sim[id].lado)}${mercs.map((m) => celula(arquivo.sim[id].por[m]?.lado)).join("")}</tr>`).join("")).join("");
  return `<div class="tbl-wrap"><table class="props-tab filtros-matriz"><thead><tr><th>Filtro</th><th class="n">Geral</th>${mercs.map((m) => `<th class="n">${esc(MERCADOS[m])}<small>${arquivo.porMercado[m]} linhas</small></th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}
// visão de um mercado: detalhe de cada filtro só naquele mercado
function detalheMercado(minN, m) {
  const grupos = [...new Set(FILTROS.map((f) => f[1]))];
  return `<div class="tbl-wrap"><table class="props-tab filtros-temp"><thead><tr><th>Filtro</th><th class="n">Apostas</th><th class="n">Green–Red</th><th class="n">ROI <small>(95%)</small></th><th class="n">Dias com lucro</th><th class="n">Lado oposto</th><th>Situação</th></tr></thead><tbody>` +
    grupos.map((g) => `<tr class="grupo"><th colspan="7">${esc(g)}${g === "Controle" ? " (régua, não é sinal)" : ""}</th></tr>` + FILTROS.filter((f) => f[1] === g).map(([id, , nome]) => {
      const { lado: s, oposto: o } = arquivo.sim[id].por[m] || {};
      const [cls, rot] = situacao(s, minN);
      return `<tr class="sit-${cls}${g === "Controle" ? " controle" : ""}"><td>${esc(nome)}</td><td class="n">${s ? s.n : 0}</td><td class="n">${s ? `${s.g}–${s.r}` : "–"}</td>
        <td class="n"><b>${pc(s?.roi)}</b>${s?.ic ? `<small>${pc(s.ic[0], 0)} a ${pc(s.ic[1], 0)}</small>` : ""}</td>
        <td class="n">${s ? `${s.diasPos}/${s.dias}` : "–"}</td><td class="n">${pc(o?.roi)}</td><td>${g === "Controle" ? "" : `<span class="sit ${cls}">${rot}</span>`}</td></tr>`;
    }).join("")).join("") + `</tbody></table></div>`;
}

// ---------- O QUE SE REPETE (persistência) E A CONFIANÇA DO LADO (24/10/2026; substitui a classe A/B/C) ----------
// O backtest fora da amostra (scripts/backtest_confianca.mjs) mostrou que o ROI de um filtro numa noite NÃO prevê o da
// noite seguinte (garimpo: "linha andou" e "projeção × linha" até se invertem), e que a margem da casa (Over caro) e o
// movimento da tarde se repetem. Então o peso de cada grupo é MEDIDO nos dados: deixando uma noite de fora, o quanto do
// resultado das outras noites (filtro × mercado × lado, em EXCESSO sobre a margem do mesmo mercado e lado; a margem em
// si, crua) se repete na noite de fora — inclinação pela origem, entre 0 e 1. Só ganha peso o grupo com ≥ 8 pares vindos
// de ≥ 3 noites de teste diferentes (com 2 noites, o "padrão" da 1ª noite se inverteu na 2ª em quase tudo: 24/10).
// Os pesos se recalculam a cada noite nova: um grupo que começar a se repetir ganha peso sozinho.
export function persistencia(props) {
  const dias = [...new Set(props.map((x) => x.dia))].sort(), base = {}, seg = new Map();
  const soma = (o, k, v) => { const q = (o[k] ||= { l: 0, n: 0 }); q.l += v; q.n++; };
  for (const x of props) {
    if (x.real == null) continue;
    const m = mercadoDe(x.tipo);
    for (const lb of ["O", "U"]) { const v = lucro(x, lb); if (v != null) soma(base, `${m}|${lb}|${x.dia}`, v); }
    for (const [id, grupo, , regra] of FILTROS) {
      const l = regra(x);
      if (!l) continue;
      // a margem é medida por LADO: "o Over perde" (persiste) não é o mesmo que "o Under ganha" (quase sempre ~0)
      for (const lb of grupo === "Controle" ? (id === "visitante" ? ["O", "U"] : [l]) : [l, oposto(l)]) {
        const v = lucro(x, lb);
        if (v == null) continue;
        const g = grupo === "Controle" ? `Controle|${lb}` : `${grupo}|${lb === l ? "com" : "contra"}`, k = `${g}#${id}|${m}|${lb}`;
        soma((seg.get(k) || seg.set(k, { g, m, lb, d: {} }).get(k)).d, x.dia, v);
      }
    }
  }
  const roiBase = (m, lb, ds) => { let l = 0, n = 0; for (const d of ds) { const q = base[`${m}|${lb}|${d}`]; if (q) { l += q.l; n += q.n; } } return n ? l / n : 0; };
  const pares = {};
  for (const { g, m, lb, d: D } of seg.values()) for (const d of dias) {
    const te = D[d];
    if (!te || te.n < 10) continue;
    const outras = dias.filter((e) => e !== d);
    let l = 0, n = 0;
    for (const e of outras) if (D[e]) { l += D[e].l; n += D[e].n; }
    if (n < 20) continue;
    const ctl = g.startsWith("Controle");
    (pares[g] ||= []).push([l / n - (ctl ? 0 : roiBase(m, lb, outras)), te.l / te.n - (ctl ? 0 : roiBase(m, lb, [d])), (te.n * 30) / (te.n + 30), d]);
  }
  const out = {};
  for (const [g, P] of Object.entries(pares)) {
    const sxy = P.reduce((t, [a, b, w]) => t + w * a * b, 0), sxx = P.reduce((t, [a, , w]) => t + w * a * a, 0);
    const F = P.filter(([a]) => Math.abs(a) >= 0.05);
    const noites = new Set(P.map((q) => q[3])).size;
    out[g] = { b: P.length >= 8 && noites >= 3 && sxx > 0 ? Math.min(1, Math.max(0, sxy / sxx)) : 0, bruto: sxx > 0 ? sxy / sxx : null, pares: P.length, noites,
      acerto: F.length ? F.filter(([a, b]) => Math.sign(a) === Math.sign(b)).length / F.length : null };
  }
  return out;
}

// Confiança do lado: para cada lado, a MARGEM do mercado (controle: Over/Under em tudo; visitante/mandante) × o peso
// do controle + cada grupo de filtros que a linha aciona (com o filtro ou contra ele), pelo EXCESSO sobre a margem ×
// o peso do grupo. Cada número é encolhido pela amostra (priori normal, vantagem verdadeira ~ N(0; τ = 6%)). Lado = o de
// maior ROI esperado; confiança = 100 × (2·Φ(média/desvio) − 1): 0 = moeda, 100 = certeza de ROI > 0.
// "Fora do padrão" = linha em que os filtros COM PESO acrescentam algo positivo além da margem (só esses entram na lista).
export const PARAM = { tau: 0.06 };
const fi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2), q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
function encolher(roi, s, tau) {
  const ep = Math.max(s.ic ? (s.ic[1] - s.ic[0]) / 3.92 : 0, 0.95 / Math.sqrt(s.n));
  return { media: (roi * tau * tau) / (tau * tau + ep * ep), dp: Math.sqrt(1 / (1 / (tau * tau) + 1 / (ep * ep))) };
}
const ehTime = (m) => m === "jogo-spread" || m === "jogo-ml";
export function evidencias(x, minN, sim = arquivo.sim, P = PARAM, pers = arquivo.pers) {
  const m = mercadoDe(x.tipo), out = [];
  const escolhe = (seg, ger) => (seg && seg.n >= minN ? seg : ger && ger.n >= minN ? ger : null);
  const B = {};
  for (const l of ["O", "U"]) { // margem da casa neste mercado
    const S = sim[ehTime(m) ? "visitante" : l === "O" ? "over" : "under"];
    if (!S) continue;
    const pega = (q) => (ehTime(m) && l === "U" ? q?.oposto : q?.lado);
    const s = escolhe(pega(S.por[m]), pega(S));
    if (!s) continue;
    B[l] = s;
    const w = pers?.[`Controle|${l}`]?.b ?? 0, e = encolher(s.roi, s, P.tau);
    out.push({ id: "base", grupo: "Margem da casa", nome: `Base do mercado: ${ehTime(m) ? (l === "O" ? "visitante" : "mandante") : l === "O" ? "Over" : "Under"} em tudo`, lado: l, s, geral: s !== pega(S.por[m]), peso: w, exc: s.roi, media: w * e.media, dp: w * e.dp });
  }
  for (const [id, grupo, nome, regra] of FILTROS) {
    if (grupo === "Controle") continue;
    const l = regra(x);
    if (!l) continue;
    const S = sim[id];
    for (const [lado, seg, ger, contra] of [[l, S.porLado[`${m}|${l}`], S.porLado[l], false], [oposto(l), S.porOp?.[`${m}|${oposto(l)}`], S.porOp?.[oposto(l)], true]]) {
      const s = escolhe(seg, ger);
      if (!s) continue;
      const exc = s.roi - (B[lado]?.roi ?? 0), w = pers?.[`${grupo}|${contra ? "contra" : "com"}`]?.b ?? 0, e = encolher(exc, s, P.tau);
      out.push({ id, grupo, nome, lado, s, contra, geral: s !== seg, peso: w, exc, media: w * e.media, dp: w * e.dp });
    }
  }
  return out;
}
function somaLado(ev, l) {
  const E = ev.filter((e) => e.lado === l), base = E.find((e) => e.id === "base"), grupos = new Map();
  for (const e of E) if (e.id !== "base") (grupos.get(e.grupo) || grupos.set(e.grupo, []).get(e.grupo)).push(e);
  let filtros = 0, v = (base?.dp ?? 0) ** 2;
  for (const L of grupos.values()) { filtros += L.reduce((t, e) => t + e.media, 0) / L.length; v += (L.reduce((t, e) => t + e.dp, 0) / L.length) ** 2; } // filtros do mesmo grupo: média (não somam)
  return { media: (base?.media ?? 0) + filtros, filtros, dp: Math.sqrt(v), E };
}
export function decidir(ev) {
  if (!ev.length) return null;
  const O = somaLado(ev, "O"), U = somaLado(ev, "U");
  if (O.media === U.media) return null; // nada com peso: sem lado (não é empate a favor do Over)
  const [a, lado] = O.media > U.media ? [O, "O"] : [U, "U"];
  const z = a.dp > 0 ? a.media / a.dp : 0;
  return { lado, conf: Math.max(0, Math.round(100 * (2 * fi(z) - 1))), esperado: a.media, filtros: a.filtros,
    favor: a.E.filter((e) => e.exc > 0).sort((p, q) => q.media - p.media || q.exc - p.exc), alertas: a.E.filter((e) => e.id !== "base" && e.peso > 0 && e.media < 0), conflito: false };
}

// ---------- LEITURA DA LINHA: MOVIMENTO E PROJEÇÃO, RELATIVOS AO JOGO (25/10/2026) ----------
// Pedido do usuário: "de que lado está o dinheiro", focado no movimento da linha e na projeção do Edgely, sempre no
// MESMO MERCADO (nunca juntar pontos com assistências). A rodada de 24/10 mostrou que o placar do jogo decide as props
// (correlação 0,72 entre o total passar da linha e o % de props Over do jogo): numa noite de Over, todo Under perde.
// Então cada linha é medida RELATIVA AO JOGO: lucro de um lado − média do mesmo lado nas OUTRAS props de jogador do
// mesmo jogo (o "clima" do jogo sai da conta e fica o que é da linha). E noite a noite: um lado só ganha cor forte se
// for melhor que o jogo na maioria das noites.
//   mov    = movimento total (abertura → agora; no histórico, → fechamento), em pp de chance na linha de abertura
//   tarde  = movimento desde as 12 h de Brasília (o da manhã é ruído; em 25/10, ▼ 3–6 pp à tarde: Under melhor que o
//            jogo nas 4 noites, +9 pp em todos os mercados, +25 pp em pontos)
//   proj   = projeção do Edgely × linha atual, em desvios (17,5 com projeção 19 em pontos ≈ "acima")
//   projab = projeção do Edgely × linha de ABERTURA (a casa abriu longe da projeção?)
// Só props de jogador (os mercados do jogo não têm "outras linhas do jogo" para comparar).
const NORMAIS_P = new Set(["points", "pra", "pa", "pr"]);
const dpProj = (tipo, p) => (NORMAIS_P.has(tipo) ? 1.4 * Math.sqrt(Math.max(p, 1)) : Math.sqrt(1.25 * Math.max(p, 0.5)));
const zProj = (x, L) => { const p = x.proj30 ?? x.proj12; return p == null || L == null || x.tipo.startsWith("jogo-") ? null : (p - L) / dpProj(x.tipo, p); };
const faixa = (v, cortes) => (v == null || !Number.isFinite(v) ? null : cortes.findIndex((c) => v < c) === -1 ? cortes.length : cortes.findIndex((c) => v < c));
const R_MOV = ["▼ Under ≥ 6 pp", "▼ Under 3–6 pp", "parada", "▲ Over 3–6 pp", "▲ Over ≥ 6 pp"], C_MOV = [-0.06, -0.03, 0.03, 0.06];
const R_Z = ["bem abaixo", "abaixo", "na linha", "acima", "bem acima"], C_Z = [-0.4, -0.15, 0.15, 0.4];
export const DIMS = [
  ["mov", "Movimento total", "abertura → agora", (x) => faixa(mov(x), C_MOV), R_MOV],
  ["tarde", "Movimento da tarde", "12 h de Brasília → agora", (x) => faixa(tarde(x), C_MOV), R_MOV],
  ["proj", "Projeção × linha", "Edgely × linha atual", (x) => faixa(zProj(x, x.L1), C_Z), R_Z.map((r) => `proj. ${r}`)],
  ["projab", "Projeção × abertura", "Edgely × linha de abertura", (x) => faixa(zProj(x, x.L0), C_Z), R_Z.map((r) => `proj. ${r}`)],
];
const ehProp = (tipo) => tipo in TIPOS_PROP;
// temporada: dims["<dim>|<mercado>|<faixa>|<O/U>"] = [n, vitórias, ROI cru, relativo ao jogo (média), erro-padrão do
// relativo (agrupado por jogo), noites, noites em que o relativo foi > 0]
export function montarDims(props) {
  const doJogo = new Map(); // "<jogo>|<lado>" → soma e nº do lucro nas props de jogador do jogo
  for (const x of props) {
    if (x.real == null || !ehProp(x.tipo)) continue;
    for (const l of ["O", "U"]) { const v = lucro(x, l); if (v == null) continue; const q = doJogo.get(`${x.jogo}|${l}`) || doJogo.set(`${x.jogo}|${l}`, { s: 0, n: 0 }).get(`${x.jogo}|${l}`); q.s += v; q.n++; }
  }
  const acc = new Map();
  for (const x of props) {
    if (x.real == null || !ehProp(x.tipo)) continue;
    for (const [id, , , bucket] of DIMS) {
      const b = bucket(x);
      if (b == null) continue;
      for (const l of ["O", "U"]) {
        const v = lucro(x, l), g = doJogo.get(`${x.jogo}|${l}`);
        if (v == null || !g || g.n < 10) continue;
        const r = v - (g.s - v) / (g.n - 1); // relativo às outras props do jogo
        const k = `${id}|${x.tipo}|${b}|${l}`, q = acc.get(k) || acc.set(k, { n: 0, w: 0, l: 0, r: 0, J: new Map(), D: new Map() }).get(k);
        q.n++; q.l += v; q.r += r; if (v > 0) q.w++;
        const j = q.J.get(x.jogo) || q.J.set(x.jogo, { s: 0, n: 0 }).get(x.jogo); j.s += r; j.n++;
        const d = q.D.get(x.dia) || q.D.set(x.dia, { s: 0, n: 0 }).get(x.dia); d.s += r; d.n++;
      }
    }
  }
  const out = {};
  for (const [k, q] of acc) {
    const rel = q.r / q.n, J = q.J.size;
    let v = 0;
    for (const j of q.J.values()) v += (j.s - rel * j.n) ** 2;
    const ep = Math.max(J > 1 ? Math.sqrt((v * J) / (J - 1)) / q.n : 1, 0.9 / Math.sqrt(q.n));
    const noites = [...q.D.values()].filter((d) => d.n >= 5);
    out[k] = [q.n, q.w, q.l / q.n, rel, ep, noites.length, noites.filter((d) => d.s > 0).length];
  }
  return out;
}
// resposta de uma pergunta para uma linha: o lado melhor QUE O JOGO na faixa dela (só o mesmo mercado).
// força = 100 × (2·Φ(relativo/erro) − 1); "firme" = melhor que o jogo em ≥ 3/4 das noites avaliáveis (mín. 2 noites).
function resposta(dims, id, tipo, b, minN) {
  if (b == null || !ehProp(tipo)) return null;
  const ab = (a) => (a ? { n: a[0], w: a[1], roi: a[2], rel: a[3], ep: a[4], noites: a[5], noitesPos: a[6] } : null);
  const O = ab(dims[`${id}|${tipo}|${b}|O`]), U = ab(dims[`${id}|${tipo}|${b}|U`]);
  if (!O && !U) return { b, vazio: true };
  const lado = (O?.rel ?? -9) >= (U?.rel ?? -9) ? "O" : "U", s = lado === "O" ? O : U, o = lado === "O" ? U : O;
  const forca = Math.max(0, Math.round(100 * (2 * fi(s.rel / s.ep) - 1)));
  const firme = s.noites >= 2 && s.noitesPos >= Math.ceil(0.75 * s.noites);
  return { b, lado, s, o, O, U, forca, firme, pouco: s.n < minN };
}
const rotuloFaixa = (dim, b) => DIMS.find((d) => d[0] === dim)[4][b];
// normal do mercado (a margem): ROI de Over e Under em tudo, no mesmo mercado
function baseDe(m) {
  const S = arquivo.sim, O = S.over?.por[m]?.lado, U = S.under?.por[m]?.lado;
  return { O: O?.roi ?? null, U: U?.roi ?? null, nO: O?.n ?? 0, nU: U?.n ?? 0 };
}
const pp = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${num(Math.abs(100 * v), 0)} pp`);
// etiqueta: azul = Over, laranja = Under; cor forte = força ≥ mínima E firme nas noites; clara = fraca ou não firme;
// cinza tracejado = amostra abaixo do mínimo
function sinal(r, dim, nomes, minF, rotulo = null) {
  if (!r) return `<td class="n"><span class="muted">–</span></td>`;
  const rot = rotulo ?? rotuloFaixa(dim, r.b);
  if (r.vazio) return `<td><span class="sig N"><small>${esc(rot)}</small>sem linhas na temporada</span></td>`;
  const s = r.s, forte = !r.pouco && r.forca >= minF && r.firme, nome = r.lado === "O" ? nomes[0] : nomes[1];
  const tit = `${rot}: ${nomes[0]} ${r.O ? `${pp(r.O.rel)} vs o jogo, ganhou ${r.O.w} de ${r.O.n} (ROI ${pc(r.O.roi)})` : "–"} · ${nomes[1]} ${r.U ? `${pp(r.U.rel)} vs o jogo, ganhou ${r.U.w} de ${r.U.n} (ROI ${pc(r.U.roi)})` : "–"} · ${nome} melhor que o jogo em ${s.noitesPos} de ${s.noites} noite(s) · força ${r.forca}${r.pouco ? " · amostra abaixo do mínimo" : !r.firme ? " · não se repetiu nas noites: sem cor forte" : ""}`;
  return `<td><span class="sig ${forte ? r.lado : r.pouco ? "N pouco" : `${r.lado} fraco`}" style="--f:${(Math.max(r.forca, 15) / 100).toFixed(2)}" title="${esc(tit)}"><small>${esc(rot)}${r.pouco && rotulo == null ? ` · só ${s.n}` : ""}</small><b>${esc(nome)}</b> ${pp(s.rel)} vs jogo · ${s.noitesPos}/${s.noites} noites<small>ROI ${esc(nomes[0])} ${pc(r.O?.roi, 0)} · ${esc(nomes[1])} ${pc(r.U?.roi, 0)}</small></span></td>`;
}

export function renderFiltros(el, f, jogos) {
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o arquivo do mercado.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!arquivo) { el.innerHTML = `<p class="muted">Carregando a temporada…</p>`; return; }
  const minN = +(f.amostra || 30), minF = +(f.conf || 40), minConc = +(f.conc || 0), busca = nomeChave(f.busca), dims = arquivo.dims || {};

  // HOJE: as props de jogador dos jogos que não começaram, cada uma com as 4 respostas
  const hoje = [];
  for (const j of jogos) {
    if (j.estado !== "pre") continue;
    // linha às 12 h de Brasília (15h10 UTC do dia do jogo em Nova York): último ponto do histórico até lá
    const corte = Date.parse(`${new Date(j.inicio).toLocaleDateString("en-CA", { timeZone: "America/New_York" })}T15:10:00Z`) / 1000;
    for (const x of j.linhas.filter((x) => (!f.tipo || x.tipo === f.tipo) && (!busca || nomeChave(x.jogador).includes(busca)))) {
      const h12 = (x.hist || []).filter((h) => h[0] != null && h[0] <= corte).pop();
      const y = { tipo: x.tipo, L0: x.dk.linhaAb, O0: x.dk.overAb, U0: x.dk.underAb, L1: x.dk.linha, O1: x.dk.over, U1: x.dk.under, proj30: x.proj ?? null,
        L12: h12?.[1] ?? null, O12: h12?.[2] ?? null, U12: h12?.[3] ?? null };
      const R = DIMS.map(([id, , , bucket]) => resposta(dims, id, y.tipo, bucket(y), minN));
      const fortes = R.filter((r) => r && !r.vazio && !r.pouco && r.forca >= minF && r.firme), nO = fortes.filter((r) => r.lado === "O").length, nU = fortes.filter((r) => r.lado === "U").length;
      const conc = nO && nU ? 0 : Math.max(nO, nU);
      if (conc < minConc) continue;
      const lado = nO > nU ? "O" : nU > nO ? "U" : null;
      hoje.push({ j, x, y, R, nO, nU, conc, lado, base: baseDe(x.tipo), soma: lado ? fortes.reduce((t, r) => t + r.s.rel, 0) : -9 });
    }
  }
  hoje.sort((a, b) => b.conc - a.conc || b.soma - a.soma);
  const MAX = 250;
  const leitura = (h) => {
    if (h.nO && h.nU) return `<span class="leit div">dividido<small>Over ${h.nO} · Under ${h.nU}</small></span>`;
    if (!h.conc) return `<span class="muted">sem sinal forte</span>`;
    return `<span class="leit ${h.lado}">${h.lado === "O" ? "Over" : "Under"}<small>${h.conc} de ${DIMS.length} sinais</small></span>`;
  };
  const tabHoje = hoje.length ? `<div class="tbl-wrap"><table class="props-tab filtros-hoje filtros-sinais"><thead><tr><th>Jogador</th><th>Mercado</th><th class="n">Linha<small>abertura → agora</small></th><th class="n">Odds O / U<small>abertura → agora</small></th><th class="n">Projeção</th><th>Normal do mercado<small>Over / Under em tudo</small></th>${DIMS.map(([, nome, sub]) => `<th>${esc(nome)}<small>${esc(sub)}</small></th>`).join("")}<th>Leitura</th></tr></thead><tbody>
    ${hoje.slice(0, MAX).map((h) => { const { j, x, y, R, base } = h; return `<tr${novaDesde(x) ? ' class="nova"' : ""}><td><b>${esc(x.jogador)}</b>${x.lesao ? ` <span class="tag-les">${esc(x.lesao.status)}</span>` : ""}${novaDesde(x) ? ` <span class="tag-nova">nova · ${novaDesde(x)} min</span>` : ""}<small>${esc(j.titulo)} · ${quandoJogo(j)}</small></td>
      <td>${TIPOS[x.tipo]}</td>
      <td class="n">${y.L0 != null && y.L0 !== y.L1 ? `${lin(y.L0)} → ` : ""}<b>${lin(y.L1)}</b>${y.L12 != null && y.L12 !== y.L1 ? `<small>12 h: ${lin(y.L12)}</small>` : ""}</td>
      <td class="n">${num(y.O0, 2)} / ${num(y.U0, 2)}<small>→ <b>${num(y.O1, 2)} / ${num(y.U1, 2)}</b></small></td>
      <td class="n">${num(y.proj30)}</td>
      <td><span class="sig N base" title="${esc(`ROI de apostar em tudo neste mercado no fechamento: Over ${pc(base.O)} (${base.nO}) · Under ${pc(base.U)} (${base.nU}). A margem da casa: as etiquetas ao lado já descontam o jogo, esta coluna não.`)}"><small>margem</small>Over ${pc(base.O, 0)} · Under ${pc(base.U, 0)}</span></td>
      ${R.map((r, i) => sinal(r, DIMS[i][0], ["Over", "Under"], minF)).join("")}
      <td>${leitura(h)}</td></tr>`; }).join("")}
    </tbody></table></div><p class="muted">${hoje.length} linhas${hoje.length > MAX ? ` · mostrando as ${MAX} primeiras (use os filtros de estatística e de sinais para afunilar)` : ""}. Ordem: mais sinais firmes no mesmo lado; depois quanto eles foram melhores que o jogo.</p>`
    : `<div class="vazio"><b>Nenhuma linha de hoje com esses filtros.</b></div>`;

  // temporada: como cada pergunta respondeu, faixa × mercado
  const mercs = Object.keys(TIPOS_PROP).filter((m) => arquivo.porMercado[m] && (!f.tipo || m === f.tipo));
  const mapa = ([id, nome, sub, , rotulos]) => `<h3>${esc(nome)} <small class="muted">${esc(sub)}</small></h3><div class="tbl-wrap"><table class="props-tab filtros-mapa"><thead><tr><th>Faixa</th>${mercs.map((m) => `<th>${esc(MERCADOS[m])}</th>`).join("")}</tr></thead><tbody>
    ${rotulos.map((_, b) => `<tr><td>${esc(rotulos[b])}</td>${mercs.map((m) => { const r = resposta(dims, id, m, b, minN); return r && !r.vazio ? sinal(r, id, ["Over", "Under"], minF, `${r.s.n} linhas`) : `<td class="n"><span class="muted">–</span></td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>`;

  // avançado: catálogo de filtros e persistência (versões anteriores da aba)
  const P = arquivo.pers || {}, grupos = [...new Set(FILTROS.map((f) => f[1]))].filter((g) => g !== "Controle");
  const linhaPers = (rot, q) => `<tr><td>${rot}</td><td class="n"><b>${q ? num(q.b, 2) : "–"}</b></td><td class="n">${q?.bruto == null ? "–" : num(q.bruto, 2)}</td><td class="n">${q ? q.pares : 0}</td><td class="n">${q?.acerto == null ? "–" : `${Math.round(100 * q.acerto)}%`}</td><td>${!q || q.pares < 8 || q.noites < 3 ? `<span class="muted">poucos dados${q ? ` (${q.noites} noite(s))` : ""}</span>` : q.b >= 0.3 ? '<span class="sit forte">se repete</span>' : q.b > 0 ? '<span class="sit bom">fraco</span>' : q.bruto < -0.2 ? '<span class="sit ruim">se inverte</span>' : '<span class="sit neutro">não se repete</span>'}</td></tr>`;
  const tabPers = `<div class="tbl-wrap"><table class="props-tab filtros-temp"><thead><tr><th>Grupo</th><th class="n">Peso</th><th class="n">Inclinação medida</th><th class="n">Pares</th><th class="n">Sinal se repete</th><th>Situação</th></tr></thead><tbody>
    ${linhaPers("<b>Margem da casa: Over (ou visitante) em tudo</b>", P["Controle|O"])}${linhaPers("<b>Margem da casa: Under (ou mandante) em tudo</b>", P["Controle|U"])}
    ${grupos.map((g) => linhaPers(`${esc(g)} <small>a favor do filtro</small>`, P[`${g}|com`]) + linhaPers(`${esc(g)} <small>contra o filtro</small>`, P[`${g}|contra`])).join("")}</tbody></table></div>`;
  const umMercado = f.tipo && f.tipo !== "jogo" && arquivo.porMercado[mercadoDe(f.tipo)];

  el.innerHTML = `<section class="panel"><h2>Linhas de hoje: de que lado está o dinheiro</h2>
      <p class="muted">Cada prop de jogador dos jogos que não começaram, com 4 perguntas sobre o <b>movimento da linha</b> e a <b>projeção do Edgely</b>, respondidas pela temporada <b>só no mesmo mercado</b>. O placar do jogo decide boa parte das props (numa noite de Over, todo Under perde), então cada resposta é <b>relativa ao jogo</b>: nas linhas que estavam como esta, quanto o Over e o Under renderam <b>a mais ou a menos que as outras props do mesmo jogo</b> (em pp de ROI) — o que sobra é o que a linha sabia. <b>Movimento total</b> = desde a abertura; <b>da tarde</b> = desde as 12 h de Brasília (o dinheiro da tarde é o mais informado); <b>projeção × linha</b> e <b>× abertura</b> = onde a projeção do Edgely está em desvios (em pontos, 17,5 com projeção 19 ≈ "acima"). Cada etiqueta: o lado melhor que o jogo, quantos pp e em quantas noites; embaixo, o ROI cru dos dois lados. Cor: <span class="sig O" style="--f:.8">azul = Over</span> <span class="sig U" style="--f:.8">laranja = Under</span>, forte só com força ≥ mínima <b>e</b> melhor que o jogo em ≥ 3/4 das noites; clara = fraco ou não se repetiu; cinza tracejado = pouca amostra. <b>Normal do mercado</b> = a margem da casa (ROI cru de apostar em tudo). <b>Leitura</b> = quantas perguntas apontam o mesmo lado com cor forte. Lembre: as props do mesmo jogo andam juntas — a leitura diz qual lado é melhor <b>dentro do jogo</b>; o clima do jogo é com você.</p>
      ${tabHoje}</section>
    <section class="panel"><h2>Como cada pergunta respondeu na temporada</h2>
      <p class="muted">${arquivo.nProps} linhas de ${arquivo.jogos} jogos em ${arquivo.dias} noite(s), no fechamento, só props de jogador. Cada célula, só daquele mercado: o lado melhor que as outras props do mesmo jogo naquela faixa, quantos pp e em quantas noites; embaixo, o ROI cru de Over e Under.</p>
      ${DIMS.map(mapa).join("")}</section>
    <details class="panel avancado"><summary><b>Avançado:</b> catálogo de filtros, o que se repete entre noites</summary>
      <h3>O que se repete de uma noite para outra</h3>
      <p class="muted">Deixando uma noite de fora: o resultado das outras noites (por filtro, mercado e lado, além da margem) se repete na noite de fora? Inclinação 1 = repete tudo; 0 = nada; negativa = se inverte. Backtest: <code>node scripts/backtest_confianca.mjs</code>.</p>
      ${tabPers}
      <h3>Catálogo de filtros (simulado)${umMercado ? ` · ${esc(MERCADOS[mercadoDe(f.tipo)])}` : ""}</h3>
      <p class="muted">Cor: <span class="sit forte">forte</span> ROI ≥ 10% com o intervalo de 95% acima de zero · <span class="sit bom">promissor</span> ROI ≥ 5% · <span class="sit ruim">evitar</span> ROI ≤ −10% · cinza = menos de ${minN} apostas.</p>
      ${umMercado ? detalheMercado(minN, mercadoDe(f.tipo)) : matriz(minN, mercadosDaVisao(f.tipo))}</details>`;
}
