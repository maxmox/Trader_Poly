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
    const a = [], b = [], pa = {}, pb = {}, ld = {};
    for (const x of props) {
      const l = regra(x);
      if (!l) continue;
      const la = lucro(x, l), lb = lucro(x, oposto(l)), m = mercadoDe(x.tipo);
      if (la != null) { const r = { jogo: x.jogo, dia: x.dia, l: la }; a.push(r); (pa[m] ||= []).push(r); (ld[l] ||= []).push(r); (ld[`${m}|${l}`] ||= []).push(r); }
      if (lb != null) { const r = { jogo: x.jogo, dia: x.dia, l: lb }; b.push(r); (pb[m] ||= []).push(r); }
    }
    sim[id] = { lado: estat(a, sorteios), oposto: estat(b, sorteios), por: Object.fromEntries(Object.keys(pa).map((m) => [m, { lado: estat(pa[m], sorteios), oposto: estat(pb[m] || [], sorteios) }])),
      // porLado["O"|"U"] (todos os mercados) e porLado["<mercado>|O"|"<mercado>|U"]
      porLado: Object.fromEntries(Object.entries(ld).map(([k, v]) => [k, estat(v, sorteios)])) };
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

// sinais de uma linha de hoje: filtros (sem os de controle) que ela aciona, com o resultado NO MESMO MERCADO quando
// há amostra; senão o geral (marcado)
// CONFIANÇA (23/10): cada sinal usa o resultado do filtro no MESMO MERCADO E LADO (o movimento é assimétrico: Under que
// anda paga, Over que anda não), com recuo para "mesmo lado, todos os mercados"; nota = ROI encolhido pela amostra
// (ROI × n / (n + K)). O CONTROLE do mesmo mercado e lado (Under/Over em tudo; visitante) é exigência: o sinal só conta
// se o ROI encolhido dele passar o do controle (senão é só "noite de Under").
const K_ENCOLHE = 150;
const encolhe = (s) => (s ? (s.roi * s.n) / (s.n + K_ENCOLHE) : 0);
function controleDe(m, lado, minN) {
  const id = m === "jogo-spread" || m === "jogo-ml" ? (lado === "O" ? "visitante" : null) : lado === "O" ? "over" : "under";
  if (!id) return null;
  const seg = arquivo.sim[id]?.por[m]?.lado, ger = arquivo.sim[id]?.lado;
  return seg && seg.n >= minN ? seg : ger;
}
// classe da entrada: A (forte), B (boa), C (observar), pelos sinais do lado escolhido
function classificar(meus, alertas, conflito) {
  const pos = meus.filter((s) => s.passaControle && s.nota > 0).sort((a, b) => b.nota - a.nota);
  if (!pos.length) return { classe: "C", score: 0, grupos: 0 };
  const melhor = pos[0], outroGrupo = pos.find((s) => s.grupo !== melhor.grupo);
  const grupos = new Set(pos.map((s) => s.grupo)).size;
  const score = melhor.nota + (outroGrupo ? 0.5 * outroGrupo.nota : 0);
  const icPos = pos.some((s) => s.s.ic && s.s.ic[0] > 0), icPosSeg = pos.some((s) => !s.geral && s.s.ic && s.s.ic[0] > 0);
  let nivel = score >= 0.08 && grupos >= 2 && icPosSeg ? 0 : score >= 0.10 && (icPos || grupos >= 2) ? 1 : 2;
  if (conflito || alertas.length) nivel = Math.min(2, nivel + 1); // sinais nos dois lados ou alerta: cai um nível
  return { classe: "ABC"[nivel], score, grupos };
}

function sinaisDe(x, minN, minRoi) {
  const out = [], m = mercadoDe(x.tipo);
  for (const [id, grupo, nome, regra] of FILTROS) {
    if (grupo === "Controle") continue;
    const l = regra(x);
    if (!l) continue;
    const seg = arquivo.sim[id].porLado[`${m}|${l}`], ger = arquivo.sim[id].porLado[l];
    const s = seg && seg.n >= minN ? seg : ger && ger.n >= minN ? ger : null;
    if (!s) continue;
    const ctl = controleDe(m, l, minN);
    out.push({ id, grupo, nome, lado: l, s, geral: s === ger, bom: s.roi >= minRoi, ruim: s.roi <= -minRoi,
      nota: encolhe(s), passaControle: encolhe(s) > encolhe(ctl), ctl });
  }
  return out;
}

export function renderFiltros(el, f, jogos) {
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o arquivo do mercado.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!arquivo) { el.innerHTML = `<p class="muted">Carregando a temporada…</p>`; return; }
  const minN = +(f.amostra || 30), minRoi = +(f.roimin ?? 0.05), busca = nomeChave(f.busca);

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
      const sin = sinaisDe(y, minN, minRoi);
      // lado sugerido = o com sinais bons de mais GRUPOS diferentes (filtros parecidos contam uma vez), depois o
      // melhor ROI; conflito = também há sinal bom do outro lado; alerta = filtro que perde NESSE lado
      const bons = sin.filter((s) => s.bom).sort((a, b) => (a.geral - b.geral) || b.s.roi - a.s.roi);
      if (!bons.length) continue;
      const nota = (l) => { const B = bons.filter((s) => s.lado === l); return [new Set(B.map((s) => s.grupo)).size, B[0]?.s.roi ?? -9]; };
      const [gO, rO] = nota("O"), [gU, rU] = nota("U");
      const lado = gO > gU || (gO === gU && rO > rU) ? "O" : "U";
      const meus = bons.filter((s) => s.lado === lado);
      const alertas = sin.filter((s) => s.ruim && s.lado === lado), conflito = bons.some((s) => s.lado !== lado);
      const cl = classificar(meus, alertas, conflito);
      if (f.cls && "ABC".indexOf(cl.classe) > "ABC".indexOf(f.cls)) continue;
      hoje.push({ j, x, y, lado, meus, alertas, conflito, ...cl,
        grupos: Math.max(gO, gU), segmentados: meus.filter((s) => !s.geral).length, melhor: Math.max(...meus.map((s) => s.s.roi)), m: mov(y) });
    }
  }
  hoje.sort((a, b) => a.classe.localeCompare(b.classe) || b.score - a.score);
  // uma linha por jogador (as linhas do mesmo jogador andam juntas): fica a melhor; as outras viram "+N linhas dele"
  const vistos = new Map();
  for (const h of hoje) { const k = h.x.k ? `${h.j.id}|${h.x.k}` : `${h.j.id}|${h.x.jogador}`; if (vistos.has(k)) { vistos.get(k).mais.push(h); h.repetida = true; } else { h.mais = []; vistos.set(k, h); } }
  const todas = hoje.length;
  hoje.splice(0, hoje.length, ...hoje.filter((h) => !h.repetida));
  const chip = (s, x) => `<span class="chip ${s.bom ? "forte" : "ruim"}${s.geral ? " geral" : ""}" title="${esc(`${s.nome}: ${s.s.n} apostas ${s.geral ? "neste lado, em todos os mercados (pouca amostra neste mercado)" : `em ${MERCADOS[mercadoDe(x.tipo)].toLowerCase()}, neste lado`}, ROI ${pc(s.s.roi)}`)}">${esc(s.nome.replace(/ → .*/, ""))} ${pc(s.s.roi, 0)}${s.geral ? " · geral" : ""}</span>`;
  const tabHoje = hoje.length ? `<div class="tbl-wrap"><table class="props-tab filtros-hoje"><thead><tr><th>Jogador</th><th>Jogo</th><th>Estatística</th><th class="n">Linha</th><th class="n">Odds O / U</th><th class="n">Projeção</th><th class="n">Linha andou</th><th class="n">Entrada</th><th class="n">Classe</th><th>Sinais a favor (ROI neste mercado)</th></tr></thead><tbody>
    ${hoje.slice(0, 150).map(({ j, x, y, lado, meus, alertas, conflito, m, classe, score, grupos, mais }) => `<tr${novaDesde(x) ? ' class="nova"' : ""}><td><b>${esc(x.k ? x.nome : x.jogador)}</b>${x.lesao ? ` <span class="tag-les">${esc(x.lesao.status)}</span>` : ""}${novaDesde(x) ? ` <span class="tag-nova">nova · ${novaDesde(x)} min</span>` : ""}<small>${esc(x.k ? "mercado do jogo" : x.sigla)}</small></td>
      <td>${esc(j.titulo)}<small>${quandoJogo(j)}</small></td><td>${x.k ? "Jogo" : TIPOS[x.tipo]}${mais?.length ? `<small title="${esc(mais.map((h) => `${TIPOS[h.x.tipo]} ${h.lado === "O" ? "Over" : "Under"} ${lin(h.y.L1)} (${h.classe})`).join(" · "))}">+${mais.length} linha(s) dele</small>` : ""}</td>
      <td class="n">${y.L0 != null && y.L0 !== y.L1 ? `${lin(y.L0)} → ` : ""}<b>${lin(y.L1)}</b></td><td class="n">${num(y.O1, 2)} / ${num(y.U1, 2)}</td>
      <td class="n">${num(y.proj30)}${y.proj12 != null && y.proj30 != null && Math.abs(y.proj30 - y.proj12) >= 0.5 ? `<small>12 h: ${num(y.proj12)}</small>` : ""}</td>
      <td class="n">${m == null ? "–" : `${m >= 0 ? "+" : "−"}${num(Math.abs(100 * m))} pp`}<small>${m == null || Math.abs(m) < ANDOU ? "parada" : `p/ ${esc(m > 0 ? x.rotA : x.rotB)}`}</small></td>
      <td class="n"><b>${esc(lado === "O" ? x.rotA : x.rotB)}${x.k === "ml" ? "" : ` ${x.k === "spread" && lado === "U" ? lin(-y.L1) : lin(y.L1)}`}</b> @ ${num(lado === "O" ? y.O1 : y.U1, 2)}${conflito ? `<small>sinais nos dois lados</small>` : ""}</td>
      <td class="n"><span class="classe c${classe}" title="${esc(`nota (ROI encolhido pela amostra, mesmo mercado e lado): ${pc(score)} · ${grupos} grupo(s) de sinal`)}">${classe}</span><small>${pc(score, 0)}</small></td>
      <td class="chips">${meus.slice(0, 4).map((s) => chip(s, x)).join(" ")}${meus.length > 4 ? ` <span class="muted">+${meus.length - 4}</span>` : ""}${alertas.length ? `<br>${alertas.slice(0, 2).map((s) => chip(s, x)).join(" ")}` : ""}</td></tr>`).join("")}
    </tbody></table></div><p class="muted">${hoje.length} jogadores/mercados (${todas} linhas; mostra a melhor de cada jogador — passe o mouse em "+N linha(s) dele" para ver as outras)${hoje.length > 150 ? ` · mostrando os 150 primeiros` : ""}.</p>`
    : `<div class="vazio"><b>Nenhuma linha de hoje (antes do jogo) aciona um filtro com ROI ≥ ${pc(minRoi, 0)} e ≥ ${minN} apostas na temporada.</b></div>`;

  const mercs = mercadosDaVisao(f.tipo);
  const umMercado = f.tipo && f.tipo !== "jogo" && arquivo.porMercado[mercadoDe(f.tipo)];
  el.innerHTML = `<section class="panel"><h2>Entradas de hoje pelos filtros</h2>
      <p class="muted">Linhas de hoje (jogos que não começaram) que acionam ao menos um filtro com ROI ≥ ${pc(minRoi, 0)} e ≥ ${minN} apostas, com a linha e as odds da DraftKings <b>agora</b>. Cada sinal usa o resultado do filtro <b>no mesmo mercado</b>; com pouca amostra no mercado ele usa o geral e aparece marcado "geral". Filtros de controle (Under/Over em tudo) não entram como sinal. <b>Classe</b> (ordem da lista) usa a confiança dos dados: cada sinal usa o resultado do filtro <b>no mesmo mercado e no mesmo lado</b> (Over e Under separados), com o ROI encolhido pela amostra (ROI × n/(n+150)); só conta se passar o controle do mesmo mercado e lado (Under/Over em tudo), e sinais de grupos diferentes se somam. <b>A</b> = nota ≥ 8%, 2+ grupos e intervalo de 95% acima de zero no próprio mercado; <b>B</b> = nota ≥ 10% com intervalo positivo ou 2+ grupos; <b>C</b> = observar; cai um nível com sinais nos dois lados ou alerta vermelho. O número embaixo da classe é a nota. Verde = a favor; vermelho = filtro que perde nesse lado (cuidado). A linha ainda pode andar até o jogo.</p>
      ${tabHoje}</section>
    <section class="panel"><h2>Filtros na temporada (simulado)${umMercado ? ` · ${esc(MERCADOS[mercadoDe(f.tipo)])}` : ""}</h2>
      <p class="muted">${arquivo.props.length} linhas de ${arquivo.jogos} jogos em ${arquivo.dias} dia(s), entrando no <b>fechamento</b> (~10 min antes do jogo). ${umMercado ? `Só ${esc(MERCADOS[mercadoDe(f.tipo)].toLowerCase())}; "lado oposto" = entrar do outro lado nas mesmas linhas.` : `Cada célula: ROI e nº de apostas do filtro naquele mercado; escolha uma estatística acima para o detalhe (intervalo, dias com lucro, lado oposto).`} Cor: <span class="sit forte">forte</span> ROI ≥ 10% com o intervalo de 95% acima de zero · <span class="sit bom">promissor</span> ROI ≥ 5% · <span class="sit ruim">evitar</span> ROI ≤ −10% · cinza = menos de ${minN} apostas. Com poucos dias tudo é hipótese.</p>
      ${umMercado ? detalheMercado(minN, mercadoDe(f.tipo)) : matriz(minN, mercs)}</section>`;
}
