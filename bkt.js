// Cards de BASQUETE AO VIVO, SEGUIR QUEM DISPAROU no quadro principal (mesma regra do Worker:
// avaliarSeguirBkt em core.js). A cada minuto, jogos de basquete fora da NBA/WNBA que estão nos 20-22 ou
// 30-32 min; com início confirmado e o preço de um time >= 5% acima do início, o card manda comprar esse time.
// Em observação: mercados rasos, valor pequeno.
import { avaliarSeguirBkt, SEGUIR_BKT, odd, cents, custoCopia, descreverAposta, linkMercado } from "./core.js";

const $ = (s) => document.querySelector(s);
const VALE_MIN = 10; // o card fica no quadro por até 10 min depois da checagem (o backtest entra até 5 min depois)

export function iniciarSeguirBkt({ api, getCfg, esc, usd, aoRenderizar }) {
  let sinais = [];
  const cache = new Map(); // "E|evento" -> {sinal|null, em}

  async function tick() {
    const agora = Date.now();
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    if (document.hidden) { setTimeout(tick, 60_000); return; } // aba em segundo plano: sem consultas
    try {
      const novos = [];
      for (const E of SEGUIR_BKT.checagens) {
        const evs = ((await api().get("gamma", `/events?tag_slug=basketball&closed=false&active=true&start_time_min=${iso(agora - (E + VALE_MIN) * 60e3)}&start_time_max=${iso(agora - E * 60e3)}&limit=50`)) || [])
          .filter((e) => !SEGUIR_BKT.fora.includes((e.slug || "").split("-")[0]));
        for (const ev of evs) {
          const m = (ev.markets || []).find((x) => x.sportsMarketType === "moneyline" && x.clobTokenIds && JSON.parse(x.outcomes || "[]").length === 2);
          if (!m) continue;
          const ini = Date.parse(m.gameStartTime || ev.startTime) / 1000;
          const chave = `${E}|${ev.slug}`;
          let c = cache.get(chave);
          // avalia uma vez, com o preço do minuto E (como o backtest), mesmo que a página tenha sido aberta depois
          if (!c && agora / 1000 - ini >= E * 60) {
            const tok = JSON.parse(m.clobTokenIds);
            const h = await api().get("clob", `/prices-history?market=${tok[0]}&startTs=${Math.floor(ini - 900)}&endTs=${Math.floor(agora / 1000)}&fidelity=1`).catch(() => null);
            const sig = avaliarSeguirBkt((h?.history || []).sort((a, b) => a.t - b.t), ini, Math.floor(ini + E * 60));
            c = { em: agora, sinal: sig && { ...sig, ini, E, m, tok, outcomes: JSON.parse(m.outcomes) } };
            cache.set(chave, c);
          }
          if (!c?.sinal) continue;
          if (novos.some((x) => x.ev.slug === ev.slug)) continue; // um card por jogo
          const s = c.sinal;
          const book = await api().get("clob", `/book?token_id=${s.tok[s.lado]}`).catch(() => null);
          const asks = (book?.asks || []).map((a) => ({ p: +a.price, q: +a.size })).sort((a, b) => a.p - b.p);
          const teto = Math.min(s.preco + 0.015, 0.97);
          const time = s.outcomes[s.lado];
          novos.push({
            ...s, ev, slug: s.m.slug, eventSlug: ev.slug, tituloEvento: ev.title, time, aposta: descreverAposta(s.m.question, time),
            liga: ev.slug.split("-")[0].replace(/^bk/, "").toUpperCase(), vol: +(s.m.volumeNum || 0), teto, ask: asks[0]?.p ?? null,
            liquidez: asks.filter((a) => a.p <= teto).reduce((t, a) => t + a.p * a.q, 0),
          });
        }
      }
      sinais = novos;
      for (const [k, v] of cache) if (agora - v.em > 3 * 3600e3) cache.delete(k);
    } catch (e) { console.warn("bkt", e); /* tenta de novo no próximo minuto */ }
    render();
    setTimeout(tick, 60_000);
  }

  function render() {
    const cfg = getCfg();
    const stake = (cfg.banca * cfg.pct) / 100;
    const agora = Date.now();
    const ativos = sinais.filter((s) => agora / 1000 - s.ini <= (s.E + VALE_MIN) * 60);
    // em observação: não conta como entrada recomendada no resumo do quadro
    aoRenderizar?.({ n: ativos.length, copiar: 0 });
    $("#bkt-lista").innerHTML = ativos.map((s) => {
      const ok = s.ask != null && s.ask <= s.teto;
      const min = Math.round((agora / 1000 - s.ini) / 60);
      return `<article class="card bkt ${s.forca}">
        <div class="card-top"><span class="momento vivo">Ao vivo</span><span class="momento bkt">Basquete: seguir</span><span class="st ESPERAR">Observar</span>
          <span class="quem">${s.forca === "forte" ? "🟢 forte" : "🟡 moderado"} · Basquete · ${esc(s.liga)}</span></div>
        <div><div class="evento">${esc(s.tituloEvento)} <span class="placar">~${min} min de jogo</span></div><div class="lado">${esc(s.aposta)}</div>
          <div class="pergunta">Mercado: ${esc(s.m.question)} · lado <b>${esc(s.time)}</b></div></div>
        <div class="kv">
          <div><small>Odd de ${esc(s.time)} no início</small><b>${odd(s.p0)}</b></div>
          <div><small>Odd na checagem (${s.E} min)</small><b>${odd(s.preco)}</b><em class="tam">−${Math.abs(100 * s.var).toFixed(0)}%</em></div>
          <div><small>Odd agora</small><b>${s.ask != null ? odd(s.ask) : "–"}</b></div>
          <div><small>Volume do mercado</small><b>${usd(s.vol)}</b></div>
          <div><small>Livre até a mínima</small><b>${usd(s.liquidez)}</b></div>
        </div>
        <div class="ordem">Se for testar, valor pequeno. ${ok ? "Entrar" : "Deixe ordem limitada"}: <b>${esc(s.aposta)}</b> com odd mínima <b>${odd(s.teto)}</b>,
          aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / custoCopia(s.teto))}</b> se ganhar (já descontada a taxa). Segure até o fim.
          <span class="preco-ref">No Polymarket: ordem limitada a ${cents(s.teto)}</span>
          ${s.liquidez < stake ? `<span class="alerta">Só ${usd(s.liquidez)} à venda até a mínima: mercado raso, a ordem pode ser preenchida em parte.</span>` : ""}</div>
        <div class="card-foot"><span>${s.forca === "forte"
          ? "Time disparou ≥ 10% até os 20–30 min, fora da NBA/WNBA: o preço demora a acompanhar. Backtest 90 dias (preço real, início confirmado): +20% a +27%."
          : "Disparou 5–10%: backtest +13% a +19%. Em observação."}</span>
          <a href="${linkMercado(s)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
      </article>`;
    }).join("");
  }

  tick();
  setInterval(render, 30_000);
}
