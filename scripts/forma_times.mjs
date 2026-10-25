// Forma recente dos times da NBA (25/10/2026, pedido do usuário: projeção de pontos de cada time pelos últimos jogos,
// com critério de desvio-padrão). Roda na Action; no máximo a cada 3 h (o placar só muda depois dos jogos). Para cada
// time, os últimos N_FORMA jogos de temporada regular (ESPN, /teams/<id>/schedule): se a temporada atual ainda tem menos
// que isso, completa com o fim da anterior (marcado pela temporada de cada jogo). Grava data/forma_times.json (só no
// site; a página e o registro das 12 h usam core.formaDoJogo):
//   { em, temporada, times: { "<sigla>": { id, jogos: [[ms do jogo, pontos, sofridos, 1 = em casa, temporada]] } } }
// Local: node scripts/forma_times.mjs   (FORCAR=1 ignora o intervalo de 3 h)
import { writeFile } from "node:fs/promises";
import { N_FORMA } from "../js/core.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
const arquivo = new URL("../data/forma_times.json", import.meta.url);
const getJson = async (u) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`); return r.json(); };
const antes = await getJson(`${SITE}/data/forma_times.json?t=${Date.now()}`).catch(() => null);
if (antes?.em && Date.now() - antes.em < 3 * 3600e3 && process.env.FORCAR !== "1") {
  await writeFile(arquivo, JSON.stringify(antes)); // o publicado segue valendo nesta rodada
  console.log(`Forma dos times: a de ${new Date(antes.em).toISOString()} ainda vale (atualiza a cada 3 h)`);
} else {
  const lista = (await getJson(`${ESPN}/teams`)).sports[0].leagues[0].teams.map((t) => t.team);
  const jogosDe = (j, idTime) => (j?.events || []).map((e) => {
    const c = e.competitions?.[0], eu = c?.competitors?.find((t) => t.team?.id === idTime), ele = c?.competitors?.find((t) => t.team?.id !== idTime);
    const pts = +(eu?.score?.value ?? eu?.score?.displayValue), sof = +(ele?.score?.value ?? ele?.score?.displayValue);
    return c?.status?.type?.completed && Number.isFinite(pts) && Number.isFinite(sof) ? [Date.parse(e.date), pts, sof, eu.homeAway === "home" ? 1 : 0, j.requestedSeason?.year ?? null] : null;
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);
  const times = {};
  let temporada = null, falhas = 0;
  for (const t of lista) {
    try {
      const atual = await getJson(`${ESPN}/teams/${t.id}/schedule`);
      temporada ??= atual.requestedSeason?.year ?? null;
      let J = jogosDe(atual, t.id);
      if (J.length < N_FORMA && atual.requestedSeason?.year) J = [...jogosDe(await getJson(`${ESPN}/teams/${t.id}/schedule?season=${atual.requestedSeason.year - 1}`).catch(() => null), t.id), ...J];
      times[t.abbreviation] = { id: t.id, jogos: J.slice(-N_FORMA) };
    } catch (e) { falhas++; console.error(`Forma: ${t.abbreviation}: ${e.message}`); if (antes?.times?.[t.abbreviation]) times[t.abbreviation] = antes.times[t.abbreviation]; }
  }
  await writeFile(arquivo, JSON.stringify({ em: Date.now(), temporada, times }));
  console.log(`Forma dos times: ${Object.keys(times).length} times, últimos ${N_FORMA} jogos${falhas ? ` · ${falhas} falhas` : ""}`);
}
