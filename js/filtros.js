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
export async function carregarFiltros() {
  lidoEm = Date.now();
  try {
    const t = Date.now();
    const ler = (n) => fetch(`data/apostas_edgely/${n}?t=${t}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const ind = await ler("indice.json");
    const meses = ind?.meses || [];
    const [merc, apos] = await Promise.all([Promise.all(meses.map((m) => ler(`mercado-${m}.json`))), Promise.all(meses.slice(-1).map((m) => ler(`${m}.json`)))]);
    const props = [];
    for (const M of merc.filter(Boolean)) {
      const C = Object.fromEntries(M.campos.map((k, i) => [k, i]));
      for (const a of M.props) {
        const j = M.jogos[a[C.jogo]] || {};
        props.push({ jogo: a[C.jogo], dia: j.dia, tipo: a[C.tipo], L0: a[C.L0], O0: a[C.O0], U0: a[C.U0], L1: a[C.L1], O1: a[C.O1], U1: a[C.U1], proj12: a[C.proj12], proj30: a[C.proj30], real: a[C.real] });
      }
    }
    // retrato das 12 h de hoje (para "projeção mudou"): jogos[id].p12 (jogadores, ordem ORDEM_PROJ) e pj12 (jogo)
    p12 = {}; pj12 = {};
    for (const A of apos.filter(Boolean)) for (const [id, j] of Object.entries(A.jogos || {})) { if (j.p12) p12[id] = j.p12; if (j.pj12) pj12[id] = j.pj12; }
    const comResultado = props.filter((x) => x.real != null);
    const porMercado = {};
    for (const x of comResultado) porMercado[mercadoDe(x.tipo)] = (porMercado[mercadoDe(x.tipo)] || 0) + 1;
    arquivo = { props, sim: simular(props), porMercado, dias: new Set(props.map((x) => x.dia)).size, jogos: new Set(props.map((x) => x.jogo)).size };
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

// ---------- LADO E CONFIANÇA (24/10/2026; substitui a classe A/B/C) ----------
// Cada filtro que a linha aciona vira EVIDÊNCIA para os DOIS lados: apostar no lado do filtro (porLado) e contra ele
// (porOp), sempre no MESMO MERCADO (recuo: mesmo lado em todos os mercados, marcado "geral"). A margem da casa no
// mercado (controle: Over/Under em tudo, visitante/mandante) entra como a base de cada lado. Cada evidência é encolhida
// por uma priori normal (vantagem verdadeira ~ N(0; 6%)): média = ROI × τ²/(τ² + ep²), ep = erro-padrão pelo intervalo
// de 95% por jogo (nunca menor que 0,95/√n), e o z cai se o resultado não se repete nas noites. Por lado: z da melhor
// evidência − GARIMPO (escolher a melhor de ~20 evidências infla o resultado; os filtros de "linha andou", "projeção
// confirmada" e "odd voltou" disparam juntos pelo mesmo motivo) + 0,15 × z das melhores de outros grupos (só positivas,
// sem a base, no máximo +0,4) − 0,5 × o z do outro lado (conflito, com o mesmo desconto).
// Confiança = 100 × (2·Φ(z) − 1): 0 = moeda, 100 = certeza de que o lado tem ROI > 0.
// ROI esperado = média encolhida da melhor evidência. Só entram linhas com ao menos um FILTRO a favor (a base sozinha
// não é "fora do padrão").
const TAU = 0.06, GARIMPO = 0.8;
const fi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2), q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
function posterior(s) {
  const ep = Math.max(s.ic ? (s.ic[1] - s.ic[0]) / 3.92 : 0, 0.95 / Math.sqrt(s.n));
  const media = (s.roi * TAU * TAU) / (TAU * TAU + ep * ep), dp = Math.sqrt(1 / (1 / (TAU * TAU) + 1 / (ep * ep)));
  const cons = s.dias >= 2 ? 0.5 + (0.5 * (s.roi >= 0 ? s.diasPos : s.dias - s.diasPos)) / s.dias : 0.75; // repete nas noites?
  return { media, z: (media / dp) * cons };
}
const ehTime = (m) => m === "jogo-spread" || m === "jogo-ml";
export function evidencias(x, minN) {
  const m = mercadoDe(x.tipo), out = [];
  const add = (id, grupo, nome, lado, seg, ger, contra) => {
    const s = seg && seg.n >= minN ? seg : ger && ger.n >= minN ? ger : null;
    if (s) out.push({ id, grupo, nome, lado, s, contra, geral: s !== seg, ...posterior(s) });
  };
  for (const [id, grupo, nome, regra] of FILTROS) {
    if (grupo === "Controle") continue;
    const l = regra(x);
    if (!l) continue;
    const S = arquivo.sim[id];
    add(id, grupo, nome, l, S.porLado[`${m}|${l}`], S.porLado[l], false);
    add(id, grupo, nome, oposto(l), S.porOp?.[`${m}|${oposto(l)}`], S.porOp?.[oposto(l)], true);
  }
  for (const l of ["O", "U"]) { // base: a margem da casa neste mercado
    const S = arquivo.sim[ehTime(m) ? "visitante" : l === "O" ? "over" : "under"];
    if (!S) continue;
    const pega = (q) => (ehTime(m) && l === "U" ? q?.oposto : q?.lado);
    add("base", "Margem da casa", `Base do mercado: ${ehTime(m) ? (l === "O" ? "visitante" : "mandante") : l === "O" ? "Over" : "Under"} em tudo`, l, pega(S.por[m]), pega(S), false);
  }
  return out;
}
function forca(ev, l) {
  const E = ev.filter((e) => e.lado === l).sort((a, b) => b.z - a.z);
  const porGrupo = new Map();
  for (const e of E) if (!porGrupo.has(e.grupo)) porGrupo.set(e.grupo, e);
  const [melhor, ...outros] = porGrupo.values();
  const bonus = Math.min(0.4, 0.15 * outros.filter((e) => e.id !== "base").reduce((t, e) => t + Math.max(0, e.z), 0));
  return { z: melhor ? melhor.z - GARIMPO + bonus : null, melhor, E };
}
export function decidir(ev) {
  const O = forca(ev, "O"), U = forca(ev, "U");
  const [a, b, lado] = (O.z ?? -9) >= (U.z ?? -9) ? [O, U, "O"] : [U, O, "U"];
  if (a.z == null) return null;
  const z = a.z - 0.5 * Math.max(0, b.z ?? 0);
  return { lado, conf: Math.max(0, Math.round(100 * (2 * fi(z) - 1))), esperado: a.melhor.media, favor: a.E.filter((e) => e.z > 0), alertas: a.E.filter((e) => e.z < 0 && e.s.roi <= -0.05), conflito: (b.z ?? 0) > 0.5 };
}

export function renderFiltros(el, f, jogos) {
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o arquivo do mercado.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!arquivo) { el.innerHTML = `<p class="muted">Carregando a temporada…</p>`; return; }
  const minN = +(f.amostra || 30), minConf = +(f.conf || 0), busca = nomeChave(f.busca);

  // HOJE: linhas com linha/odds agora + projeção mais recente + retrato das 12 h
  const hoje = [];
  for (const j of jogos) {
    if (j.estado !== "pre") continue;
    const itens = [
      ...j.linhas.filter((x) => (!f.tipo || x.tipo === f.tipo) && (!busca || nomeChave(x.jogador).includes(busca))),
      ...(!f.tipo || f.tipo === "jogo" ? j.mercados.filter(() => !busca || nomeChave(j.titulo).includes(busca)) : []),
    ];
    for (const x of itens) {
      const p12v = x.k ? (x.k === "total" ? pj12[j.id]?.total : x.k === "spread" || x.k === "ml" ? pj12[j.id]?.margem : null) ?? null
        : p12[j.id]?.[nomeChave(x.jogador)]?.[ORDEM_PROJ.indexOf(x.tipo)] ?? null;
      const y = { tipo: x.tipo, L0: x.dk.linhaAb, O0: x.dk.overAb, U0: x.dk.underAb, L1: x.dk.linha, O1: x.dk.over, U1: x.dk.under, proj12: p12v, proj30: x.proj ?? null };
      const d = decidir(evidencias(y, minN));
      if (!d || !d.favor.some((e) => e.id !== "base") || d.conf < minConf) continue;
      hoje.push({ j, x, y, ...d, m: mov(y) });
    }
  }
  hoje.sort((a, b) => b.conf - a.conf || b.esperado - a.esperado);
  // uma linha por jogador (as linhas do mesmo jogador andam juntas): fica a de maior confiança; as outras viram "+N linhas dele"
  const vistos = new Map();
  for (const h of hoje) { const k = h.x.k ? `${h.j.id}|${h.x.k}` : `${h.j.id}|${h.x.jogador}`; if (vistos.has(k)) { vistos.get(k).mais.push(h); h.repetida = true; } else { h.mais = []; vistos.set(k, h); } }
  const todas = hoje.length;
  hoje.splice(0, hoje.length, ...hoje.filter((h) => !h.repetida));
  const ladoTxt = (x, l) => (l === "O" ? x.rotA : x.rotB);
  const chip = (e, x) => `<span class="chip ${e.id === "base" ? "base" : e.z > 0 ? "forte" : "ruim"}${e.geral ? " geral" : ""}" title="${esc(`${e.contra ? "CONTRA o filtro " : ""}${e.nome}: ${e.s.n} apostas ${e.geral ? "neste lado, em todos os mercados (pouca amostra neste mercado)" : `em ${MERCADOS[mercadoDe(x.tipo)].toLowerCase()}, neste lado`}, ROI ${pc(e.s.roi)}${e.s.ic ? ` (95%: ${pc(e.s.ic[0], 0)} a ${pc(e.s.ic[1], 0)})` : ""}, lucro em ${e.s.diasPos} de ${e.s.dias} noite(s); encolhido: ${pc(e.media)}`)}">${e.contra ? "contra: " : ""}${esc(e.nome.replace(/ → .*/, "").replace(/^Base do mercado: /, "base: "))} ${pc(e.s.roi, 0)}${e.geral ? " · geral" : ""}</span>`;
  const confCls = (c) => (c >= 70 ? "alta" : c >= 40 ? "media" : "baixa");
  const tabHoje = hoje.length ? `<div class="tbl-wrap"><table class="props-tab filtros-hoje"><thead><tr><th>Jogador</th><th>Jogo</th><th>Estatística</th><th class="n">Linha</th><th class="n">Odds O / U</th><th class="n">Projeção</th><th class="n">Linha andou</th><th class="n">Lado</th><th class="n">Confiança</th><th class="n">ROI esperado</th><th>Por quê (ROI na temporada, neste mercado e lado)</th></tr></thead><tbody>
    ${hoje.slice(0, 150).map(({ j, x, y, lado, conf, esperado, favor, alertas, conflito, m, mais }) => `<tr${novaDesde(x) ? ' class="nova"' : ""}><td><b>${esc(x.k ? x.nome : x.jogador)}</b>${x.lesao ? ` <span class="tag-les">${esc(x.lesao.status)}</span>` : ""}${novaDesde(x) ? ` <span class="tag-nova">nova · ${novaDesde(x)} min</span>` : ""}<small>${esc(x.k ? "mercado do jogo" : x.sigla)}</small></td>
      <td>${esc(j.titulo)}<small>${quandoJogo(j)}</small></td><td>${x.k ? "Jogo" : TIPOS[x.tipo]}${mais?.length ? `<small title="${esc(mais.map((h) => `${TIPOS[h.x.tipo]} ${ladoTxt(h.x, h.lado)} ${lin(h.y.L1)} (confiança ${h.conf})`).join(" · "))}">+${mais.length} linha(s) dele</small>` : ""}</td>
      <td class="n">${y.L0 != null && y.L0 !== y.L1 ? `${lin(y.L0)} → ` : ""}<b>${lin(y.L1)}</b></td><td class="n">${num(y.O1, 2)} / ${num(y.U1, 2)}</td>
      <td class="n">${num(y.proj30)}${y.proj12 != null && y.proj30 != null && Math.abs(y.proj30 - y.proj12) >= 0.5 ? `<small>12 h: ${num(y.proj12)}</small>` : ""}</td>
      <td class="n">${m == null ? "–" : `${m >= 0 ? "+" : "−"}${num(Math.abs(100 * m))} pp`}<small>${m == null || Math.abs(m) < ANDOU ? "parada" : `p/ ${esc(m > 0 ? x.rotA : x.rotB)}`}</small></td>
      <td class="n"><b>${esc(ladoTxt(x, lado))}${x.k === "ml" ? "" : ` ${x.k === "spread" && lado === "U" ? lin(-y.L1) : lin(y.L1)}`}</b> @ ${num(lado === "O" ? y.O1 : y.U1, 2)}${conflito ? `<small>sinais nos dois lados</small>` : ""}</td>
      <td class="n"><span class="conf ${confCls(conf)}" title="chance de este lado ter ROI positivo, em escala de 0 (moeda) a 100 (certeza)"><i><b style="width:${conf}%"></b></i>${conf}</span></td>
      <td class="n">${pc(esperado)}</td>
      <td class="chips">${favor.slice(0, 4).map((e) => chip(e, x)).join(" ")}${favor.length > 4 ? ` <span class="muted">+${favor.length - 4}</span>` : ""}${alertas.length ? `<br>${alertas.slice(0, 2).map((e) => chip(e, x)).join(" ")}` : ""}</td></tr>`).join("")}
    </tbody></table></div><p class="muted">${hoje.length} jogadores/mercados (${todas} linhas; mostra a de maior confiança de cada jogador — passe o mouse em "+N linha(s) dele" para ver as outras)${hoje.length > 150 ? ` · mostrando os 150 primeiros` : ""}.</p>`
    : `<div class="vazio"><b>Nenhuma linha de hoje (antes do jogo) com um filtro a favor e confiança ≥ ${minConf}.</b></div>`;

  const mercs = mercadosDaVisao(f.tipo);
  const umMercado = f.tipo && f.tipo !== "jogo" && arquivo.porMercado[mercadoDe(f.tipo)];
  el.innerHTML = `<section class="panel"><h2>Entradas de hoje pelos filtros</h2>
      <p class="muted">Linhas de hoje (jogos que não começaram) com a linha e as odds da DraftKings <b>agora</b>. Para cada linha, cada filtro que ela aciona conta como evidência para os <b>dois lados</b> — apostar com o filtro e apostar contra ele — sempre <b>no mesmo mercado</b> (com pouca amostra, o mesmo lado em todos os mercados, marcado "geral"), e a <b>margem da casa</b> no mercado (Over/Under em tudo) entra como base de cada lado. <b>Lado</b> = o que tem mais evidência. <b>Confiança</b> (0 a 100) = quão certo é que esse lado tem ROI positivo: cada resultado é encolhido pela amostra (vantagem real em props raramente passa de ~6%), perde força se não se repete nas noites, leva um desconto de garimpo (o melhor de vários filtros parecidos sempre parece melhor do que é), ganha um pouco com sinais de grupos diferentes e cai com sinais do outro lado. ~0 = moeda; 40+ = vale olhar; 70+ = evidência forte. <b>ROI esperado</b> = o resultado da melhor evidência depois de encolhido. Verde = a favor; cinza = base do mercado; vermelho = filtro que perde nesse lado. Só aparecem linhas com ao menos um filtro a favor. A linha ainda pode andar até o jogo; a decisão é sua.</p>
      ${tabHoje}</section>
    <section class="panel"><h2>Filtros na temporada (simulado)${umMercado ? ` · ${esc(MERCADOS[mercadoDe(f.tipo)])}` : ""}</h2>
      <p class="muted">${arquivo.props.length} linhas de ${arquivo.jogos} jogos em ${arquivo.dias} dia(s), entrando no <b>fechamento</b> (~10 min antes do jogo). ${umMercado ? `Só ${esc(MERCADOS[mercadoDe(f.tipo)].toLowerCase())}; "lado oposto" = entrar do outro lado nas mesmas linhas.` : `Cada célula: ROI e nº de apostas do filtro naquele mercado; escolha uma estatística acima para o detalhe (intervalo, dias com lucro, lado oposto).`} Cor: <span class="sit forte">forte</span> ROI ≥ 10% com o intervalo de 95% acima de zero · <span class="sit bom">promissor</span> ROI ≥ 5% · <span class="sit ruim">evitar</span> ROI ≤ −10% · cinza = menos de ${minN} apostas. Com poucos dias tudo é hipótese.</p>
      ${umMercado ? detalheMercado(minN, mercadoDe(f.tipo)) : matriz(minN, mercs)}</section>`;
}
