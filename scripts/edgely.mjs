// Projeções dos jogadores da NBA no Edgely (edgely.bet/nba) para a aba Edge da página props.html.
// Roda na Action (a cada ~10 min). O Edgely ATUALIZA a projeção em horários imprevisíveis durante o dia (21/10: 174 de
// 311 jogadores mudaram à tarde; 22/10: atualização ~13h30 de Brasília) e a API não diz quando (sem data nem ETag;
// o "Data loaded" da página deles é a hora do navegador). Então, das 5 h ET (6 h de Brasília; a preliminar sai cedo, 24/10 já estava lá antes das 6h30 ET) até o último jogo começar:
//   - consulta a cada 30 min, e a cada 10 min quando falta ≤ 1 h para algum jogo (a resposta passa pelo cache deles,
//     60 s; ~80–570 KB conforme o número de jogos; ~25–40 consultas por dia, como alguém recarregando a página);
//   - quando alguém aperta "Buscar projeções" na página: o Worker guarda o pedido (/edgely-pedido) e dispara a Action;
//   - dia novo ainda não publicado por eles: tenta a cada 30 min.
// Cada consulta é comparada com a anterior: "mudouEm" = quando o Edgely mudou a projeção pela última vez e "versoes" =
// histórico do dia ({em, mudaram}).
// Nunca duas consultas com menos de 10 min. Uma consulta = /api/nba/players/tonight/full (todos os jogadores do dia).
// Grava data/edgely.json: { data, buscadoEm, mudouEm, versoes, tentativa, final, erro, jogos: {idEspn: {fora, casa, inicio, proj}}, jogadores }.
// VERSÕES (24/10): cada versão nova (dia novo ou projeção que mudou) é guardada para sempre em
// data/apostas_edgely/edgely-AAAA-MM.json (o commit da Action leva junto): { campos, versoes: [{data, em, jogos, jogadores: [[...campos]]}] },
// uma versão por linha. Não é lido pela página: é para medir, no fim da temporada, quanto a projeção mudou e se a última acerta mais.
// Local: node scripts/edgely.mjs   (FORCAR=1 ignora as regras acima)
import { readFile, writeFile } from "node:fs/promises";
import { projecaoJogoEdgely, ORDEM_PROJ } from "../js/core.js";

const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
const FONTE = "https://edgely.bet/api/nba/players/tonight/full";
const JOGOS = "https://edgely.bet/api/nba/games/today"; // estatísticas avançadas dos times (projeção do jogo), ~12 KB
const raiz = new URL("../", import.meta.url);
const arquivo = new URL("data/edgely.json", raiz);
const getJson = async (u, h = {}) => {
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...h } });
  if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`);
  return r.json();
};

// o mais novo entre o publicado no site e o do repositório (um commit recente pode ainda não estar publicado)
const [pub, repo] = await Promise.all([getJson(`${SITE}/data/edgely.json?t=${Date.now()}`).catch(() => null), readFile(arquivo, "utf8").then(JSON.parse).catch(() => null)]);
const antes = (repo?.buscadoEm || 0) > (pub?.buscadoEm || 0) ? repo : pub;
const cfg = JSON.parse(await readFile(new URL("data/config.json", raiz), "utf8").catch(() => "{}"));
const pedido = cfg.relay ? await getJson(`${cfg.relay.replace(/\/$/, "")}/edgely-pedido`).then((j) => j.pedido || 0).catch(() => 0) : 0;

const agora = Date.now();
const et = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ...o }).format(new Date(agora));
const hojeEt = et({ year: "numeric", month: "2-digit", day: "2-digit" });
const horaEt = +et({ hour: "numeric", hourCycle: "h23" });
const tentativa = antes?.tentativa || 0;
const pedidoNovo = pedido > (antes?.buscadoEm || 0);
const temHoje = antes?.data === hojeEt;
let saida = antes || { data: null, buscadoEm: null, tentativa: null, final: true, jogos: {}, jogadores: [] };

const inicios = Object.values(antes?.jogos || {}).map((j) => j.inicio).filter(Boolean);
const INICIO_ET = 5; // a preliminar do Edgely sai de madrugada/cedo (antes era 9 h ET e perdia a manhã)
const emJanela = temHoje && horaEt >= INICIO_ET && inicios.some((t) => t > agora); // ainda há jogo de hoje por começar
const intervalo = inicios.some((t) => t > agora && t - agora <= 3600e3) ? 10 * 60e3 : 30 * 60e3;
const buscar = process.env.FORCAR === "1" || (pedidoNovo && agora - tentativa > 10 * 60e3)
  || (!temHoje && horaEt >= INICIO_ET && agora - tentativa > 30 * 60e3)
  || (emJanela && agora - tentativa >= intervalo - 2 * 60e3); // folga: a Action roda a cada ~10 min

if (buscar) {
  try {
    const d = await getJson(FONTE, { Referer: "https://edgely.bet/nba/" });
    const gt = await getJson(JOGOS, { Referer: "https://edgely.bet/nba/" }).catch(() => null);
    const adv = Object.fromEntries((gt?.games || []).map((g) => [g.espn_event_id, g]));
    const jogos = {}, timeEv = {};
    for (const g of d.games || []) {
      if (!g.espn_event_id) continue;
      const a = adv[g.espn_event_id];
      jogos[g.espn_event_id] = { fora: g.away_team?.code, casa: g.home_team?.code, inicio: Date.parse(g.game_time_est) || null,
        proj: projecaoJogoEdgely(a?.home_team?.advanced, a?.away_team?.advanced) };
      timeEv[g.away_team?.code] = timeEv[g.home_team?.code] = g.espn_event_id;
    }
    const n = (v) => (typeof v === "number" ? v : null);
    const soma = (...v) => (v.every((x) => x != null) ? Math.round(v.reduce((t, x) => t + x, 0) * 10) / 10 : null);
    // combinações (P+A, P+R, R+A, roubos + tocos) = soma das projeções do Edgely
    const proj = (q) => { const o = { points: n(q.points), rebounds: n(q.rebounds), assists: n(q.assists), threes: n(q.three_pointers_made), pra: n(q.pra),
      min: n(q.minutes), steals: n(q.steals), blocks: n(q.blocks) };
      return { ...o, pa: soma(o.points, o.assists), pr: soma(o.points, o.rebounds), ra: soma(o.rebounds, o.assists), stocks: soma(o.steals, o.blocks) }; };
    const jogadores = (d.players || []).filter((p) => p.projections).map((p) => ({
      nome: p.name, time: p.team, ev: timeEv[p.team] || null, pos: p.position || "", lesao: p.injury_status || null,
      proj: proj(p.projections),
    }));
    // mudou desde a consulta anterior? (mesmo dia: compara jogador a jogador; dia novo conta como mudança)
    const mesmoDia = antes?.data === d.date;
    const ant = new Map((mesmoDia ? antes.jogadores : []).map((p) => [`${p.time}|${p.nome}`, p]));
    const mudaram = jogadores.filter((p) => { const a = ant.get(`${p.time}|${p.nome}`); return !a || Object.keys(p.proj).some((k) => k in a.proj && Math.abs((p.proj[k] ?? 0) - (a.proj[k] ?? 0)) > 0.05) || p.lesao !== a.lesao; }).length;
    const mudou = !mesmoDia || mudaram > 0;
    // arquivo antigo sem histórico: a versão anterior vale desde a busca dela
    const anteriores = mesmoDia ? antes.versoes?.length ? antes.versoes : [{ em: antes.buscadoEm, mudaram: null }] : [];
    const versoes = [...anteriores, ...(mudou ? [{ em: agora, mudaram }] : [])].slice(-50);
    saida = { data: d.date || null, buscadoEm: agora, mudouEm: mudou ? agora : antes?.mudouEm ?? antes?.buscadoEm ?? agora, versoes, tentativa: agora, final: true, erro: null, pedido: pedidoNovo, jogos, jogadores };
    console.log(`Edgely ${saida.data}: ${jogadores.length} jogadores em ${Object.keys(jogos).length} jogos · ${mudou ? `MUDOU (${mudaram} jogadores)` : "sem mudança"}${pedidoNovo ? " (pedido da página)" : ""}`);
  } catch (e) {
    saida = { ...saida, tentativa: agora, erro: String(e.message || e) };
    console.error("Edgely:", saida.erro);
  }
} else {
  console.log(`Edgely: sem consulta (projeções de ${antes?.data || "–"}${pedidoNovo ? "; pedido aguardando o intervalo de 10 min" : ""})`);
}
await writeFile(arquivo, JSON.stringify(saida));
if (saida.buscadoEm === agora && saida.mudouEm === agora && saida.data) {
  const CAMPOS_V = ["time", "nome", "ev", "pos", "lesao", ...ORDEM_PROJ];
  const arqV = new URL(`data/apostas_edgely/edgely-${saida.data.slice(0, 7)}.json`, raiz);
  const V = await readFile(arqV, "utf8").then(JSON.parse).catch(() => ({ campos: CAMPOS_V, versoes: [] }));
  V.versoes.push({ data: saida.data, em: agora, jogos: saida.jogos, jogadores: saida.jogadores.map((p) => [p.time, p.nome, p.ev, p.pos, p.lesao, ...ORDEM_PROJ.map((k) => p.proj[k] ?? null)]) });
  await writeFile(arqV, `{"campos":${JSON.stringify(CAMPOS_V)},\n"versoes":[\n${V.versoes.map((v) => JSON.stringify(v)).join(",\n")}\n]}\n`);
  console.log(`Edgely: versão guardada em edgely-${saida.data.slice(0, 7)}.json (${V.versoes.length} no mês)`);
}
