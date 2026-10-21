// Projeções dos jogadores da NBA no Edgely (edgely.bet/nba) para a aba Edge da página props.html.
// Roda na Action (a cada ~10 min), mas só consulta o Edgely quando precisa (é raspagem de site alheio: poucas
// consultas para não arriscar bloqueio do IP):
//   - automático: 1x por dia a partir das 9 h ET (o Edgely carrega a projeção ~8h30 ET e ela já é a final: a de
//     08:46 e a de 12:58 de 21/10 eram idênticas nos 311 jogadores; o que chega depois são as LINHAS deles, que não
//     usamos); se ainda vier o dia anterior, tenta de novo 1 h depois;
//   - de novo quando falta ≤ 45 min para um jogo e a projeção tem > 25 min (pega atualizações do dia);
//   - quando alguém aperta "Buscar projeções" na página: o Worker guarda o pedido (/edgely-pedido) e dispara a Action.
// Nunca duas consultas com menos de 10 min. Uma consulta = /api/nba/players/tonight/full (todos os jogadores do dia).
// Grava data/edgely.json: { data, buscadoEm, tentativa, final, erro, jogos: {idEspn: {fora, casa}}, jogadores: [...] }.
// Local: node scripts/edgely.mjs   (FORCAR=1 ignora as regras acima)
import { readFile, writeFile } from "node:fs/promises";

const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
const FONTE = "https://edgely.bet/api/nba/players/tonight/full";
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

// antes de cada jogo: o Edgely às vezes atualiza a projeção durante o dia; com jogo começando em até 45 min e a
// projeção com mais de 25 min, busca de novo (1 consulta por horário de início) para o registro de 30 min antes
const jogoPerto = temHoje && Object.values(antes?.jogos || {}).some((j) => j.inicio && j.inicio > agora && j.inicio - agora <= 45 * 60e3);
const buscar = process.env.FORCAR === "1" || (pedidoNovo && agora - tentativa > 10 * 60e3)
  || (!temHoje && horaEt >= 9 && agora - tentativa > 3600e3)
  || (jogoPerto && agora - (antes?.buscadoEm || 0) > 25 * 60e3 && agora - tentativa > 10 * 60e3);

if (buscar) {
  try {
    const d = await getJson(FONTE, { Referer: "https://edgely.bet/nba/" });
    const jogos = {}, timeEv = {};
    for (const g of d.games || []) {
      if (!g.espn_event_id) continue;
      jogos[g.espn_event_id] = { fora: g.away_team?.code, casa: g.home_team?.code, inicio: Date.parse(g.game_time_est) || null };
      timeEv[g.away_team?.code] = timeEv[g.home_team?.code] = g.espn_event_id;
    }
    const n = (v) => (typeof v === "number" ? v : null);
    const jogadores = (d.players || []).filter((p) => p.projections).map((p) => ({
      nome: p.name, time: p.team, ev: timeEv[p.team] || null, pos: p.position || "", lesao: p.injury_status || null,
      proj: { points: n(p.projections.points), rebounds: n(p.projections.rebounds), assists: n(p.projections.assists),
        threes: n(p.projections.three_pointers_made), pra: n(p.projections.pra), min: n(p.projections.minutes) },
    }));
    saida = { data: d.date || null, buscadoEm: agora, tentativa: agora, final: true, erro: null, pedido: pedidoNovo, jogos, jogadores };
    console.log(`Edgely ${saida.data}: ${jogadores.length} jogadores em ${Object.keys(jogos).length} jogos${pedidoNovo ? " (pedido da página)" : ""}`);
  } catch (e) {
    saida = { ...saida, tentativa: agora, erro: String(e.message || e) };
    console.error("Edgely:", saida.erro);
  }
} else {
  console.log(`Edgely: sem consulta (projeções de ${antes?.data || "–"}${pedidoNovo ? "; pedido aguardando o intervalo de 10 min" : ""})`);
}
await writeFile(arquivo, JSON.stringify(saida));
