// ===== Worker: relay do site + alertas no Telegram =====
// (o arquivo publicado, relay/cloudflare-worker.js, é gerado por scripts/build-worker.mjs:
//  core.js + este arquivo num arquivo só, para colar no painel da Cloudflare)
//
// 1) RELAY: GET /data/..., /gamma/..., /clob/... repassam a API pública do Polymarket com CORS.
// 2) ALERTAS (Cron Trigger "* * * * *"):
//    - a cada minuto: entradas AO VIVO novas dos traders de data/traders_live.json
//    - a cada minuto, um trader de data/traders.json em rodízio: posições PRÉ-JOGO copiáveis
//    O plano grátis permite 50 consultas externas por execução; o contador ORCAMENTO
//    corta o trabalho antes disso.
//    Cada sinal vai uma vez só para o Telegram (memória no KV "ENVIADOS").
// 3) GET /teste  -> manda uma mensagem de teste no Telegram
//    GET /verificar -> roda a verificação agora e devolve o resumo em JSON
//    GET /status -> últimas execuções do agendamento (para ver se algum minuto foi pulado)
//
// Configuração no painel (Settings → Variables and Secrets):
//   TELEGRAM_TOKEN   (secret)  token do bot, do @BotFather
//   TELEGRAM_CHAT_ID (secret)  seu chat id
//   BANCA, PCT       (opcional) para sugerir o valor da aposta (ex.: 1000 e 1.5)
//   SITE_URL         (opcional) padrão https://maxmox.github.io/Trader_Poly
// KV: crie um namespace e ligue com o nome ENVIADOS (Settings → Bindings → KV).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const SITE_PADRAO = "https://maxmox.github.io/Trader_Poly";

let listas = null, listasEm = 0;
async function carregarListas(env) {
  if (listas && Date.now() - listasEm < 5 * 60_000) return listas;
  const base = (env.SITE_URL || SITE_PADRAO).replace(/\/$/, "");
  const get = async (p) => (await fetch(`${base}/${p}?t=${Date.now()}`, { cf: { cacheTtl: 0 } })).json();
  const [pre, vivo, prefixos, indices] = await Promise.all([get("data/traders.json"), get("data/traders_live.json"), get("data/prefixos.json"),
    get("data/indices.json").catch(() => null)]);
  listas = { pre: pre.traders, vivo: vivo.traders, prefixos, indices };
  listasEm = Date.now();
  return listas;
}

const memoria = new Map(); // fallback quando não há KV (dura enquanto a instância vive)
async function jaEnviado(env, chave) {
  if (env.ENVIADOS) return (await env.ENVIADOS.get(chave)) !== null;
  return memoria.has(chave);
}
async function marcar(env, chave, ttlSeg) {
  if (env.ENVIADOS) await env.ENVIADOS.put(chave, "1", { expirationTtl: Math.max(60, ttlSeg) });
  else memoria.set(chave, Date.now());
}

async function telegram(env, texto) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, erro: "TELEGRAM_TOKEN / TELEGRAM_CHAT_ID não configurados" };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: texto, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  return j.ok ? { ok: true } : { ok: false, erro: j.description || `HTTP ${r.status}` };
}

const h = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const usd = (v) => "$" + Math.round(v).toLocaleString("pt-BR");
const horaBR = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dataBR = (ms) => new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function aposta(env, teto) {
  const banca = parseFloat(env.BANCA || "0"), pct = parseFloat(env.PCT || "0");
  if (!banca || !pct) return "";
  const v = (banca * pct) / 100;
  return `\nAposta: <b>${usd(v)}</b> → retorno <b>${usd(v / teto)}</b> se ganhar`;
}

function linhaNota(n) {
  if (!n) return "";
  const ic = { forte: "🟢", boa: "🔵", neutra: "⚪", fraca: "🔴" }[n.rotulo];
  return `\n${ic} Nota <b>${n.nota}</b> (${n.rotulo}) · trader ${n.trader} · mercado ${n.mercado} · odd/tempo ${n.odd}`;
}

function msgVivo(env, t, s) {
  const fim = s.entrouEm + t.janelaSeg * 1000;
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🔴 <b>AO VIVO · ${h(t.nome)}</b> (${h(rotuloEsporte(s.esporte))}${s.tipo ? " · " + h(rotuloTipo(s.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(s.tituloEvento)}${s.placar ? ` · ${h(s.placar)}` : ""}
Entrar: <b>${h(s.lado)}</b>
Odd dele ${odd(s.precoDele)} · agora ${odd(s.ask)} · <b>mínima ${odd(s.teto)}</b>${linhaNota(s.nota)}${t.nivel === "teste" ? `
Veredito: <b>${s.status === "COPIAR" ? "copiar" : "não copiar"}</b> — ${h(s.motivos.join("; "))}` : ""}
⏱ Vale até <b>${horaBR(fim)}</b> (janela de ${Math.round(t.janelaSeg / 60)} min)
Entrou às ${horaBR(s.entrouEm)} · detectado às ${horaBR(Date.now())}${aposta(env, s.teto)}
No Polymarket: ordem limitada a ${cents(s.teto)} · segure até o fim
https://polymarket.com/event/${encodeURIComponent(s.eventSlug)}`;
}

function msgPre(env, t, p) {
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🟢 <b>PRÉ-JOGO · ${h(t.nome)}</b> (${h(rotuloEsporte(p.esporte))}${p.tipo ? " · " + h(rotuloTipo(p.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(p.tituloEvento)} · começa ${p.inicio ? dataBR(p.inicio) : "?"}
Entrar: <b>${h(p.lado)}</b>
Odd dele ${odd(p.precoDele)} · agora ${odd(p.ask)} · <b>mínima ${odd(p.teto)}</b>${linhaNota(p.nota)}${aposta(env, p.teto)}
Detectado às ${horaBR(Date.now())}${p.entrouEm ? ` · ele entrou às ${horaBR(p.entrouEm)}` : ""}
No Polymarket: ordem limitada a ${cents(p.teto)} · segure até o fim
https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}`;
}

const execucoes = []; // log em memória; vai para o KV a cada 5 min (limite grátis: 1.000 gravações/dia)
async function registrar(env, item, persistir) {
  execucoes.unshift(item);
  execucoes.length = Math.min(execucoes.length, 60);
  if (!persistir || !env.ENVIADOS) return;
  const antigo = JSON.parse((await env.ENVIADOS.get("status")) || "[]");
  const todos = [...execucoes, ...antigo].filter((x, i, a) => a.findIndex((y) => y.inicio === x.inicio) === i)
    .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 60);
  await env.ENVIADOS.put("status", JSON.stringify(todos));
}

const ORCAMENTO = 40; // consultas à API por execução (limite do plano grátis: 50, sobra para listas e Telegram)

async function verificar(env, { minuto = new Date().getUTCMinutes(), preTrader = null } = {}) {
  let usadas = 0;
  const fetchContado = (url, opts) => {
    if (++usadas > ORCAMENTO) return Promise.reject(new Error("orçamento de consultas desta execução esgotado"));
    return fetch(url, opts);
  };
  const l = await carregarListas(env);
  const pre = vigentes(l.pre), vivo = vigentes(l.vivo), prefixos = l.prefixos;
  const api = criarApi({ relay: env.RELAY_INTERNO || "", fetchFn: fetchContado });
  const resumo = { em: new Date().toISOString(), aoVivo: [], preJogo: [], preTrader: null, enviados: 0, consultas: 0, erros: [] };

  // pouca atividade por trader: entradas novas cabem nas últimas 30 e o plano grátis tem pouco CPU
  const rv = await carregarAoVivo(api, vivo, { prefixos, limiteAtividade: 30, historicoSeg: +(env.VIVO_HISTORICO_SEG || 300), soCopiaveis: true });
  for (const [k, d] of rv.traders.entries()) {
    const t = vivo[k];
    if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
    for (const s of d.sinais) {
      resumo.aoVivo.push({ trader: t.nome, evento: s.tituloEvento, lado: s.lado, status: s.status, motivos: s.motivos });
      // trader de teste manda toda entrada nova (com o veredito), para conferir o fluxo
      if (s.status !== "COPIAR" && t.nivel !== "teste") continue;
      const chave = `v:${s.asset}:${s.entrouEm}`;
      s.nota = notaEntrada(s, t, l.indices);
      if (await jaEnviado(env, chave)) continue;
      const r = await telegram(env, msgVivo(env, t, s));
      if (r.ok) { resumo.enviados++; await marcar(env, chave, 6 * 3600); } else resumo.erros.push(`telegram: ${r.erro}`);
    }
  }

  // pré-jogo: um trader por execução, em rodízio (cada um é visto a cada ~10 min);
  // trader de teste entra em toda execução, limitado a 8 posições
  const normais = pre.filter((t) => t.nivel !== "teste");
  const lista = preTrader
    ? pre.filter((t) => t.nome === preTrader || t.carteira === preTrader)
    : [...pre.filter((t) => t.nivel === "teste"), ...(normais.length ? [normais[minuto % normais.length]] : [])];
  resumo.preTrader = lista.map((t) => t.nome).join(", ");
  {
    const rp = await carregarTodos(api, lista, { prefixos, limiteAtividade: 20, soEspecialidade: true, maxPosicoes: 8 });
    for (const [k, d] of rp.traders.entries()) {
      const t = lista[k];
      if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
      for (const p of d.posicoes) {
        if (p.status !== "COPIAR") continue;
        resumo.preJogo.push({ trader: t.nome, evento: p.tituloEvento, lado: p.lado });
        const chave = `p:${p.asset}`;
        p.nota = notaEntrada(p, t, l.indices);
        if (await jaEnviado(env, chave)) continue;
        if (t.nivel === "teste" && resumo.enviados >= 3) continue; // teste: no máximo 3 por execução
        const r = await telegram(env, msgPre(env, t, p));
        const ttl = p.inicio ? (p.inicio - Date.now()) / 1000 + 3600 : 3 * 86400;
        if (r.ok) { resumo.enviados++; await marcar(env, chave, ttl); } else resumo.erros.push(`telegram: ${r.erro}`);
      }
    }
  }
  resumo.consultas = usadas;
  return resumo;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return new Response('{"erro":"use GET"}', { status: 405, headers: CORS });
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

    if (url.pathname === "/teste") {
      const r = await telegram(env, "✅ Trader Poly conectado. Os sinais ao vivo e pré-jogo vão chegar aqui.");
      return json(r, r.ok ? 200 : 500);
    }
    if (url.pathname === "/status") {
      const antigo = env.ENVIADOS ? JSON.parse((await env.ENVIADOS.get("status")) || "[]") : [];
      const todos = [...execucoes, ...antigo].filter((x, i, a) => a.findIndex((y) => y.inicio === x.inicio) === i)
        .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 60);
      const intervalos = todos.slice(0, -1).map((x, i) => Math.round((Date.parse(x.inicio) - Date.parse(todos[i + 1].inicio)) / 1000));
      return json({
        agora: new Date().toISOString(),
        ultima_execucao_ha_seg: todos[0] ? Math.round((Date.now() - Date.parse(todos[0].inicio)) / 1000) : null,
        intervalos_seg: intervalos, minutos_pulados: intervalos.filter((v) => v > 90).length, execucoes: todos,
        obs: "intervalos ~60 s = agendamento em dia; buracos maiores = minutos sem execução (o log vai para o KV a cada 5 min)",
      });
    }
    if (url.pathname === "/verificar") {
      // ?pre=NOME verifica o pré-jogo desse trader; sem isso, segue o rodízio do minuto
      try { return json(await verificar(env, { preTrader: url.searchParams.get("pre") })); } catch (e) { return json({ erro: String(e.message || e) }, 500); }
    }

    const [, host, ...resto] = url.pathname.split("/");
    if (!HOSTS[host]) return json({ erro: "use /data, /gamma, /clob, /teste ou /verificar" }, 404);
    try {
      const r = await fetch(`${HOSTS[host]}/${resto.join("/")}${url.search}`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
    } catch (e) {
      return json({ erro: "falha ao alcançar o Polymarket: " + e.message }, 502);
    }
  },

  async scheduled(event, env, ctx) {
    const minuto = Math.floor(event.scheduledTime / 60000);
    const t0 = Date.now();
    ctx.waitUntil(verificar(env, { minuto })
      .then((r) => ({ consultas: r.consultas, enviados: r.enviados, aoVivo: r.aoVivo.length, erros: r.erros.slice(0, 3) }))
      .catch((e) => ({ erro: String(e.message || e) }))
      .then((r) => registrar(env, { inicio: new Date(event.scheduledTime).toISOString(), ms: Date.now() - t0, ...r }, minuto % 5 === 0)));
  },
};
