// Cards de STEAM no quadro principal: a odd de um lado caiu forte na última 1-2 h antes do jogo
// (mesma regra do Worker: avaliarSteam em core.js). A página procura, a cada minuto, os jogos que
// começam nos próximos 12 min com mercado >= $100 mil; o card vale até o início do jogo.
import { avaliarSteam, STEAM, odd, cents, custoCopia, descreverAposta, linkMercado, esporte, rotuloEsporte, rotuloTipo } from "./core.js";

const INTERVALO = 60_000;
const $ = (s) => document.querySelector(s);

export function iniciarSteam({ api, getCfg, esc, usd, prefixos, aoRenderizar }) {
  let sinais = [], timer = null;
  const vistos = new Map(); // cond -> {hist, em} (evita repetir consulta no mesmo minuto)

  async function tick() {
    clearTimeout(timer);
    const agora = Date.now();
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const evs = (await api().get("gamma", `/events?closed=false&active=true&start_time_min=${iso(agora)}&start_time_max=${iso(agora + 12 * 60e3)}&limit=50`)) || [];
      const novos = [];
      for (const ev of evs) {
        const ms = (ev.markets || []).filter((m) => m.active && !m.closed && m.clobTokenIds && +(m.volumeNum || 0) >= STEAM.volMin);
        const sel = ms.filter((m) => m.sportsMarketType === "moneyline");
        for (const tp of ["spreads", "totals"]) {
          const c = ms.filter((m) => m.sportsMarketType === tp).sort((a, b) => +b.volumeNum - +a.volumeNum)[0];
          if (c) sel.push(c);
        }
        for (const m of sel) {
          const ini = Date.parse(m.gameStartTime || ev.startTime) / 1000;
          if (!(ini * 1000 > agora)) continue;
          const tok = JSON.parse(m.clobTokenIds);
          let v = vistos.get(m.conditionId);
          if (!v || agora - v.em > 55_000) {
            const h = await api().get("clob", `/prices-history?market=${tok[0]}&startTs=${Math.floor(ini - 130 * 60)}&endTs=${Math.floor(agora / 1000)}&fidelity=1`).catch(() => null);
            v = { hist: (h?.history || []).sort((a, b) => a.t - b.t), em: agora };
            vistos.set(m.conditionId, v);
          }
          const sig = avaliarSteam(v.hist, ini, Math.floor(agora / 1000));
          if (!sig) continue;
          const outcomes = JSON.parse(m.outcomes || '["Yes","No"]');
          const book = await api().get("clob", `/book?token_id=${tok[sig.lado]}`).catch(() => null);
          const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
          const teto = Math.min(sig.preco + 0.015, 0.97);
          novos.push({
            ...sig, cond: m.conditionId, slug: m.slug, eventSlug: ev.slug, tituloEvento: ev.title, pergunta: m.question,
            lado: outcomes[sig.lado], aposta: descreverAposta(m.question, outcomes[sig.lado]), tipo: m.sportsMarketType,
            esporte: esporte(ev.slug, ev, prefixos), inicio: ini * 1000, vol: +m.volumeNum, teto,
            ask: asks[0]?.p ?? null, liquidez: asks.filter((a) => a.p <= teto).reduce((s, a) => s + a.p * a.q, 0),
          });
        }
      }
      sinais = novos;
      for (const [c, v] of vistos) if (agora - v.em > 30 * 60e3) vistos.delete(c);
    } catch { /* tenta de novo no próximo minuto */ }
    render();
    timer = setTimeout(tick, INTERVALO);
  }

  function render() {
    const cfg = getCfg();
    const stake = (cfg.banca * cfg.pct) / 100;
    const agora = Date.now();
    const ativos = sinais.filter((s) => s.inicio > agora);
    aoRenderizar?.({ n: ativos.length, copiar: 0 }); // em observação: não conta como entrada recomendada
    const pct = (v) => (v == null ? "–" : `${v <= 0 ? "−" : "+"}${Math.abs(100 * v).toFixed(0)}%`);
    const antes = (s, v) => (v == null ? "–" : odd(s.preco * (1 + v))); // odd antes = odd agora / (1 + variação)
    const min = (ms) => Math.max(0, Math.round((ms - agora) / 60e3));
    $("#steam-lista").innerHTML = ativos.map((s) => {
      const ok = s.ask != null && s.ask <= s.teto;
      return `<article class="card steam ${s.forca}">
        <div class="card-top"><span class="momento steam">Steam</span><span class="st ESPERAR">Observar</span>
          <span class="quem">👀 em observação · ${esc(rotuloEsporte(s.esporte))}${s.tipo ? " · " + esc(rotuloTipo(s.tipo)) : ""}</span></div>
        <div><div class="evento">${esc(s.tituloEvento)}</div><div class="lado">${esc(s.aposta)}</div>
          <div class="pergunta">Mercado: ${esc(s.pergunta)} · lado <b>${esc(s.lado)}</b></div></div>
        <div class="kv">
          <div><small>Odd 2 h antes</small><b>${antes(s, s.var120)}</b><em class="tam">${pct(s.var120)}</em></div>
          <div><small>Odd 1 h antes</small><b>${antes(s, s.var60)}</b><em class="tam">${pct(s.var60)}</em></div>
          <div><small>Odd agora</small><b>${s.ask != null ? odd(s.ask) : odd(s.preco)}</b></div>
          <div><small>Começa</small><b>em ${min(s.inicio)} min</b></div>
          <div><small>Volume do mercado</small><b>${usd(s.vol)}</b></div>
          <div><small>Livre até a mínima</small><b>${usd(s.liquidez)}</b></div>
        </div>
        <div class="ordem">Se for testar, valor pequeno. ${ok ? "Entrar" : "Deixe ordem limitada"}: <b>${esc(s.aposta)}</b> com odd mínima <b>${odd(s.teto)}</b>,
          aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / custoCopia(s.teto))}</b> se ganhar (já descontada a taxa). Segure até o fim.
          <span class="preco-ref">No Polymarket: ordem limitada a ${cents(s.teto)}</span>
          ${s.liquidez < stake ? `<span class="alerta">Só ${usd(s.liquidez)} à venda até a mínima: a ordem pode ser preenchida em parte.</span>` : ""}</div>
        <div class="card-foot"><span>Odd caiu ≥ 7% na última 1–2 h, mercado ≥ $100 mil, odd 1,50–2,00. Revalidado com todos os jogos de 90 dias: +2% a +5%, sem prova de vantagem. Em observação.</span>
          <a href="${linkMercado(s)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
      </article>`;
    }).join("");
  }

  tick();
  setInterval(render, 30_000); // contagem "começa em"
}
