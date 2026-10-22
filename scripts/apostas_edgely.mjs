// Acompanhamento estatístico das props da NBA pelo Edgely (aba "Acompanhamento" de props.html), 21/10/2026.
// Roda na Action (a cada ~10 min); o arquivo é guardado no próprio repositório (a Action faz commit), então o
// histórico não depende do site publicado.
//   1) REGISTRO, 1x por dia a partir das 12 h de Brasília (15 h UTC): para cada prop da DraftKings (pontos,
//      rebotes, assistências, cestas de 3, PRA) dos jogos de hoje que ainda não começaram, com projeção do Edgely
//      de hoje, registra uma aposta no lado de maior valor esperado (edgeProp do core) SE esse valor for > 0, com
//      a linha e as odds Over/Under da DraftKings daquele momento. Jogador "Out" no Edgely fica de fora.
//   1b) ~30 MIN ANTES de cada jogo, de novo, com a projeção e as linhas mais recentes (momento "30m"): pega a
//      atualização do Edgely durante o dia e os jogadores que a casa abre mais tarde. O registro das 12 h fica como está.
//   2) RESULTADO: jogo encerrado (ESPN) → box score → green / red / devolvida (linha inteira, empate) / anulada
//      (não jogou; a casa devolve). Jogo adiado ou cancelado → anulada.
// Arquivos: data/apostas_edgely/indice.json { meses, registrados: [dias], em } e data/apostas_edgely/AAAA-MM.json
//   { campos, jogos: {idEspn: {dia, titulo, inicio, fim}}, nomes: {idAtleta: nome}, apostas: [[...campos]] }
// Local: node scripts/apostas_edgely.mjs   (REGISTRAR=1 registra fora do horário; SAIDA=<pasta> grava em outro lugar)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buscarDk, edgeProp, nomeChave, estatisticaBox } from "../js/core.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const raiz = new URL("../", import.meta.url);
const DIR = process.env.SAIDA ? new URL(`file:///${process.env.SAIDA.replace(/\\/g, "/").replace(/\/?$/, "/")}`) : new URL("data/apostas_edgely/", raiz);
export const CAMPOS = ["jogo", "atleta", "tipo", "linha", "over", "under", "lado", "proj", "min", "valor", "final", "em", "res", "real", "momento"];
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
async function registrarJogo(ev, M, projs, edgely, momento) {
  const c = ev.competitions[0];
  const times = c.competitors.map((t) => t.team);
  const [dk, ...elencos] = await Promise.all([buscarDk(getJson, ev.id), ...times.map((t) => getJson(`${ESPN}/teams/${t.id}/roster`).catch(() => null))]);
  const nomes = Object.fromEntries(elencos.flatMap((r) => (r?.athletes || []).map((a) => [a.id, a.displayName])));
  const fora = c.competitors.find((t) => t.homeAway === "away")?.team, casa = c.competitors.find((t) => t.homeAway === "home")?.team;
  M.jogos[ev.id] ||= { dia: hojeEt, titulo: `${fora?.abbreviation} @ ${casa?.abbreviation}`, inicio: Date.parse(ev.date), fim: false };
  // retrato das projeções do jogo neste momento (para o arquivo do mercado): nome -> [pts, reb, ast, 3PM, PRA, min]
  M.jogos[ev.id][momento === "12h" ? "p12" : "p30"] = Object.fromEntries((edgely.jogadores || []).filter((p) => p.ev === ev.id)
    .map((p) => [nomeChave(p.nome), ["points", "rebounds", "assists", "threes", "pra", "min"].map((k) => p.proj?.[k] ?? null)]));
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
      Math.round(e.ev * 1000) / 1000, edgely.final ? 1 : 0, Math.floor(agora / 1000), null, null, momento]);
    novas++;
  }
  return novas;
}
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

// ---------- arquivo do MERCADO: todas as props de cada jogo encerrado, não só as apostas ----------
// data/apostas_edgely/mercado-AAAA-MM.json: { campos, jogos: {id: {dia, titulo, inicio}}, nomes, props: [[...]] }
// abertura (L0/O0/U0) e fechamento (último ponto gravado antes do início: L1/O1/U1) vêm de data/linhas_dk.json, que o
// site apaga 30 h depois do jogo; projeções do Edgely no registro das 12 h e no de 30 min antes; resultado do box score.
export const CAMPOS_MERCADO = ["jogo", "atleta", "tipo", "L0", "O0", "U0", "L1", "O1", "U1", "proj12", "proj30", "real"];
const IDX = { points: 0, rebounds: 1, assists: 2, threes: 3, pra: 4 };
const linhasDk = await lerJson(new URL("data/linhas_dk.json", raiz), null);
const mercados = new Map();
const mercado = async (m) => {
  if (!mercados.has(m)) mercados.set(m, await lerJson(new URL(`mercado-${m}.json`, DIR), { campos: CAMPOS_MERCADO, jogos: {}, nomes: {}, props: [] }));
  return mercados.get(m);
};
async function arquivarMercado(id, j, box, cancelado) {
  const H = linhasDk?.jogos?.[id]?.h;
  if (!H || cancelado) return 0;
  const MM = await mercado(j.dia.slice(0, 7));
  if (MM.jogos[id]) return 0;
  MM.jogos[id] = { dia: j.dia, titulo: j.titulo, inicio: j.inicio };
  let n = 0;
  for (const [k, serie] of Object.entries(H)) {
    if (k.startsWith("jogo|")) continue;
    const [atleta, tipo] = k.split("|");
    const ab = serie.find((h) => h[0] == null) || serie[0];
    const fe = serie.filter((h) => h[0] != null && h[0] * 1000 < j.inicio).pop() || ab;
    const b = box.get(atleta);
    const nome = b?.nome || null, chave = nome && nomeChave(nome);
    const real = b?.jogou ? estatisticaBox(b.keys, b.stats, tipo) : null;
    if (nome) MM.nomes[atleta] = nome;
    MM.props.push([id, atleta, tipo, ab[1], ab[2], ab[3], fe[1], fe[2], fe[3], j.p12?.[chave]?.[IDX[tipo]] ?? null, j.p30?.[chave]?.[IDX[tipo]] ?? null, real]);
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
    for (const a of M.apostas) {
      if (a[C.jogo] !== id || a[C.res]) continue;
      const b = box.get(String(a[C.atleta]));
      const real = !cancelado && b?.jogou ? estatisticaBox(b.keys, b.stats, a[C.tipo]) : null;
      a[C.real] = real;
      if (real == null) a[C.res] = "A";
      else if (real === a[C.linha]) a[C.res] = "P";
      else a[C.res] = (real > a[C.linha]) === (a[C.lado] === "O") ? "G" : "R";
      resolvidos++;
    }
    j.fim = true;
    mudou.add(m);
    const arq = await arquivarMercado(id, j, box, cancelado);
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
