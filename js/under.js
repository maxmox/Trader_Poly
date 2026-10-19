// Cards de FUTEBOL UNDER no quadro principal (mesma regra do Worker: buscarUnderFut em core.js).
// Pré-jogo: 10-30 min antes do início, Under 1,5 do jogo a 0,25-0,40 (o do 1º tempo foi retirado em 19/10/2026).
// Ao vivo: 0x0 entre 28' e 33' (placar da ESPN) -> Under 0,5 do 1º tempo. Em observação: mercados rasos.
import { buscarUnderFut, odd, cents, custoCopia, linkMercado } from "./core.js";
import { $, esc, usd, hora, stakeDe } from "./formato.js";
const VIVO_MIN = 5; // o card do ao vivo fica por até 5 min depois de achado (o backtest entra em até 2 min)

export function iniciarUnderFut({ api, getCfg, aoRenderizar }) {
  const vistos = new Map(); // conditionId -> sinal

  async function tick() {
    if (document.hidden) { setTimeout(tick, 60_000); return; } // aba em segundo plano: sem consultas
    try {
      const agora = Date.now();
      const novos = await buscarUnderFut(api(), agora, { maxLivros: 30 });
      const ids = new Set(novos.map((s) => s.cond));
      for (const s of novos) vistos.set(s.cond, { ...s, visto: agora });
      for (const [k, s] of vistos) {
        // pré-jogo: some quando o preço sai da faixa ou o jogo começa; ao vivo: alguns minutos depois de achado
        if (s.regra === "pre" ? (!ids.has(k) || agora >= s.inicio) : agora - s.visto > VIVO_MIN * 60e3) vistos.delete(k);
      }
    } catch (e) { console.warn("under", e); /* tenta de novo no próximo minuto */ }
    render();
    setTimeout(tick, 60_000);
  }

  function render() {
    const cfg = getCfg();
    const stake = stakeDe(cfg);
    const ativos = [...vistos.values()].sort((a, b) => (a.regra === b.regra ? a.inicio - b.inicio : a.regra === "vivo" ? -1 : 1));
    aoRenderizar?.({ n: ativos.length, copiar: 0 }); // em observação: não conta como entrada recomendada
    $("#under-lista").innerHTML = ativos.map((s) => {
      const vivo = s.regra === "vivo";
      const quando = vivo ? `0x0 aos ~${s.minuto} min` : `começa ${hora(s.inicio)}`;
      return `<article class="card under">
        <div class="card-top"><span class="momento ${vivo ? "vivo" : "pre"}">${vivo ? "Ao vivo" : "Pré-jogo"}</span><span class="momento under">Futebol: Under</span><span class="st ESPERAR">Observar</span>
          <span class="quem">Futebol · ${esc(s.liga)}</span></div>
        <div><div class="evento">${esc(s.tituloEvento)} <span class="placar">${quando}</span></div><div class="lado">${esc(s.aposta)}</div>
          <div class="pergunta">Mercado: ${esc(s.pergunta)} · lado <b>Under</b></div></div>
        <div class="kv">
          <div><small>Odd agora</small><b>${odd(s.ask)}</b></div>
          <div><small>Odd mínima</small><b>${odd(s.teto)}</b></div>
          <div><small>Livre até a mínima</small><b>${usd(s.liquidez)}</b></div>
          <div><small>Volume do mercado</small><b>${usd(s.vol)}</b></div>
        </div>
        <div class="ordem">Se for testar, valor pequeno. Entrar: <b>${esc(s.aposta)}</b> com odd mínima <b>${odd(s.teto)}</b>,
          aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / custoCopia(s.teto))}</b> se ganhar (já descontada a taxa). Segure até o fim.
          <span class="preco-ref">No Polymarket: ordem limitada a ${cents(s.teto)} (mercado raso: cada 1¢ pesa)</span>
          ${s.liquidez < stake ? `<span class="alerta">Só ${usd(s.liquidez)} à venda até a mínima: a ordem pode ser preenchida em parte.</span>` : ""}</div>
        <div class="card-foot"><span>${vivo
          ? "0x0 aos 30': o 0x0 no intervalo sai mais do que o mercado precifica. Backtest 60 dias (placar real, preço real): +16% (385 jogos)."
          : "Under 1,5 a 0,25–0,40, 10–30 min antes do jogo: backtest 60 dias (preço real) +11% a +13%, mas os sinais reais até agora estão negativos. Valor pequeno."}</span>
          <a href="${linkMercado(s)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
      </article>`;
    }).join("");
  }

  tick();
  setInterval(render, 30_000);
}
