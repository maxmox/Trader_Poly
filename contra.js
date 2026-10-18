// Cards de FUTEBOL AO VIVO, CONTRA O MOVIMENTO no quadro principal (mesma regra do Worker:
// avaliarContraFut em core.js). A cada minuto, jogos de futebol (mercado do time >= $5 mil até agora) que começaram
// há 10-15 min; se ainda 0 a 0 e a odd de um time caiu >= 5%, o card manda comprar "NÃO vence" nele.
import { avaliarContraFut, CONTRA_FUT, odd, cents, custoCopia, descreverAposta, linkMercado } from "./core.js";

const $ = (s) => document.querySelector(s);

export function iniciarContraFut({ api, getCfg, esc, usd, aoRenderizar }) {
  let sinais = [];
  const cache = new Map(); // evento -> {sinal|null, em}

  async function tick() {
    const agora = Date.now();
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const evs = ((await api().get("gamma", `/events?tag_slug=soccer&closed=false&active=true&start_time_min=${iso(agora - 15 * 60e3)}&start_time_max=${iso(agora - CONTRA_FUT.entradaMin * 60e3)}&limit=50`)) || [])
        .filter((e) => +(e.volume || 0) >= CONTRA_FUT.volMin).sort((a, b) => +b.volume - +a.volume).slice(0, 12);
      const novos = [];
      for (const ev of evs) {
        const ms = (ev.markets || []).filter((m) => m.sportsMarketType === "moneyline" && m.clobTokenIds);
        if (ms.length !== 3) continue;
        let c = cache.get(ev.slug);
        if (!c) { // avalia uma vez, na 1ª vez que o jogo aparece na janela (como o backtest: aos ~10 min)
          const ini = Date.parse(ms[0].gameStartTime || ev.startTime) / 1000;
          const series = [];
          for (const m of ms) {
            const tok = JSON.parse(m.clobTokenIds);
            const h = await api().get("clob", `/prices-history?market=${tok[0]}&startTs=${Math.floor(ini - 600)}&endTs=${Math.floor(agora / 1000)}&fidelity=1`).catch(() => null);
            series.push({ hist: (h?.history || []).sort((a, b) => a.t - b.t), empate: /draw/i.test(m.question || ""), m, tok });
          }
          const sig = avaliarContraFut(series, ini, Math.floor(agora / 1000));
          c = { em: agora, sinal: sig && { ...sig, ini, m: series[sig.mercado].m, tok: series[sig.mercado].tok } };
          cache.set(ev.slug, c);
        }
        if (!c.sinal || +(c.sinal.m.volumeNum || 0) < CONTRA_FUT.volMin) continue;
        const s = c.sinal;
        const book = await api().get("clob", `/book?token_id=${s.tok[1]}`).catch(() => null);
        const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
        const teto = Math.min(s.precoNao + 0.015, 0.97);
        novos.push({
          ...s, ev, slug: s.m.slug, eventSlug: ev.slug, tituloEvento: ev.title, pergunta: s.m.question,
          aposta: descreverAposta(s.m.question, "No"), time: (s.m.question || "").replace(/^Will\s+/i, "").replace(/\s+win.*$/i, ""),
          vol: +s.m.volumeNum, teto, ask: asks[0]?.p ?? null, liquidez: asks.filter((a) => a.p <= teto).reduce((t, a) => t + a.p * a.q, 0),
        });
      }
      sinais = novos;
      for (const [k, v] of cache) if (agora - v.em > 3 * 3600e3) cache.delete(k);
    } catch { /* tenta de novo no próximo minuto */ }
    render();
    setTimeout(tick, 60_000);
  }

  function render() {
    const cfg = getCfg();
    const stake = (cfg.banca * cfg.pct) / 100;
    const agora = Date.now();
    const ativos = sinais.filter((s) => agora / 1000 - s.ini <= 15 * 60); // depois dos 15 min o efeito some
    aoRenderizar?.({ n: ativos.length, copiar: ativos.filter((s) => s.forca === "forte" && s.ask != null && s.ask <= s.teto).length });
    $("#contra-lista").innerHTML = ativos.map((s) => {
      const ok = s.ask != null && s.ask <= s.teto;
      const min = Math.round((agora / 1000 - s.ini) / 60);
      return `<article class="card contra ${s.forca}">
        <div class="card-top"><span class="momento vivo">Ao vivo</span><span class="momento contra">Contra o movimento</span><span class="st ${ok ? "COPIAR" : "ESPERAR"}">${ok ? "Entrar" : "Esperar"}</span>
          <span class="quem">${s.forca === "forte" ? "🟢 forte" : "🟡 moderado"} · Futebol · ${esc(s.ev.slug.split("-")[0].toUpperCase())}</span></div>
        <div><div class="evento">${esc(s.tituloEvento)} <span class="placar">0 a 0 · ${min}'</span></div><div class="lado">${esc(s.aposta)}</div>
          <div class="pergunta">Mercado: ${esc(s.pergunta)} · lado <b>No</b></div></div>
        <div class="kv">
          <div><small>Odd de ${esc(s.time)} no início</small><b>${odd(s.p0)}</b></div>
          <div><small>Odd de ${esc(s.time)} agora</small><b>${odd(s.pN)}</b><em class="tam">−${Math.abs(100 * s.var).toFixed(0)}%</em></div>
          <div><small>Odd do NÃO agora</small><b>${s.ask != null ? odd(s.ask) : odd(s.precoNao)}</b></div>
          <div><small>Volume do jogo</small><b>${usd(s.vol)}</b></div>
          <div><small>Livre até a mínima</small><b>${usd(s.liquidez)}</b></div>
        </div>
        <div class="ordem">${ok ? "Entrar" : "Deixe ordem limitada"}: <b>${esc(s.aposta)}</b> com odd mínima <b>${odd(s.teto)}</b>,
          aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / custoCopia(s.teto))}</b> se ganhar (já descontada a taxa). Segure até o fim.
          <span class="preco-ref">No Polymarket: lado "No" do mercado, ordem limitada a ${cents(s.teto)}</span>
          ${s.liquidez < stake ? `<span class="alerta">Só ${usd(s.liquidez)} à venda até a mínima: a ordem pode ser preenchida em parte.</span>` : ""}</div>
        <div class="card-foot"><span>${s.forca === "forte"
          ? "Odd de um time caiu ≥ 7% nos primeiros 10 min de um 0 a 0: no Polymarket isso foi exagero. Backtest 90 dias (preço real): +11%."
          : "Queda de 5–7%: backtest ~+5%, ainda em teste: valor menor."}</span>
          <a href="${linkMercado(s)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
      </article>`;
    }).join("");
  }

  tick();
  setInterval(render, 30_000);
}
