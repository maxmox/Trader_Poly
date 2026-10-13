// relay/cloudflare-worker.js — Cloudflare Worker que repassa a API pública do Polymarket.
// =============================================================================
// Para que serve: o DNS de vários provedores brasileiros bloqueia os domínios do
// Polymarket, então o navegador não consegue buscar os dados em tempo real. O
// Worker roda na Cloudflare (fora do bloqueio) e devolve as respostas ao site.
// Sem o relay o site ainda funciona, com o retrato que a GitHub Action gera a
// cada ~10 min.
//
// DEPLOY (grátis):
//   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker → Deploy
//   2. Edit code → apague tudo → cole este arquivo → Deploy
//   3. Copie a URL (ex.: https://poly-relay.SEU-USUARIO.workers.dev)
//   4. No site, abra "Ajustes" e cole a URL no campo Relay
//
// Só repassa GET para os três hosts públicos de leitura. Nada de chave, nada de ordens.

const HOSTS = {
  data: "https://data-api.polymarket.com",
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return new Response('{"erro":"use GET"}', { status: 405, headers: CORS });
    const url = new URL(request.url);
    const [, host, ...resto] = url.pathname.split("/");
    if (!HOSTS[host]) return new Response('{"erro":"use /data, /gamma ou /clob"}', { status: 404, headers: CORS });
    const destino = `${HOSTS[host]}/${resto.join("/")}${url.search}`;
    try {
      const r = await fetch(destino, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ erro: "falha ao alcançar o Polymarket: " + e.message }), { status: 502, headers: CORS });
    }
  },
};
