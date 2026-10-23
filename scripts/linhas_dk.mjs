// Histórico das linhas da NBA na DraftKings (API pública da ESPN) para a página props.html.
// Roda na Action (a cada ~10 min, disparada pelo Worker). A ESPN recusa o Cloudflare (403), por isso não é o
// Worker que grava. Lê o histórico já publicado no site, acrescenta o que mudou em cada linha (props dos
// jogadores e mercados do jogo) e grava data/linhas_dk.json:
//   { em, jogos: { "<idEspn>": { inicio, h: { "<idAtleta>|<tipo>" | "jogo|<k>": [[t, linha, odd A, odd B], ...] } } } }
// O 1º ponto de cada série é a abertura (t = null). Jogos encerrados há mais de 1 dia saem.
// Local: node scripts/linhas_dk.mjs
import { writeFile } from "node:fs/promises";
import { buscarDk, datasNba } from "../js/core.js";

const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const raiz = new URL("../", import.meta.url);
const getJson = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(u).host} respondeu ${r.status}`);
  return r.json();
};

// histórico publicado: SEM ele não grava. Em 23/10/2026 uma leitura falhou (site sendo republicado) e o script começou
// do zero e publicou o vazio por cima: perdeu o dia. Agora tenta 4 vezes e, se não conseguir, sai com erro, e a
// Action não publica nesta rodada (o publicado fica intacto; a próxima rodada, 10 min depois, segue normal).
// INICIAR=1 começa um histórico novo de propósito.
let antes = null;
for (let i = 0; i < 4 && !antes; i++) {
  if (i) await new Promise((ok) => setTimeout(ok, 5000 * i));
  antes = await getJson(`${SITE}/data/linhas_dk.json?t=${Date.now()}`).then((d) => (d?.jogos ? d : null)).catch((e) => { console.error(`histórico publicado (tentativa ${i + 1}): ${e.message}`); return null; });
}
if (!antes && process.env.INICIAR !== "1") {
  console.error("Histórico publicado inacessível: não gravo nem publico nesta rodada (evita apagar o histórico).");
  process.exit(1);
}
const saida = { em: null, jogos: antes?.jogos || {} };
const agora = Math.floor(Date.now() / 1000);

const eventos = [];
// ESPN fora do ar não trava a publicação: sem jogos lidos, o histórico é regravado como estava
for (const d of datasNba()) eventos.push(...((await getJson(`${ESPN}/scoreboard?dates=${d}`).catch((e) => { console.error(`scoreboard ${d}: ${e.message}`); return null; }))?.events || []));
let gravadas = 0, falhas = 0;
for (const ev of eventos) {
  if (ev.status?.type?.state === "post") continue; // encerrado: o histórico fica até sair pela idade
  const dk = await buscarDk(getJson, ev.id).catch((e) => { falhas++; console.error(ev.shortName, e.message); return null; });
  if (!dk) continue;
  const series = { ...dk.props };
  for (const [k, r] of Object.entries(dk.jogo)) series[k] = { linha: r.linha, linhaAb: r.linhaAb, over: r.a, under: r.b, overAb: r.aAb, underAb: r.bAb };
  const jogo = (saida.jogos[ev.id] ||= { inicio: Date.parse(ev.date), h: {} });
  jogo.inicio = Date.parse(ev.date);
  for (const [k, r] of Object.entries(series)) {
    const H = (jogo.h[k] ||= []);
    if (!H.length && (r.linhaAb != null || r.overAb != null)) H.push([null, r.linhaAb ?? null, r.overAb ?? null, r.underAb ?? null]);
    const ult = H[H.length - 1], novo = [agora, r.linha ?? null, r.over ?? null, r.under ?? null];
    if (!ult || ult[0] == null || ult[1] !== novo[1] || ult[2] !== novo[2] || ult[3] !== novo[3]) { H.push(novo); gravadas++; }
  }
}
for (const [id, j] of Object.entries(saida.jogos)) if (Date.now() - j.inicio > 30 * 3600e3) delete saida.jogos[id];
saida.em = agora;
await writeFile(new URL("data/linhas_dk.json", raiz), JSON.stringify(saida));
console.log(`${Object.keys(saida.jogos).length} jogos no histórico · ${gravadas} pontos novos · ${falhas} falhas`);
if (falhas && falhas === eventos.length) console.error("nenhum jogo lido da DraftKings nesta rodada (histórico regravado como estava)");
