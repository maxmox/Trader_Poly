// Projeções dos jogadores da NBA no Edgely (edgely.bet/nba) para a aba Edge da página props.html.
// Roda na Action (a cada ~10 min), mas só consulta o Edgely quando precisa (é raspagem de site alheio: poucas
// consultas para não arriscar bloqueio do IP):
//   - automático: a projeção preliminar do dia (a partir das 9 h ET) e a final, quando o Edgely põe as linhas
//     (até lá só olha, a cada 30 min, o endpoint pequeno /api/nba/props/today; detalhes mais abaixo);
//   - quando alguém aperta "Buscar projeções" na página: o Worker guarda o pedido (/edgely-pedido) e dispara a Action.
// Nunca duas consultas com menos de 10 min. Uma consulta = /api/nba/players/tonight/full (todos os jogadores do dia).
// Grava data/edgely.json: { data, buscadoEm, tentativa, final, erro, jogos: {idEspn: {fora, casa}}, jogadores: [...] }.
// Local: node scripts/edgely.mjs   (FORCAR=1 ignora as regras acima)
import { readFile, writeFile } from "node:fs/promises";

const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
const FONTE = "https://edgely.bet/api/nba/players/tonight/full";
const PRONTO = "https://edgely.bet/api/nba/props/today"; // pequeno: diz se o Edgely já pôs as linhas (projeção final)
const raiz = new URL("../", import.meta.url);
const arquivo = new URL("data/edgely.json", raiz);
const getJson = async (u, h = {}) => {
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...h } });
  if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`);
  return r.json();
};

// o publicado no site; antes da 1ª publicação, o do repositório
const antes = await getJson(`${SITE}/data/edgely.json?t=${Date.now()}`)
  .catch(() => readFile(arquivo, "utf8").then(JSON.parse).catch(() => null));
const cfg = JSON.parse(await readFile(new URL("data/config.json", raiz), "utf8").catch(() => "{}"));
const pedido = cfg.relay ? await getJson(`${cfg.relay.replace(/\/$/, "")}/edgely-pedido`).then((j) => j.pedido || 0).catch(() => 0) : 0;

const agora = Date.now();
const et = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ...o }).format(new Date(agora));
const hojeEt = et({ year: "numeric", month: "2-digit", day: "2-digit" });
const horaEt = +et({ hour: "numeric", hourCycle: "h23" });
const tentativa = antes?.tentativa || 0;
const pedidoNovo = pedido > (antes?.buscadoEm || 0);
const temHoje = antes?.data === hojeEt;
let saida = antes || { data: null, buscadoEm: null, tentativa: null, final: false, jogos: {}, jogadores: [] };

// O Edgely publica primeiro uma projeção preliminar (~8h30 ET) e só depois a final, junto com as linhas das casas
// (/api/nba/props/today passa a ter games_with_props > 0). Automático: das 9 h às 23 h ET, a cada 30 min, olha só
// esse endpoint pequeno (~2 KB) até a final sair; busca a projeção completa se ainda não há nada de hoje
// (preliminar) e quando a final aparece. Depois da final, nada até o dia seguinte.
const linhasProntas = () => getJson(PRONTO, { Referer: "https://edgely.bet/nba/" }).then((d) => (d.games_with_props || 0) > 0);
let buscar = false, final = null;
if (process.env.FORCAR === "1" || (pedidoNovo && agora - tentativa > 10 * 60e3)) buscar = true;
else if (!(temHoje && antes?.final) && horaEt >= 9 && horaEt < 23 && agora - tentativa > 30 * 60e3) {
  try {
    final = await linhasProntas();
    buscar = final || !temHoje;
    if (!buscar) saida = { ...saida, tentativa: agora };
  } catch (e) {
    saida = { ...saida, tentativa: agora, erro: String(e.message || e) };
  }
}

if (buscar) {
  try {
    final ??= await linhasProntas().catch(() => false);
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
    saida = { data: d.date || null, buscadoEm: agora, tentativa: agora, final, erro: null, pedido: pedidoNovo, jogos, jogadores };
    console.log(`Edgely ${saida.data} (${final ? "final" : "preliminar"}): ${jogadores.length} jogadores em ${Object.keys(jogos).length} jogos${pedidoNovo ? " (pedido da página)" : ""}`);
  } catch (e) {
    saida = { ...saida, tentativa: agora, erro: String(e.message || e) };
    console.error("Edgely:", saida.erro);
  }
} else {
  console.log(`Edgely: sem busca completa (projeções de ${antes?.data || "–"}, ${antes?.final ? "final" : "preliminar"}${final === false ? "; linhas do Edgely ainda não saíram" : ""}${pedidoNovo ? "; pedido aguardando o intervalo de 10 min" : ""})`);
}
await writeFile(arquivo, JSON.stringify(saida));
