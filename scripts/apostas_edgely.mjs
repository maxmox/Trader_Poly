// Acompanhamento estatístico das props da NBA pelo Edgely (aba "Acompanhamento" de props.html), 21/10/2026.
// Roda na Action (a cada ~10 min); o arquivo é guardado no próprio repositório (a Action faz commit), então o
// histórico não depende do site publicado.
//   1) REGISTRO, 1x por dia a partir das 12 h de Brasília (15 h UTC): para cada prop da DraftKings (pontos,
//      rebotes, assistências, cestas de 3, PRA) dos jogos de hoje que ainda não começaram, com projeção do Edgely
//      de hoje, registra uma aposta no lado de maior valor esperado (edgeProp do core) SE esse valor for > 0, com
//      a linha e as odds Over/Under da DraftKings daquele momento. Jogador "Out" no Edgely fica de fora.
//   1b) ~30 MIN ANTES de cada jogo, de novo, com a projeção e as linhas mais recentes (momento "30m"): pega a
//      atualização do Edgely durante o dia e os jogadores que a casa abre mais tarde. O registro das 12 h fica como está.
//   1c) ESTRATÉGIAS (22/10), ~10 min antes de cada jogo, com as odds daquele momento (campo momento = código da
//      estratégia; mov = movimento equivalente desde a abertura): ver ESTRATEGIAS abaixo.
//   2) RESULTADO: jogo encerrado (ESPN) → box score → green / red / devolvida (linha inteira, empate) / anulada
//      (não jogou; a casa devolve). Jogo adiado ou cancelado → anulada.
// Desde 22/10 também roubos, tocos, P+A, P+R, R+A, roubos + tocos e os MERCADOS DO JOGO: total, handicap e vencedor
// com a projeção de jogo do Edgely (core: projecaoJogoEdgely; atleta = "jogo", tipo = "jogo-<k>", lado "O" = Over ou
// visitante); 1º tempo e quartos entram nas estratégias de linha e no arquivo (sem projeção).
// Arquivos: data/apostas_edgely/indice.json { meses, registrados: [dias], em } e data/apostas_edgely/AAAA-MM.json
//   { campos, jogos: {idEspn: {dia, titulo, inicio, fim}}, nomes: {idAtleta: nome}, apostas: [[...campos]] }
// Local: node scripts/apostas_edgely.mjs   (REGISTRAR=1 registra fora do horário; SAIDA=<pasta> grava em outro lugar)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  buscarDk, edgeProp, nomeChave, estatisticaBox, nomeAtletaEspn, ORDEM_PROJ, edgeJogo, projDoMercado, ladoDaProjecao, ladoDaMudanca,
  movimentoMercado, resultadoA, realDoJogo, chanceOver, semMargem,
} from "../js/core.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const raiz = new URL("../", import.meta.url);
const DIR = process.env.SAIDA ? new URL(`file:///${process.env.SAIDA.replace(/\\/g, "/").replace(/\/?$/, "/")}`) : new URL("data/apostas_edgely/", raiz);
export const CAMPOS = ["jogo", "atleta", "tipo", "linha", "over", "under", "lado", "proj", "min", "valor", "final", "em", "res", "real", "momento", "mov"];
const C = Object.fromEntries(CAMPOS.map((k, i) => [k, i]));
const getJson = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`);
  return r.json();
};
const lerJson = (u, padrao) => readFile(u, "utf8").then(JSON.parse).catch(() => padrao);

await mkdir(DIR, { recursive: true });
const indice = await lerJson(new URL("indice.json", DIR), { meses: [], registrados: [] });
const meses = new Map(), mudou = new Set();
const mes = async (m) => {
  if (!meses.has(m)) meses.set(m, await lerJson(new URL(`${m}.json`, DIR), { campos: CAMPOS, jogos: {}, nomes: {}, apostas: [] }));
  return meses.get(m);
};
const agora = Date.now();
const hojeEt = new Date(agora).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// registra as apostas de um jogo (momento "12h" = registro diário; "30m" = ~30 min antes do jogo, com a projeção e
// as linhas mais recentes, inclusive jogadores que a casa abriu depois)
// props da DraftKings do jogo + nomes dos atletas (elencos da ESPN); cria o jogo no arquivo do mês se faltar
async function lerJogo(ev, M) {
  const c = ev.competitions[0];
  const times = c.competitors.map((t) => t.team);
  const [dk, ...elencos] = await Promise.all([buscarDk(getJson, ev.id), ...times.map((t) => getJson(`${ESPN}/teams/${t.id}/roster`).catch(() => null))]);
  const nomes = Object.fromEntries(elencos.flatMap((r) => (r?.athletes || []).map((a) => [a.id, a.displayName])));
  // quem não está no elenco (troca recente, duas vias): nome pelo id do atleta
  for (const id of new Set(Object.values(dk.props).map((p) => p.atleta))) if (!nomes[id]) nomes[id] = await nomeAtletaEspn(getJson, id);
  const fora = c.competitors.find((t) => t.homeAway === "away")?.team, casa = c.competitors.find((t) => t.homeAway === "home")?.team;
  M.jogos[ev.id] ||= { dia: hojeEt, titulo: `${fora?.abbreviation} @ ${casa?.abbreviation}`, inicio: Date.parse(ev.date), fim: false };
  return { dk, nomes };
}
async function registrarJogo(ev, M, projs, edgely, momento) {
  const { dk, nomes } = await lerJogo(ev, M);
  // retrato das projeções do jogo neste momento (para o arquivo do mercado): nome -> valores na ordem ORDEM_PROJ;
  // pj12/pj30 = projeção do jogo {casa, fora, total, margem}
  const sufixo = momento === "12h" ? "12" : "30";
  M.jogos[ev.id][`p${sufixo}`] = Object.fromEntries((edgely.jogadores || []).filter((p) => p.ev === ev.id)
    .map((p) => [nomeChave(p.nome), ORDEM_PROJ.map((k) => p.proj?.[k] ?? null)]));
  M.jogos[ev.id][`pj${sufixo}`] = edgely.jogos?.[ev.id]?.proj || null;
  let novas = 0;
  for (const p of Object.values(dk.props)) {
    const nome = nomes[p.atleta];
    const pe = nome && projs.get(`${ev.id}|${nomeChave(nome)}`);
    if (!pe || pe.lesao === "Out") continue;
    const proj = pe.proj?.[p.tipo];
    const e = edgeProp(p.tipo, proj, p.linha, p.over, p.under);
    if (!e || !(e.ev > 0)) continue;
    M.nomes[p.atleta] = nome;
    M.apostas.push([ev.id, p.atleta, p.tipo, p.linha, p.over, p.under, e.lado === "Over" ? "O" : "U", proj, pe.proj?.min ?? null,
      Math.round(e.ev * 1000) / 1000, edgely.final ? 1 : 0, Math.floor(agora / 1000), null, null, momento,
      arred(movimentoMercado(p.tipo, p.linhaAb, p.linha, p.pAb, p.p))]);
    novas++;
  }
  // mercados do jogo com projeção do Edgely (total, handicap, vencedor)
  const pj = edgely.jogos?.[ev.id]?.proj;
  for (const k of ["total", "spread", "ml"]) {
    const m = dk.jogo[`jogo|${k}`], proj = projDoMercado(k, pj);
    const e = m && edgeJogo(k, proj, m.linha, m.a, m.b);
    if (!e || !(e.ev > 0)) continue;
    M.apostas.push([ev.id, "jogo", `jogo-${k}`, m.linha, m.a, m.b, e.lado, proj, null, Math.round(e.ev * 1000) / 1000, 1, Math.floor(agora / 1000), null, null, momento,
      arred(movimentoMercado(`jogo-${k}`, m.linhaAb, m.linha, m.pAb, m.p))]);
    novas++;
  }
  return novas;
}
const arred = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const projecoesDe = (edgely) => new Map((edgely?.jogadores || []).filter((p) => p.ev).map((p) => [`${p.ev}|${nomeChave(p.nome)}`, p]));

// ---------- 1) registro ----------
const horaUtc = new Date(agora).getUTCHours();
if ((horaUtc >= 15 || process.env.REGISTRAR === "1") && !indice.registrados.includes(hojeEt)) {
  const edgely = await lerJson(new URL("data/edgely.json", raiz), null);
  if (edgely?.data !== hojeEt) console.log(`Apostas: sem projeção do Edgely de ${hojeEt} ainda (tem ${edgely?.data || "nada"}); tenta na próxima rodada`);
  else {
    const projs = projecoesDe(edgely);
    const evs = ((await getJson(`${ESPN}/scoreboard?dates=${hojeEt.replaceAll("-", "")}`)).events || [])
      .filter((e) => e.status?.type?.state === "pre" && Date.parse(e.date) > agora);
    const M = await mes(hojeEt.slice(0, 7));
    let lidos = 0, novas = 0;
    for (const ev of evs) {
      try { novas += await registrarJogo(ev, M, projs, edgely, "12h"); lidos++; } catch (e) { console.error(`Apostas: ${ev.shortName}: ${e.message || e}`); }
    }
    // dia registrado se leu algum jogo (ou se não havia jogo a registrar); senão tenta de novo na próxima rodada
    if (lidos || !evs.length) {
      indice.registrados.push(hojeEt);
      mudou.add(hojeEt.slice(0, 7));
      console.log(`Apostas: ${novas} registradas em ${lidos}/${evs.length} jogos de ${hojeEt} (projeção ${edgely.final ? "final" : "preliminar"} do Edgely)`);
    }
  }
}

// ---------- 1b) registro ~30 min antes de cada jogo (a Action roda a cada ~10 min: entre ~25 e 35 min antes) ----------
{
  const janela = +(process.env.JANELA_MIN || 35) * 60e3;
  const edgely = await lerJson(new URL("data/edgely.json", raiz), null);
  if (edgely?.data === hojeEt) {
    const evs = ((await getJson(`${ESPN}/scoreboard?dates=${hojeEt.replaceAll("-", "")}`).catch(() => ({}))).events || [])
      .filter((e) => e.status?.type?.state === "pre" && Date.parse(e.date) > agora && Date.parse(e.date) - agora <= janela);
    const M = await mes(hojeEt.slice(0, 7)), projs = projecoesDe(edgely);
    for (const ev of evs) {
      if (M.jogos[ev.id]?.reg30) continue;
      try {
        const n = await registrarJogo(ev, M, projs, edgely, "30m");
        M.jogos[ev.id].reg30 = Math.floor(agora / 1000);
        mudou.add(hojeEt.slice(0, 7));
        console.log(`Apostas 30 min antes: ${ev.shortName}: ${n} registradas (projeção do Edgely de ${new Date(edgely.buscadoEm).toISOString().slice(11, 16)} UTC)`);
      } catch (e) { console.error(`Apostas 30 min: ${ev.shortName}: ${e.message || e}`); }
    }
  }
}

// ---------- 1c) ESTRATÉGIAS, ~10 min antes de cada jogo ----------
// Hipóteses da 1ª análise (21/10, 1 noite: ver CLAUDE.md), registradas para acompanhar o resultado real. "Movimento" =
// movimentoProp (mudança de linha + de odd desde a abertura, em chance do Over); "andou" = |movimento| ≥ 3 pp.
// A projeção é a mais recente do Edgely (scripts/edgely.mjs rebusca antes dos jogos), comparada com a linha de ABERTURA.
export const ESTRATEGIAS = {
  mov: "Seguir o movimento da linha",            // andou → lado do movimento (sem projeção)
  conf: "Projeção confirmada pela linha",        // projeção apontava um lado e a linha andou para ele → esse lado
  contra: "Linha contra a projeção: lado da linha", // projeção apontava um lado e a linha andou para o outro → lado da linha
  mudou: "Projeção mudou e a linha acompanhou",  // projeção mudou ≥ 0,5 desde as 12 h e a linha andou no mesmo sentido
  under: "Controle: Under em tudo",              // régua: separa o efeito da estratégia de uma noite de Under
  // 23/10, da análise segmentada (13 jogos, as duas noites no mesmo sentido):
  "mov-under": "Linha andou p/ Under → Under",   // o lado Under do "mov" (o Over que sobe ficou ~0: dinheiro de loteria?)
  "linha-volta": "Linha andou e a odd voltou → lado da linha", // a casa mexe a linha e devolve parte na odd
  "contra-mudou": "Projeção mudou sozinha → contra ela", // projeção mudou ≥ 0,5 desde as 12 h e a linha NÃO acompanhou
  // 24/10, da análise das 3 noites (25 jogos; em 23/10 o "mov" perdeu: o movimento da MANHÃ é ruído, o da TARDE informa):
  "tarde-under": "Linha caiu à tarde → Under",   // desde as 12 h de Brasília andou ≥ 3 pp p/ Under e no total também
  "estrela-under": "Linha alta (estrela) → Under", // linha no topo do mercado (ALTA): o público compra o Over da estrela
  "parelho-under": "Jogo parelho, titular → Under", // |handicap| ≤ 4 e ≥ 30 min projetados (hipótese de 1 noite só)
};
const ANDOU = 0.03;
// linha "alta" de cada mercado (estrela). Na análise de 24/10 só rebotes (≥ 8,5) e assistências (≥ 6,5) foram
// consistentes nas duas noites grandes; os outros mercados entram para medir
const ALTA = { points: 22.5, rebounds: 8.5, assists: 6.5, threes: 3.5, pra: 33.5, pa: 27.5, pr: 28.5, ra: 12.5 };
// linha às 12 h de Brasília (15h10 UTC, logo depois do registro das 12 h) no histórico data/linhas_dk.json: último ponto
// gravado até lá; null se a linha ainda não existia
const chaveHist = (atleta, tipo) => (atleta === "jogo" ? `jogo|${tipo.slice(5)}` : `${atleta}|${tipo}`);
const linha12 = (H, chave, dia) => { const c = Date.parse(`${dia}T15:10:00Z`); return (H?.[chave] || []).filter((h) => h[0] != null && h[0] * 1000 <= c).pop() || null; };
const linhasDk = await lerJson(new URL("data/linhas_dk.json", raiz), null);
// cada mercado do jogo vira um item com a mesma forma das props (lado A = "O")
function itensDoJogo(ev, dk, nomes, projs, j, edgely) {
  const out = [];
  for (const p of Object.values(dk.props)) {
    const nome = nomes[p.atleta], chave = nome && nomeChave(nome);
    const pe = chave && projs.get(`${ev.id}|${chave}`);
    if (pe?.lesao === "Out") continue;
    const i = ORDEM_PROJ.indexOf(p.tipo);
    out.push({ atleta: p.atleta, nome, tipo: p.tipo, linha: p.linha, linhaAb: p.linhaAb, a: p.over, b: p.under, p: p.p, pAb: p.pAb,
      proj: pe?.proj?.[p.tipo] ?? null, proj12: j.p12?.[chave]?.[i] ?? null, min: pe?.proj?.min ?? null });
  }
  const pj = edgely?.jogos?.[ev.id]?.proj;
  for (const m of Object.values(dk.jogo)) {
    out.push({ atleta: "jogo", tipo: `jogo-${m.k}`, linha: m.linha, linhaAb: m.linhaAb, a: m.a, b: m.b, p: m.p, pAb: m.pAb,
      proj: projDoMercado(m.k, pj), proj12: projDoMercado(m.k, j.pj12), min: null });
  }
  return out;
}
// chance do lado A pela projeção (valor esperado informativo nas estratégias)
function chanceA(x) {
  if (x.proj == null) return null;
  if (x.tipo.startsWith("jogo-")) { const e = edgeJogo(x.tipo.slice(5), x.proj, x.linha, x.a, x.b); return e ? (e.lado === "O" ? e.chance : 1 - e.chance) : null; }
  return chanceOver(x.tipo, x.proj, x.linha);
}
{
  const janela = +(process.env.JANELA_EST_MIN || 15) * 60e3;
  const edgely = await lerJson(new URL("data/edgely.json", raiz), null);
  const evs = ((await getJson(`${ESPN}/scoreboard?dates=${hojeEt.replaceAll("-", "")}`).catch(() => ({}))).events || [])
    .filter((e) => e.status?.type?.state === "pre" && Date.parse(e.date) > agora && Date.parse(e.date) - agora <= janela);
  const ed = edgely?.data === hojeEt ? edgely : null;
  const M = await mes(hojeEt.slice(0, 7)), projs = projecoesDe(ed);
  for (const ev of evs) {
    if (M.jogos[ev.id]?.regE) continue;
    try {
      const { dk, nomes } = await lerJogo(ev, M);
      const j = M.jogos[ev.id], conta = {}, itens = itensDoJogo(ev, dk, nomes, projs, j, ed);
      const H = linhasDk?.jogos?.[ev.id]?.h, handicap = itens.find((y) => y.tipo === "jogo-spread")?.linha;
      for (const x of itens) {
        if (!x.a || !x.b) continue;
        const mov = movimentoMercado(x.tipo, x.linhaAb, x.linha, x.pAb, x.p);
        const ladoMov = mov == null ? null : mov >= ANDOU ? "O" : mov <= -ANDOU ? "U" : null;
        const dirProj = ladoDaProjecao(x.tipo, x.proj, x.linhaAb ?? x.linha);
        const pa = chanceA(x);
        const reg = (est, lado) => {
          if (x.atleta !== "jogo") M.nomes[x.atleta] = x.nome || M.nomes[x.atleta] || null;
          M.apostas.push([ev.id, x.atleta, x.tipo, x.linha, x.a, x.b, lado, x.proj, x.min,
            pa == null ? null : arred(lado === "O" ? pa * x.a - 1 : (1 - pa) * x.b - 1), 1, Math.floor(agora / 1000), null, null, est, arred(mov)]);
          conta[est] = (conta[est] || 0) + 1;
        };
        if (ladoMov) reg("mov", ladoMov);
        if (ladoMov && dirProj) reg(ladoMov === dirProj ? "conf" : "contra", ladoMov);
        const lm = x.proj != null && x.proj12 != null && Math.abs(x.proj - x.proj12) >= 0.5 ? ladoDaMudanca(x.tipo, x.proj12, x.proj) : null;
        if (ladoMov && lm === ladoMov) reg("mudou", ladoMov);
        if (x.tipo !== "jogo-spread" && x.tipo !== "jogo-ml") reg("under", "U"); // controle: só onde existe Under
        if (ladoMov === "U") reg("mov-under", "U");
        // linha andou (props/totais: subiu → Over; handicap: linha do visitante caiu → visitante) e a odd voltou (≥ 1 pp)
        const ladoLinha = x.linha == null || x.linhaAb == null || x.linha === x.linhaAb ? null
          : x.tipo === "jogo-spread" ? (x.linha < x.linhaAb ? "O" : "U") : (x.linha > x.linhaAb ? "O" : "U");
        const ladoOdd = x.p == null || x.pAb == null || Math.abs(x.p - x.pAb) < 0.01 ? null : x.p > x.pAb ? "O" : "U";
        if (ladoLinha && ladoOdd && ladoOdd !== ladoLinha) reg("linha-volta", ladoLinha);
        if (lm && ladoMov !== lm) reg("contra-mudou", lm === "O" ? "U" : "O");
        const temUnder = x.tipo !== "jogo-spread" && x.tipo !== "jogo-ml";
        const s12 = linha12(H, chaveHist(x.atleta, x.tipo), hojeEt);
        const tarde = s12 ? movimentoMercado(x.tipo, s12[1], x.linha, semMargem(s12[2], s12[3]), x.p) : null;
        if (temUnder && tarde != null && tarde <= -ANDOU && ladoMov === "U") reg("tarde-under", "U");
        if (ALTA[x.tipo] != null && x.linha >= ALTA[x.tipo]) reg("estrela-under", "U");
        if (x.atleta !== "jogo" && x.min >= 30 && handicap != null && Math.abs(handicap) <= 4) reg("parelho-under", "U");
      }
      j.regE = Math.floor(agora / 1000);
      mudou.add(hojeEt.slice(0, 7));
      console.log(`Estratégias: ${ev.shortName}: ${Object.entries(conta).map(([k, n]) => `${k} ${n}`).join(", ") || "nada"}`);
    } catch (e) { console.error(`Estratégias: ${ev.shortName}: ${e.message || e}`); }
  }
}

// ---------- arquivo do MERCADO: todas as props de cada jogo encerrado, não só as apostas ----------
// data/apostas_edgely/mercado-AAAA-MM.json: { campos, jogos: {id: {dia, titulo, inicio}}, nomes, props: [[...]] }
// abertura (L0/O0/U0) e fechamento (último ponto gravado antes do início: L1/O1/U1) vêm de data/linhas_dk.json, que o
// site apaga 30 h depois do jogo; projeções do Edgely no registro das 12 h e no de 30 min antes; resultado do box score.
// L12/O12/U12 (24/10): a linha às 12 h de Brasília (movimento da manhã × da tarde); 21–23/10 preenchidos pelas apostas das 12 h.
export const CAMPOS_MERCADO = ["jogo", "atleta", "tipo", "L0", "O0", "U0", "L1", "O1", "U1", "proj12", "proj30", "real", "L12", "O12", "U12"];
const mercados = new Map();
const mercado = async (m) => {
  if (!mercados.has(m)) mercados.set(m, await lerJson(new URL(`mercado-${m}.json`, DIR), { campos: CAMPOS_MERCADO, jogos: {}, nomes: {}, props: [] }));
  return mercados.get(m);
};
async function arquivarMercado(id, j, box, cancelado, placar) {
  const H = linhasDk?.jogos?.[id]?.h;
  if (!H || cancelado) return 0;
  const MM = await mercado(j.dia.slice(0, 7));
  if (MM.jogos[id]) return 0;
  MM.jogos[id] = { dia: j.dia, titulo: j.titulo, inicio: j.inicio };
  let n = 0;
  for (const [k, serie] of Object.entries(H)) {
    const s12 = linha12(H, k, j.dia), l12 = [s12?.[1] ?? null, s12?.[2] ?? null, s12?.[3] ?? null];
    if (k.startsWith("jogo|")) { // mercado do jogo: real pelos placares por quarto (handicap/vencedor = visitante − mandante)
      const mk = k.slice(5), ab = serie.find((h) => h[0] == null) || serie[0], fe = serie.filter((h) => h[0] != null && h[0] * 1000 < j.inicio).pop() || ab;
      MM.props.push([id, "jogo", `jogo-${mk}`, ab[1], ab[2], ab[3], fe[1], fe[2], fe[3], projDoMercado(mk, j.pj12), projDoMercado(mk, j.pj30), realDoJogo(mk, placar.casa, placar.fora), ...l12]);
      n++;
      continue;
    }
    const [atleta, tipo] = k.split("|");
    const ab = serie.find((h) => h[0] == null) || serie[0];
    const fe = serie.filter((h) => h[0] != null && h[0] * 1000 < j.inicio).pop() || ab;
    const b = box.get(atleta);
    const nome = b?.nome || MM.nomes[atleta] || (await nomeAtletaEspn(getJson, atleta)), chave = nome && nomeChave(nome);
    const real = b?.jogou ? estatisticaBox(b.keys, b.stats, tipo) : null;
    if (nome) MM.nomes[atleta] = nome;
    const i = ORDEM_PROJ.indexOf(tipo);
    MM.props.push([id, atleta, tipo, ab[1], ab[2], ab[3], fe[1], fe[2], fe[3], j.p12?.[chave]?.[i] ?? null, j.p30?.[chave]?.[i] ?? null, real, ...l12]);
    n++;
  }
  return n;
}

// ---------- 2) resultados (mês atual e anterior) ----------
const mesAnterior = new Date(Date.parse(`${hojeEt.slice(0, 7)}-15`) - 30 * 864e5).toISOString().slice(0, 7);
let resolvidos = 0;
for (const m of [mesAnterior, hojeEt.slice(0, 7)].filter((m) => indice.meses.includes(m) || mudou.has(m))) {
  const M = await mes(m);
  for (const [id, j] of Object.entries(M.jogos)) {
    if (j.fim || agora < j.inicio + 2 * 3600e3) continue;
    const s = await getJson(`${ESPN}/summary?event=${id}`).catch(() => null);
    const st = s?.header?.competitions?.[0]?.status?.type;
    if (!st) continue;
    const cancelado = /POSTPONED|CANCELED|CANCELLED/.test(st.name || "");
    if (!st.completed && !cancelado) continue;
    const box = new Map(); // idAtleta -> { keys, stats, jogou }
    for (const t of s.boxscore?.players || []) {
      const est = t.statistics?.[0];
      for (const a of est?.athletes || []) box.set(String(a.athlete?.id), { nome: a.athlete?.displayName, keys: est.keys || [], stats: a.stats || [], jogou: !a.didNotPlay && (a.stats || []).length > 0 && a.stats[0] !== "0" });
    }
    // placar por quarto (mercados do jogo): [q1, q2, q3, q4, prorrogações]
    const placar = { casa: [], fora: [] };
    for (const c of s.header?.competitions?.[0]?.competitors || []) placar[c.homeAway === "home" ? "casa" : "fora"] = (c.linescores || []).map((l) => +l.displayValue || 0);
    for (const a of M.apostas) {
      if (a[C.jogo] !== id || a[C.res]) continue;
      let real = null;
      if (cancelado) real = null;
      else if (a[C.atleta] === "jogo") real = realDoJogo(a[C.tipo].slice(5), placar.casa, placar.fora);
      else { const b = box.get(String(a[C.atleta])); real = b?.jogou ? estatisticaBox(b.keys, b.stats, a[C.tipo]) : null; }
      a[C.real] = real;
      const r = resultadoA(a[C.tipo], real, a[C.linha]);
      a[C.res] = r == null ? "A" : r === 0 ? "P" : (r > 0) === (a[C.lado] === "O") ? "G" : "R";
      resolvidos++;
    }
    j.fim = true;
    mudou.add(m);
    const arq = await arquivarMercado(id, j, box, cancelado, placar);
    if (arq) console.log(`Mercado: ${j.titulo} ${arq} props arquivadas`);
  }
}

// ---------- gravar (uma aposta por linha: diferenças pequenas no git) ----------
for (const m of mudou) {
  const M = meses.get(m);
  const txt = `{"campos":${JSON.stringify(CAMPOS)},\n"jogos":${JSON.stringify(M.jogos)},\n"nomes":${JSON.stringify(M.nomes)},\n"apostas":[\n${M.apostas.map((a) => JSON.stringify(a)).join(",\n")}\n]}\n`;
  await writeFile(new URL(`${m}.json`, DIR), txt);
  if (!indice.meses.includes(m)) indice.meses.push(m);
}
for (const [m, MM] of mercados) {
  if (!MM.props.length) continue;
  await writeFile(new URL(`mercado-${m}.json`, DIR), `{"campos":${JSON.stringify(CAMPOS_MERCADO)},\n"jogos":${JSON.stringify(MM.jogos)},\n"nomes":${JSON.stringify(MM.nomes)},\n"props":[\n${MM.props.map((a) => JSON.stringify(a)).join(",\n")}\n]}\n`);
}
if (mudou.size) {
  indice.meses.sort();
  indice.registrados = indice.registrados.slice(-400);
  indice.em = Math.floor(agora / 1000);
  await writeFile(new URL("indice.json", DIR), JSON.stringify(indice));
}
console.log(`Apostas: ${resolvidos} resultados novos${mudou.size ? ` · gravado ${[...mudou].join(", ")}` : " · nada a gravar"}`);
