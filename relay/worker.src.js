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
//    GET /registro -> todos os sinais enviados (últimos 90 dias) com o resultado, para o placar
//
// REGISTRO: cada sinal enviado vira uma chave "r:..." no KV, com os dados nos metadados
// (assim uma única listagem traz tudo). A cada 10 min o Worker confere o resultado dos
// sinais cujo jogo já acabou (até 8 por vez).
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
  return `\nAposta: <b>${usd(v)}</b> → retorno <b>${usd(v / custoCopia(teto))}</b> se ganhar (com a taxa)`;
}

function linhaNota(n) {
  if (!n) return "";
  const ic = { forte: "🟢", boa: "🔵", neutra: "⚪", fraca: "🔴" }[n.rotulo];
  return `\n${ic} Nota <b>${n.nota}</b> (${n.rotulo}) · trader ${n.trader} · mercado ${n.mercado} · odd/tempo ${n.odd}`;
}

// o quanto ele apostou pesa tanto quanto a odd: $1 de um profissional é só marcação
function linhaTamanho(x) {
  const tm = x.tamanho;
  if (!tm) return x.valorDele ? `\n💵 Ele apostou <b>${usd(x.valorDele)}</b>` : "";
  const ic = { grande: "💰", normal: "💵", pequena: "⚠️", simbolica: "⛔", "sem-ref": "💵" }[tm.classe];
  return `\n${ic} Ele apostou <b>${h(tm.texto)}</b> · ${h(tm.rotulo)}`;
}

// trader que vende antes do fim: avisa no sinal de entrada como ele costuma sair
const seguraMelhor = (sd) => sd?.roi_segurando != null && sd?.roi_saida != null && sd.roi_segurando >= sd.roi_saida + 2;
function linhaSaida(t, x) {
  const sd = t.saida;
  if (!sd) return "";
  const alvo = sd.lucro_c ? Math.min(0.99, x.precoDele + sd.lucro_c / 100) : null;
  return `\n🚪 Ele vende antes do fim em ${sd.pct_sai}% das apostas${sd.min_med ? ` (em ~${sd.min_med} min)` : ""}.`
    + (alvo ? ` Realiza lucro perto de odd ${odd(alvo)}.` : "")
    + (seguraMelhor(sd) ? " Segurar até o fim rendeu mais; o alerta SAIR é informativo." : " <b>Fique atento ao alerta SAIR.</b>");
}

function msgVivo(env, t, s) {
  const fim = s.entrouEm + t.janelaSeg * 1000;
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🔴 <b>AO VIVO · ${h(t.nome)}</b> (${h(rotuloEsporte(s.esporte))}${s.tipo ? " · " + h(rotuloTipo(s.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(s.tituloEvento)}${s.placar ? ` · ${h(s.placar)}` : ""}
Entrar: <b>${h(s.aposta || s.lado)}</b>${s.pergunta && s.pergunta !== s.tituloEvento ? `
Mercado: ${h(s.pergunta)} · lado ${h(s.lado)}` : ""}
Odd dele ${odd(s.precoDele)} · agora ${odd(s.ask)} · <b>mínima ${odd(s.teto)}</b>${linhaTamanho(s)}${linhaNota(s.nota)}${linhaSaida(t, s)}${t.nivel === "teste" ? `
Veredito: <b>${s.status === "COPIAR" ? "copiar" : "não copiar"}</b> — ${h(s.motivos.join("; "))}` : ""}
⏱ Vale até <b>${horaBR(fim)}</b> (janela de ${Math.round(t.janelaSeg / 60)} min)
Entrou às ${horaBR(s.entrouEm)} · detectado às ${horaBR(Date.now())}${aposta(env, s.teto)}
No Polymarket: ordem limitada a ${cents(s.teto)} · ${t.saida && !seguraMelhor(t.saida) ? "saia junto com ele" : "segure até o fim"}
${linkMercado(s)}`;
}

function msgPre(env, t, p) {
  return `${t.nivel === "teste" ? "🧪 <b>TESTE</b> (não é recomendação) · " : ""}🟢 <b>PRÉ-JOGO · ${h(t.nome)}</b> (${h(rotuloEsporte(p.esporte))}${p.tipo ? " · " + h(rotuloTipo(p.tipo)) : ""})${t.nivel === "observar" ? " · em observação" : ""}
${h(p.tituloEvento)} · começa ${p.inicio ? dataBR(p.inicio) : "?"}
Entrar: <b>${h(p.aposta || p.lado)}</b>${p.pergunta && p.pergunta !== p.tituloEvento ? `
Mercado: ${h(p.pergunta)} · lado ${h(p.lado)}` : ""}
Odd dele ${odd(p.precoDele)} · agora ${odd(p.ask)} · <b>mínima ${odd(p.teto)}</b>${linhaTamanho(p)}${linhaNota(p.nota)}${linhaSaida(t, p)}${t.props ? `
⚠️ Prop de jogador: mercado raso. Ordem limitada (sem taxa) e no máximo <b>${usd(t.props.max_usd)}</b>. Livre até o teto agora: ${usd(p.liquidez || 0)}` : ""}${aposta(env, p.teto)}
Detectado às ${horaBR(Date.now())}${p.entrouEm ? ` · ele entrou às ${horaBR(p.entrouEm)}` : ""}
No Polymarket: ordem limitada a ${cents(p.teto)} · ${t.saida && !seguraMelhor(t.saida) ? "saia junto com ele" : "segure até o fim"}
${linkMercado(p)}`;
}

// ---------- registro dos sinais enviados ----------
const corta = (v, n) => String(v ?? "").slice(0, n);
async function registrarSinal(env, t, x, tipo) {
  if (!env.ENVIADOS || t.nivel === "teste") return;
  const md = {
    w: t.carteira, n: corta(t.nome, 30), m: tipo, e: corta(x.tituloEvento, 70), l: corta(x.aposta || x.lado, 60), s: corta(x.slug, 90),
    ev: corta(x.eventSlug, 90), oi: x.oi, p: +x.precoDele.toFixed(4), a: x.ask == null ? null : +x.ask.toFixed(4), mi: +x.teto.toFixed(4),
    nt: x.nota?.nota ?? null, rt: x.nota?.rotulo ?? null, sp: corta(x.esporte, 20), tp: corta(x.tipo, 20),
    u: x.valorDele == null ? null : Math.round(x.valorDele), tc: x.tamanho?.classe ?? null,
    t: x.entrouEm || Date.now(), i: x.inicio || null, env: Date.now(), r: null,
  };
  const chave = `r:${Date.now()}:${corta(x.asset, 12)}`;
  await env.ENVIADOS.put(chave, "", { metadata: md, expirationTtl: 90 * 86400 });
  cacheRegistro = null; // a próxima leitura busca de novo
  return chave;
}

// ---------- saída: o trader vendeu um lado que virou sinal ----------
// Ao enviar um sinal, guarda "s:<ativo>" (3 dias). Quando ele vende esse lado, manda "SAIR"
// uma vez por venda e anota a saída no registro (o placar passa a contar o ROI com a saída).
async function lembrarSinal(env, t, x, chaveRegistro) {
  if (!env.ENVIADOS) return;
  await env.ENVIADOS.put(`s:${x.asset}`, chaveRegistro || "", {
    metadata: { n: corta(t.nome, 30), l: corta(x.aposta || x.lado, 60), p: +x.precoDele.toFixed(4), e: corta(x.tituloEvento, 70) },
    expirationTtl: 3 * 86400,
  });
}

function msgSaida(t, v, s) {
  const dif = v.preco - s.p;
  const pct = v.frac == null ? "parte" : v.frac >= 0.95 ? "tudo" : `~${Math.round(100 * v.frac)}%`;
  return `🚪 <b>SAIR · ${h(t.nome)}</b>
${h(s.e)}
Ele vendeu <b>${pct}</b> de: <b>${h(s.l)}</b>
Odd de entrada ${odd(s.p)} → saiu a ${odd(v.preco)} (${dif >= 0 ? "+" : "−"}${Math.abs(Math.round(100 * dif))}¢, ${dif >= 0 ? "lucro" : "perda"}) às ${horaBR(v.t * 1000)}
Faça o mesmo: venda <b>${pct === "tudo" ? "toda a sua posição" : pct + " da sua posição"}</b> · ordem limitada a ~${cents(Math.max(0.01, v.preco - 0.01))}
${linkMercado(v)}`;
}

async function avisarSaidas(env, t, vendas, resumo) {
  if (!env.ENVIADOS || !vendas?.length) return;
  for (const v of vendas) {
    const s = await env.ENVIADOS.getWithMetadata(`s:${v.asset}`);
    if (s.value === null || !s.metadata) continue; // esse lado nunca virou sinal
    const chave = `x:${v.asset}:${v.t}`;
    if (await jaEnviado(env, chave)) continue;
    const r = await telegram(env, msgSaida(t, v, s.metadata));
    if (!r.ok) { resumo.erros.push(`telegram: ${r.erro}`); continue; }
    resumo.saidas = (resumo.saidas || 0) + 1;
    await marcar(env, chave, 3 * 86400);
    if (s.value) { // anota no registro: [preço, fração] de cada saída
      const reg = await env.ENVIADOS.getWithMetadata(s.value);
      if (reg.metadata) {
        const sx = [...(reg.metadata.sx || []), [+v.preco.toFixed(4), v.frac == null ? 1 : +v.frac.toFixed(3)]].slice(-4);
        await env.ENVIADOS.put(s.value, "", { metadata: { ...reg.metadata, sx }, expirationTtl: 90 * 86400 });
        cacheRegistro = null;
      }
    }
  }
}

let cacheRegistro = null, cacheRegistroEm = 0;
async function listarRegistro(env, fresco = false) {
  if (!env.ENVIADOS) return [];
  if (!fresco && cacheRegistro && Date.now() - cacheRegistroEm < 120_000) return cacheRegistro;
  const out = [];
  let cursor;
  do {
    const r = await env.ENVIADOS.list({ prefix: "r:", cursor });
    for (const k of r.keys) out.push({ chave: k.name, ...(k.metadata || {}) });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  cacheRegistro = out; cacheRegistroEm = Date.now();
  return out;
}

// confere o resultado dos sinais cujo jogo já deve ter acabado
async function resolverRegistro(env, api) {
  const agora = Date.now();
  const pend = (await listarRegistro(env, true))
    .filter((x) => x.r == null && (x.i ? agora > x.i + 2 * 3600e3 : agora > x.env + 6 * 3600e3))
    .slice(0, 8);
  let resolvidos = 0;
  for (const x of pend) {
    const ev = (await api.get("gamma", `/events?slug=${encodeURIComponent(x.ev)}`).catch(() => null))?.[0];
    const r = resultadoMercado(ev, x.s, x.oi);
    if (r == null) continue;
    const { chave, ...md } = x;
    await env.ENVIADOS.put(chave, "", { metadata: { ...md, r }, expirationTtl: 90 * 86400 });
    resolvidos++;
  }
  if (resolvidos) cacheRegistro = null;
  return resolvidos;
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

// ---------- STEAM: odd caiu forte na última 1-2 h antes do jogo ----------
// A cada minuto: jogos que começam em ~9-11 min; mercados de vencedor + handicap/total de maior volume com
// volume >= $100 mil; histórico de preço (1 consulta por mercado) e, se bater a regra, o livro (1 consulta).
// Cada mercado é avaliado uma vez (KV "sv:"). Sinais vão para o registro como trader "steam".
const STEAM_TRADER = { carteira: "steam", nome: "Steam (movimento de odd)", nivel: "steam" };
function msgSteam(x) {
  const pct = (v) => (v == null ? "–" : `${v <= 0 ? "−" : "+"}${Math.abs(100 * v).toFixed(0)}%`);
  return `👀 <b>STEAM (observar)</b> · ${h(x.esporte)} · começa ${horaBR(x.inicio)}
${h(x.tituloEvento)}
Entrar: <b>${h(x.aposta)}</b>
Mercado: ${h(x.pergunta)} · lado ${h(x.lado)}
A odd caiu ${pct(x.var120)} desde 2 h antes e ${pct(x.var60)} desde 1 h antes · agora ${odd(x.precoDele)}
<b>Odd mínima ${odd(x.teto)}</b>${x.ask != null ? ` · melhor oferta ${odd(x.ask)}` : ""} · livre até a mínima ~${usd(x.liquidez || 0)}
Volume do mercado ${usd(x.vol)} · segure até o fim
Em observação: revalidado com todos os jogos de 90 dias, +2% a +5% (não descarta sorte). Se entrar, valor pequeno.
${linkMercado(x)}`;
}

async function verificarSteam(env, api, prefixos, resumo, maxMercados = 8) {
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  const evs = await api.get("gamma", `/events?closed=false&active=true&start_time_min=${iso(agora + 9 * 60e3)}&start_time_max=${iso(agora + 11 * 60e3)}&limit=50`).catch(() => null) || [];
  const mercados = [];
  for (const ev of evs) {
    const ms = (ev.markets || []).filter((m) => m.active && !m.closed && m.clobTokenIds && +(m.volumeNum || 0) >= STEAM.volMin);
    const sel = ms.filter((m) => m.sportsMarketType === "moneyline");
    for (const tp of ["spreads", "totals"]) {
      const c = ms.filter((m) => m.sportsMarketType === tp).sort((a, b) => +b.volumeNum - +a.volumeNum)[0];
      if (c) sel.push(c);
    }
    for (const m of sel) mercados.push({ ev, m });
  }
  resumo.steam = { jogos: evs.length, mercados: mercados.length, sinais: 0 };
  let n = 0;
  for (const { ev, m } of mercados) {
    if (n >= maxMercados) break;
    const chave = `sv:${m.conditionId}`;
    if (await jaEnviado(env, chave)) continue;
    n++;
    await marcar(env, chave, 3 * 3600);
    const ini = Date.parse(m.gameStartTime || ev.startTime) / 1000;
    const tok = JSON.parse(m.clobTokenIds);
    const hp = await api.get("clob", `/prices-history?market=${tok[0]}&startTs=${Math.floor(ini - 130 * 60)}&endTs=${Math.floor(agora / 1000)}&fidelity=1`).catch(() => null);
    const hist = (hp?.history || []).sort((a, b) => a.t - b.t);
    const sig = avaliarSteam(hist, ini, Math.floor(agora / 1000));
    if (!sig) continue;
    const outcomes = JSON.parse(m.outcomes || '["Yes","No"]');
    const book = await api.get("clob", `/book?token_id=${tok[sig.lado]}`).catch(() => null);
    const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
    const teto = Math.min(sig.preco + 0.015, 0.97);
    const x = {
      ...sig, asset: tok[sig.lado], cond: m.conditionId, oi: sig.lado, slug: m.slug, eventSlug: ev.slug, tituloEvento: ev.title,
      pergunta: m.question, lado: outcomes[sig.lado], aposta: descreverAposta(m.question, outcomes[sig.lado]), esporte: rotuloEsporte(esporte(ev.slug, ev, prefixos)),
      inicio: ini * 1000, entrouEm: agora, precoDele: sig.preco, ask: asks[0]?.p ?? null, teto, vol: +m.volumeNum,
      liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0), tipo: m.sportsMarketType,
    };
    const r = await telegram(env, msgSteam(x));
    if (!r.ok) { resumo.erros.push(`telegram: ${r.erro}`); continue; }
    resumo.enviados++; resumo.steam.sinais++;
    x.nota = { nota: null, rotulo: x.forca };
    await registrarSinal(env, STEAM_TRADER, x, "s");
  }
}

// ---------- FUTEBOL AO VIVO, CONTRA O MOVIMENTO ----------
// A cada minuto: jogos de futebol que começaram há 10-12 min, volume >= $200 mil; histórico dos 3
// mercados de vencedor (3 consultas). Se ainda 0 a 0 e a odd de um time caiu >= 5%, manda "comprar NÃO
// vence" nesse time. Cada jogo é avaliado uma vez (KV "lv:"). No máximo 4 jogos por execução.
const CONTRA_TRADER = { carteira: "contra-fut", nome: "Futebol ao vivo: contra o movimento", nivel: "contra" };
function msgContra(x) {
  const ic = x.forca === "forte" ? "🟢" : "🟡";
  return `${ic} <b>AO VIVO · CONTRA O MOVIMENTO ${x.forca === "forte" ? "(forte)" : "(moderado)"}</b> · ${h(x.liga)}
${h(x.tituloEvento)} · 0 a 0 aos ~${x.minuto} min
A odd de ${h(x.time)} caiu de ${odd(x.p0)} para ${odd(x.pN)} (−${Math.abs(100 * x.var).toFixed(0)}%) sem gol: no histórico, exagero
Entrar: <b>${h(x.aposta)}</b>
Mercado: ${h(x.pergunta)} · lado <b>No</b>
Odd agora ${x.ask != null ? odd(x.ask) : odd(x.precoDele)} · <b>mínima ${odd(x.teto)}</b> · livre até a mínima ~${usd(x.liquidez || 0)}${x.ask != null && x.ask > x.teto ? "\n⚠️ A melhor oferta já está abaixo da odd mínima: deixe ordem limitada na mínima e não persiga." : ""}
Volume do jogo ${usd(x.vol)} · segure até o fim
${x.forca === "forte" ? "Histórico (90 dias, preço real): +11% nesta regra." : "Regra moderada: histórico ~+5%, ainda em teste."}
${linkMercado(x)}`;
}

async function verificarContraFut(env, api, resumo, maxJogos = 4) {
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  const evs = (await api.get("gamma", `/events?tag_slug=soccer&closed=false&active=true&start_time_min=${iso(agora - CONTRA_FUT.janelaMin * 60e3)}&start_time_max=${iso(agora - CONTRA_FUT.entradaMin * 60e3)}&limit=50`).catch(() => null) || [])
    .filter((e) => +(e.volume || 0) >= CONTRA_FUT.volMin).sort((a, b) => +b.volume - +a.volume);
  resumo.contraFut = { jogos: evs.length, sinais: 0 };
  let n = 0;
  for (const ev of evs) {
    if (n >= maxJogos) break;
    const ms = (ev.markets || []).filter((m) => m.sportsMarketType === "moneyline" && m.clobTokenIds);
    if (ms.length !== 3) continue;
    const chave = `lv:${ev.slug}`;
    if (await jaEnviado(env, chave)) continue;
    n++;
    await marcar(env, chave, 3 * 3600);
    const ini = Date.parse(ms[0].gameStartTime || ev.startTime) / 1000;
    const series = [];
    for (const m of ms) {
      const tok = JSON.parse(m.clobTokenIds);
      const hp = await api.get("clob", `/prices-history?market=${tok[0]}&startTs=${Math.floor(ini - 600)}&endTs=${Math.floor(agora / 1000)}&fidelity=1`).catch(() => null);
      series.push({ hist: (hp?.history || []).sort((a, b) => a.t - b.t), empate: /draw/i.test(m.question || ""), m, tok });
    }
    const sig = avaliarContraFut(series, ini, Math.floor(agora / 1000));
    if (!sig) continue;
    const { m, tok } = series[sig.mercado];
    const book = await api.get("clob", `/book?token_id=${tok[1]}`).catch(() => null);
    const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
    const teto = Math.min(sig.precoNao + 0.015, 0.97);
    const time = (m.question || "").replace(/^Will\s+/i, "").replace(/\s+win.*$/i, "");
    const x = {
      ...sig, asset: tok[1], cond: m.conditionId, oi: 1, slug: m.slug, eventSlug: ev.slug, tituloEvento: ev.title, pergunta: m.question,
      lado: "No", time, aposta: descreverAposta(m.question, "No"), esporte: "Futebol", liga: ev.slug.split("-")[0].toUpperCase(),
      minuto: Math.round((agora / 1000 - ini) / 60), inicio: ini * 1000, entrouEm: agora, precoDele: sig.precoNao, teto,
      ask: asks[0]?.p ?? null, liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0), vol: +ev.volume, tipo: "moneyline",
    };
    const r = await telegram(env, msgContra(x));
    if (!r.ok) { resumo.erros.push(`telegram: ${r.erro}`); continue; }
    resumo.enviados++; resumo.contraFut.sinais++;
    x.nota = { nota: null, rotulo: x.forca };
    await registrarSinal(env, CONTRA_TRADER, x, "c");
  }
}

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
  const rv = await carregarAoVivo(api, vivo, { prefixos, limiteAtividade: 30, historicoSeg: +(env.VIVO_HISTORICO_SEG || 300), soCopiaveis: true, indices: l.indices });
  for (const [k, d] of rv.traders.entries()) {
    const t = vivo[k];
    if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
    for (const s of d.sinais) {
      resumo.aoVivo.push({ trader: t.nome, evento: s.tituloEvento, aposta: s.aposta, status: s.status, motivos: s.motivos });
      // trader de teste manda toda entrada nova (com o veredito), para conferir o fluxo
      if (s.status !== "COPIAR" && t.nivel !== "teste") continue;
      const chave = `v:${s.asset}:${s.entrouEm}`;
      s.nota = notaEntrada(s, t, l.indices);
      if (await jaEnviado(env, chave)) continue;
      const r = await telegram(env, msgVivo(env, t, s));
      if (r.ok) { resumo.enviados++; await marcar(env, chave, 6 * 3600); await lembrarSinal(env, t, s, await registrarSinal(env, t, s, "v")); } else resumo.erros.push(`telegram: ${r.erro}`);
    }
    if (t.nivel !== "teste") await avisarSaidas(env, t, d.vendas, resumo);
  }

  // futebol ao vivo, contra o movimento (jogos que começaram há 10-12 min)
  if (env.CONTRA_FUT !== "0") {
    try { await verificarContraFut(env, api, resumo); } catch (e) { resumo.erros.push(`contra-fut: ${e.message || e}`); }
  }

  // steam antes do rodízio do pré-jogo (poucas consultas: jogos começando em ~10 min)
  if (STEAM.ativo && env.STEAM !== "0") {
    try { await verificarSteam(env, api, prefixos, resumo); } catch (e) { resumo.erros.push(`steam: ${e.message || e}`); }
  }

  // pré-jogo: um trader por execução, em rodízio (cada um é visto a cada ~10 min);
  // trader de teste entra em toda execução, limitado a 8 posições
  const normais = pre.filter((t) => t.nivel !== "teste");
  const lista = preTrader
    ? pre.filter((t) => t.nome === preTrader || t.carteira === preTrader)
    : [...pre.filter((t) => t.nivel === "teste"), ...(normais.length ? [normais[minuto % normais.length]] : [])];
  resumo.preTrader = lista.map((t) => t.nome).join(", ");
  {
    const rp = await carregarTodos(api, lista, { prefixos, limiteAtividade: 20, soEspecialidade: true, maxPosicoes: 8, indices: l.indices });
    for (const [k, d] of rp.traders.entries()) {
      const t = lista[k];
      if (d.erro) resumo.erros.push(`${t.nome}: ${d.erro}`);
      for (const p of d.posicoes) {
        if (p.status !== "COPIAR") continue;
        resumo.preJogo.push({ trader: t.nome, evento: p.tituloEvento, aposta: p.aposta });
        const chave = `p:${p.asset}`;
        p.nota = notaEntrada(p, t, l.indices);
        if (await jaEnviado(env, chave)) continue;
        if (t.nivel === "teste" && resumo.enviados >= 3) continue; // teste: no máximo 3 por execução
        const r = await telegram(env, msgPre(env, t, p));
        const ttl = p.inicio ? (p.inicio - Date.now()) / 1000 + 3600 : 3 * 86400;
        if (r.ok) { resumo.enviados++; await marcar(env, chave, ttl); await lembrarSinal(env, t, p, await registrarSinal(env, t, p, "p")); } else resumo.erros.push(`telegram: ${r.erro}`);
      }
      if (t.nivel !== "teste") await avisarSaidas(env, t, d.vendas, resumo);
    }
  }
  if (minuto % 10 === 0) {
    try { resumo.resolvidos = await resolverRegistro(env, api); } catch (e) { resumo.erros.push(`registro: ${e.message || e}`); }
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
    if (url.pathname === "/teste-saida") { // mostra (sem enviar) como fica o alerta SAIR
      const v = { preco: 0.62, frac: 1, t: Date.now() / 1000, eventSlug: "exemplo", slug: "exemplo" };
      return new Response(msgSaida({ nome: "Trader" }, v, { e: "Time A vs Time B", l: "Time A vence", p: 0.55 }), { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/registro") {
      return json({ agora: Date.now(), sinais: await listarRegistro(env) });
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
