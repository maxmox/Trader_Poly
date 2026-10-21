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
      for (const a of est?.athletes || []) box.set(String(a.athlete?.id), { keys: est.keys || [], stats: a.stats || [], jogou: !a.didNotPlay && (a.stats || []).length > 0 && a.stats[0] !== "0" });
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
  }
}

// ---------- gravar (uma aposta por linha: diferenças pequenas no git) ----------
for (const m of mudou) {
  const M = meses.get(m);
  const txt = `{"campos":${JSON.stringify(CAMPOS)},\n"jogos":${JSON.stringify(M.jogos)},\n"nomes":${JSON.stringify(M.nomes)},\n"apostas":[\n${M.apostas.map((a) => JSON.stringify(a)).join(",\n")}\n]}\n`;
  await writeFile(new URL(`${m}.json`, DIR), txt);
  if (!indice.meses.includes(m)) indice.meses.push(m);
}
if (mudou.size) {
  indice.meses.sort();
  indice.registrados = indice.registrados.slice(-400);
  indice.em = Math.floor(agora / 1000);
  await writeFile(new URL("indice.json", DIR), JSON.stringify(indice));
}
console.log(`Apostas: ${resolvidos} resultados novos${mudou.size ? ` · gravado ${[...mudou].join(", ")}` : " · nada a gravar"}`);
