// Aba "Filtros" de props.html (22/10/2026): catálogo de filtros de mercado nas props da NBA (DraftKings).
//  1) TEMPORADA (simulado): cada filtro aplicado ao arquivo do mercado (data/apostas_edgely/mercado-AAAA-MM.json:
//     todas as props de cada jogo encerrado, com abertura, fechamento ~10 min antes, projeções do Edgely e resultado),
//     entrando no FECHAMENTO dos dois lados (o do filtro e o oposto). Stake 1; IC 95% por sorteio de jogos inteiros.
//  2) HOJE: as mesmas regras nas props de hoje com a linha e as odds de AGORA; cada prop mostra os filtros que aciona
//     e como eles foram na temporada, para o apostador saber onde olhar.
// Uma prop "x" tem: tipo, L0/O0/U0 (abertura), L1/O1/U1 (fechamento ou agora), proj12 (Edgely às 12 h), proj30
// (Edgely mais recente antes do jogo). Cada filtro devolve o lado ("O"/"U") ou null.
import { esc, hora } from "./formato.js";
import { semMargem, movimentoProp, nomeChave } from "./core.js";

const TIPOS = { points: "pontos", rebounds: "rebotes", assists: "assistências", threes: "cestas de 3", pra: "PRA" };
const ANDOU = 0.03;
const mov = (x) => { if (x._m === undefined) x._m = movimentoProp(x.tipo, x.L0, x.L1, semMargem(x.O0, x.U0), semMargem(x.O1, x.U1)); return x._m; };
const ladoMov = (x, c = ANDOU) => { const m = mov(x); return m == null ? null : m >= c ? "O" : m <= -c ? "U" : null; };
const projAtual = (x) => x.proj30 ?? x.proj12;
const dirProj = (x) => { const p = projAtual(x); return p == null || x.L0 == null || p === x.L0 ? null : p > x.L0 ? "O" : "U"; };
const oposto = (l) => (l === "O" ? "U" : "O");

// catálogo: [id, grupo, nome, lado(x)]
export const FILTROS = [
  ["under", "Base", "Under em tudo", () => "U"],
  ["over", "Base", "Over em tudo", () => "O"],
  ...Object.entries(TIPOS).map(([t, r]) => [`under-${t}`, "Base", `Under em ${r}`, (x) => (x.tipo === t ? "U" : null)]),
  ["mov", "Linha andou", "Seguir o movimento (≥ 3 pp)", (x) => ladoMov(x)],
  ["mov6", "Linha andou", "Seguir o movimento forte (≥ 6 pp)", (x) => ladoMov(x, 0.06)],
  ["mov-over", "Linha andou", "Linha subiu p/ Over → Over", (x) => (ladoMov(x) === "O" ? "O" : null)],
  ["mov-under", "Linha andou", "Linha caiu p/ Under → Under", (x) => (ladoMov(x) === "U" ? "U" : null)],
  ["mov-under-pontos", "Linha andou", "Pontos: linha caiu p/ Under → Under", (x) => (x.tipo === "points" && ladoMov(x) === "U" ? "U" : null)],
  ["parada-under", "Linha andou", "Linha parada (< 3 pp) → Under", (x) => (mov(x) != null && !ladoMov(x) ? "U" : null)],
  ["conf", "Projeção × linha", "Projeção confirmada pela linha → lado da projeção", (x) => (dirProj(x) && ladoMov(x) === dirProj(x) ? dirProj(x) : null)],
  ["contra", "Projeção × linha", "Linha contra a projeção → lado da linha", (x) => (dirProj(x) && ladoMov(x) && ladoMov(x) !== dirProj(x) ? ladoMov(x) : null)],
  ["proj-parada", "Projeção × linha", "Linha parada → lado da projeção", (x) => (dirProj(x) && mov(x) != null && !ladoMov(x) ? dirProj(x) : null)],
  ["dif1", "Projeção × linha", "Projeção a ≥ 1 da linha atual → lado da projeção", (x) => { const p = projAtual(x); return p != null && Math.abs(p - x.L1) >= 1 ? (p > x.L1 ? "O" : "U") : null; }],
  ["dif2", "Projeção × linha", "Projeção a ≥ 2 da linha atual → lado da projeção", (x) => { const p = projAtual(x); return p != null && Math.abs(p - x.L1) >= 2 ? (p > x.L1 ? "O" : "U") : null; }],
  ["mudou-seguiu", "Projeção mudou", "Projeção mudou ≥ 0,5 e a linha foi junto → esse lado", (x) => {
    if (x.proj12 == null || x.proj30 == null || Math.abs(x.proj30 - x.proj12) < 0.5) return null;
    const l = x.proj30 > x.proj12 ? "O" : "U"; return ladoMov(x) === l ? l : null; }],
  ["mudou-sozinha", "Projeção mudou", "Projeção mudou ≥ 0,5 e a linha NÃO foi junto → lado da projeção", (x) => {
    if (x.proj12 == null || x.proj30 == null || Math.abs(x.proj30 - x.proj12) < 0.5) return null;
    const l = x.proj30 > x.proj12 ? "O" : "U"; return ladoMov(x) !== l ? l : null; }],
  ["over-loteria", "Over de loteria", "Over pagando ≥ 2,10 → Under", (x) => (x.O1 >= 2.1 ? "U" : null)],
  ["under-fav", "Over de loteria", "Under favorito (odd ≤ 1,75) → Under", (x) => (x.U1 && x.U1 <= 1.75 ? "U" : null)],
  ["linha-baixa", "Over de loteria", "Linha baixa (≤ 1,5) → Under", (x) => (x.L1 != null && x.L1 <= 1.5 ? "U" : null)],
  ["under-3pm-andou", "Over de loteria", "Cestas de 3: linha caiu ou parada → Under", (x) => (x.tipo === "threes" && mov(x) != null && ladoMov(x) !== "O" ? "U" : null)],
];

const lucro = (x, lado) => {
  const o = lado === "O" ? x.O1 : x.U1;
  if (x.real == null || x.L1 == null || !o) return null;
  if (x.real === x.L1) return 0;
  return (x.real > x.L1) === (lado === "O") ? o - 1 : -1;
};
function estat(v) { // v: [{jogo, dia, l}]
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
    for (let b = 0; b < 600; b++) { let l = 0, n = 0; for (let i = 0; i < J.length; i++) { const q = J[(Math.random() * J.length) | 0]; l += q.l; n += q.n; } rs.push(l / n); }
    rs.sort((a, b) => a - b);
    ic = [rs[15], rs[584]];
  }
  return { n: v.length, g, r, roi: tot / v.length, lucro: tot, ic, dias: dias.size, diasPos: [...dias.values()].filter((l) => l > 0).length, jogos: J.length };
}

// ---------- dados ----------
let arquivo = null, p12 = {}, lidoEm = 0, erro = null;
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
    // retrato das 12 h de hoje (para "projeção mudou"): jogos[id].p12 = { nome: [pts, reb, ast, 3PM, PRA, min] }
    p12 = {};
    for (const A of apos.filter(Boolean)) for (const [id, j] of Object.entries(A.jogos || {})) if (j.p12) p12[id] = j.p12;
    // simulação de cada filtro, nos dois lados
    const sim = {};
    for (const [id, , , regra] of FILTROS) {
      const a = [], b = [];
      for (const x of props) {
        const l = regra(x);
        if (!l) continue;
        const la = lucro(x, l), lb = lucro(x, oposto(l));
        if (la != null) a.push({ jogo: x.jogo, dia: x.dia, l: la });
        if (lb != null) b.push({ jogo: x.jogo, dia: x.dia, l: lb });
      }
      sim[id] = { lado: estat(a), oposto: estat(b) };
    }
    arquivo = { props, sim, dias: new Set(props.map((x) => x.dia)).size, jogos: new Set(props.map((x) => x.jogo)).size };
    erro = null;
  } catch (e) { erro = e; }
  lidoEm = Date.now();
}
export const filtrosVelho = () => Date.now() - lidoEm > 10 * 60e3;

// ---------- render ----------
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

function tabelaTemporada(minN) {
  const grupos = [...new Set(FILTROS.map((f) => f[1]))];
  return grupos.map((g) => {
    const linhas = FILTROS.filter((f) => f[1] === g).map(([id, , nome]) => {
      const { lado: s, oposto: o } = arquivo.sim[id];
      const [cls, rot] = situacao(s, minN);
      return `<tr class="sit-${cls}"><td>${esc(nome)}</td><td class="n">${s ? s.n : 0}</td><td class="n">${s ? `${s.g}–${s.r}` : "–"}</td>
        <td class="n"><b>${pc(s?.roi)}</b>${s?.ic ? `<small>${pc(s.ic[0], 0)} a ${pc(s.ic[1], 0)}</small>` : ""}</td>
        <td class="n">${s ? `${s.diasPos}/${s.dias}` : "–"}</td><td class="n">${pc(o?.roi)}</td><td><span class="sit ${cls}">${rot}</span></td></tr>`;
    }).join("");
    return `<tr class="grupo"><th colspan="7">${esc(g)}</th></tr>${linhas}`;
  }).join("");
}

// sinais de uma prop de hoje: filtros que ela aciona, com a temporada de cada um
function sinaisDe(x, minN, minRoi) {
  const out = [];
  for (const [id, grupo, nome, regra] of FILTROS) {
    const l = regra(x);
    if (!l) continue;
    const s = arquivo.sim[id].lado;
    if (!s || s.n < minN) continue;
    out.push({ id, grupo, nome, lado: l, s, bom: s.roi >= minRoi, ruim: s.roi <= -minRoi });
  }
  return out;
}

export function renderFiltros(el, f, jogos) {
  if (erro) { el.innerHTML = `<div class="banner"><b>Não consegui ler o arquivo do mercado.</b><span>${esc(erro.message || erro)}</span></div>`; return; }
  if (!arquivo) { el.innerHTML = `<p class="muted">Carregando a temporada…</p>`; return; }
  const minN = +(f.amostra || 30), minRoi = +(f.roimin ?? 0.05), busca = nomeChave(f.busca);

  // HOJE: props com linha/odds agora + projeção mais recente + retrato das 12 h
  const hoje = [];
  for (const j of jogos) {
    if (j.estado !== "pre") continue;
    for (const x of j.linhas) {
      if ((f.tipo && x.tipo !== f.tipo) || (busca && !nomeChave(x.jogador).includes(busca))) continue;
      const p12v = p12[j.id]?.[nomeChave(x.jogador)]?.[{ points: 0, rebounds: 1, assists: 2, threes: 3, pra: 4 }[x.tipo]] ?? null;
      const y = { tipo: x.tipo, L0: x.dk.linhaAb, O0: x.dk.overAb, U0: x.dk.underAb, L1: x.dk.linha, O1: x.dk.over, U1: x.dk.under, proj12: p12v, proj30: x.proj };
      const sin = sinaisDe(y, minN, minRoi);
      // lado sugerido = o com sinais bons de mais GRUPOS diferentes (filtros parecidos contam uma vez), depois o
      // melhor ROI; conflito = também há sinal bom do outro lado; alerta = filtro que perde NESSE lado
      const bons = sin.filter((s) => s.bom).sort((a, b) => b.s.roi - a.s.roi);
      if (!bons.length) continue;
      const nota = (l) => { const B = bons.filter((s) => s.lado === l); return [new Set(B.map((s) => s.grupo)).size, B[0]?.s.roi ?? -9]; };
      const [gO, rO] = nota("O"), [gU, rU] = nota("U");
      const lado = gO > gU || (gO === gU && rO > rU) ? "O" : "U";
      const meus = bons.filter((s) => s.lado === lado);
      hoje.push({ j, x, y, lado, meus, alertas: sin.filter((s) => s.ruim && s.lado === lado), conflito: bons.some((s) => s.lado !== lado),
        grupos: Math.max(gO, gU), melhor: meus[0].s.roi, m: mov(y) });
    }
  }
  hoje.sort((a, b) => b.grupos - a.grupos || b.melhor - a.melhor);
  const chip = (s) => `<span class="chip ${s.bom ? "forte" : "ruim"}" title="${esc(`${s.nome}: ${s.s.n} apostas na temporada, ROI ${pc(s.s.roi)}`)}">${esc(s.nome.replace(/ → .*/, ""))} ${pc(s.s.roi, 0)}</span>`;
  const tabHoje = hoje.length ? `<div class="tbl-wrap"><table class="props-tab filtros-hoje"><thead><tr><th>Jogador</th><th>Jogo</th><th>Estatística</th><th class="n">Linha</th><th class="n">Odds O / U</th><th class="n">Projeção</th><th class="n">Linha andou</th><th class="n">Entrada</th><th>Sinais a favor (ROI na temporada)</th></tr></thead><tbody>
    ${hoje.slice(0, 150).map(({ j, x, y, lado, meus, alertas, conflito, m }) => `<tr><td><b>${esc(x.jogador)}</b>${x.lesao ? ` <span class="tag-les">${esc(x.lesao.status)}</span>` : ""}<small>${esc(x.sigla)}</small></td>
      <td>${esc(j.titulo)}<small>${hora(j.inicio)}</small></td><td>${TIPOS[x.tipo]}</td>
      <td class="n">${y.L0 != null && y.L0 !== y.L1 ? `${lin(y.L0)} → ` : ""}<b>${lin(y.L1)}</b></td><td class="n">${num(y.O1, 2)} / ${num(y.U1, 2)}</td>
      <td class="n">${num(y.proj30)}${y.proj12 != null && y.proj30 != null && Math.abs(y.proj30 - y.proj12) >= 0.5 ? `<small>12 h: ${num(y.proj12)}</small>` : ""}</td>
      <td class="n">${m == null ? "–" : `${m >= 0 ? "+" : "−"}${num(Math.abs(100 * m))} pp`}<small>${m == null || Math.abs(m) < ANDOU ? "parada" : m > 0 ? "p/ Over" : "p/ Under"}</small></td>
      <td class="n"><b>${lado === "O" ? "Over" : "Under"} ${lin(y.L1)}</b> @ ${num(lado === "O" ? y.O1 : y.U1, 2)}${conflito ? `<small>sinais nos dois lados</small>` : ""}</td>
      <td class="chips">${meus.slice(0, 4).map(chip).join(" ")}${meus.length > 4 ? ` <span class="muted">+${meus.length - 4}</span>` : ""}${alertas.length ? `<br>${alertas.slice(0, 2).map(chip).join(" ")}` : ""}</td></tr>`).join("")}
    </tbody></table></div>${hoje.length > 150 ? `<p class="muted">Mostrando as 150 primeiras de ${hoje.length}.</p>` : ""}`
    : `<div class="vazio"><b>Nenhuma prop de hoje (antes do jogo) aciona um filtro com ROI ≥ ${pc(minRoi, 0)} e ≥ ${minN} apostas na temporada.</b></div>`;

  el.innerHTML = `<section class="panel"><h2>Entradas de hoje pelos filtros</h2>
      <p class="muted">Props de hoje (jogos que não começaram) que acionam ao menos um filtro com ROI ≥ ${pc(minRoi, 0)} e ≥ ${minN} apostas na temporada, com a linha e as odds da DraftKings <b>agora</b>. Ordem: sinais bons de mais grupos diferentes no mesmo lado (linha andou, projeção, Over de loteria…), depois o melhor ROI. Verde = filtro a favor da entrada; vermelho = filtro que perde nesse lado na temporada (cuidado). A linha ainda pode andar até o jogo: os filtros de movimento ficam mais confiáveis perto do início.</p>
      ${tabHoje}</section>
    <section class="panel"><h2>Filtros na temporada (simulado)</h2>
      <p class="muted">${arquivo.props.length} props de ${arquivo.jogos} jogos em ${arquivo.dias} dia(s), entrando no <b>fechamento</b> (~10 min antes do jogo). "Lado oposto" = entrar do outro lado nas mesmas props. Situação: <b>forte</b> = ROI ≥ 10% com o intervalo de 95% acima de zero; <b>promissor</b> = ROI ≥ 5%; amostra pequena = menos de ${minN} apostas. Com poucos dias tudo é hipótese: olhe também "dias com lucro".</p>
      <div class="tbl-wrap"><table class="props-tab filtros-temp"><thead><tr><th>Filtro</th><th class="n">Apostas</th><th class="n">Green–Red</th><th class="n">ROI <small>(95%)</small></th><th class="n">Dias com lucro</th><th class="n">Lado oposto</th><th>Situação</th></tr></thead>
      <tbody>${tabelaTemporada(minN)}</tbody></table></div></section>`;
}
