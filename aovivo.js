// Aba "Ao vivo": sinais de entrada durante o jogo que ainda dá para replicar.
// Só funciona com acesso em tempo real (direto ou relay): o sinal vale 1–2 minutos.
import { criarApi, carregarAoVivo, cents, odd, rotuloEsporte, rotuloTipo, rotuloNicho, vigentes, PADRAO } from "./core.js";

const INTERVALO = 15_000;
const $ = (s) => document.querySelector(s);

export function iniciarAoVivo({ getCfg, esc, usd, prefixos, traders, aoRenderizar }) {
  // traders pode encolher quando um trader de teste expira
  let dados = null, erro = null, timer = null, rodando = false, avisados = new Set(), primeira = true;
  const cacheEventos = new Map();

  async function tick() {
    clearTimeout(timer);
    if (rodando) return;
    rodando = true;
    const cfg = getCfg();
    try {
      if (cacheEventos.size > 300) cacheEventos.clear();
      traders = vigentes(traders); // trader de teste some sozinho quando expira
      const res = await carregarAoVivo(criarApi({ relay: cfg.relay }), traders, {
        prefixos, regras: { ...PADRAO, tetoCentavos: cfg.teto }, cacheEventos,
      });
      if (res.traders.every((t) => t.erro)) throw new Error(res.traders[0]?.erro || "sem resposta");
      dados = res; erro = null;
    } catch (e) {
      erro = e;
    }
    rodando = false;
    render();
    timer = setTimeout(tick, INTERVALO);
  }

  function relogio(seg) {
    if (seg <= 0) return "encerrada";
    const m = Math.floor(seg / 60), s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const ha = (t) => {
    const s = (Date.now() - t) / 1000;
    return s < 90 ? `há ${Math.round(s)} s` : s < 5400 ? `há ${Math.round(s / 60)} min` : s < 172800 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86400)} dias`;
  };
  const link = (p) => `https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}`;

  function render() {
    const cfg = getCfg();
    const stake = (cfg.banca * cfg.pct) / 100;
    const st = $("#vivo-status");
    if (erro) {
      st.className = "banner";
      st.hidden = false;
      st.innerHTML = `<b>Ao vivo precisa de acesso em tempo real ao Polymarket.</b>
        <span>O retrato do servidor (10 min) não serve aqui: o sinal vale 1–2 minutos. Ative o DNS seguro do navegador
        (Chrome/Edge: Configurações → Privacidade e segurança → Usar DNS seguro → Cloudflare) ou configure o relay em Ajustes.</span>
        <span class="muted">Detalhe: ${esc(erro.message || erro)}</span>`;
    } else {
      st.hidden = true;
    }
    if (!dados) return;

    const porW = Object.fromEntries(dados.traders.map((t) => [t.carteira, t]));
    const agora = Date.now() / 1000;
    const todos = [];
    for (const t of traders) {
      for (const s of porW[t.carteira]?.sinais || []) {
        const restante = t.janelaSeg - (agora - s.entrouEm / 1000);
        const sig = restante <= 0 && s.status === "COPIAR"
          ? { ...s, status: "NAO", motivos: [`passou da janela de ${Math.round(t.janelaSeg / 60)} min`] } : s;
        todos.push({ t, s: { ...sig, restanteSeg: restante } });
      }
    }
    const ativos = todos.filter((x) => x.s.status === "COPIAR")
      .sort((a, b) => (a.t.nivel === "teste") - (b.t.nivel === "teste")); // teste depois dos reais
    aoRenderizar?.({ n: ativos.length, copiar: ativos.length });

    $("#vivo-lista").innerHTML = ativos.map(({ t, s }) => `<article class="card vivo">
          <div class="card-top"><span class="momento vivo">Ao vivo</span><span class="st COPIAR">Copiar já</span><span class="quem">${esc(t.nome)} · ${esc(rotuloEsporte(s.esporte))}${s.tipo ? " · " + esc(rotuloTipo(s.tipo)) : ""}</span></div>
          <div><div class="evento">${esc(s.tituloEvento)}${s.placar ? ` <span class="placar">${esc(s.placar)}</span>` : ""}</div><div class="lado">${esc(s.lado)}</div></div>
          <div class="kv">
            <div><small>Odd dele</small><b>${odd(s.precoDele)}</b></div>
            <div><small>Odd agora</small><b>${odd(s.ask)}</b></div>
            <div><small>Janela</small><b class="countdown" data-fim="${Date.now() + s.restanteSeg * 1000}">${relogio(s.restanteSeg)}</b></div>
            <div><small>Ele apostou</small><b>${usd(s.valorDele)}</b></div>
            <div><small>Livre na odd</small><b>${usd(s.liquidez)}</b></div>
            <div><small>Ele entrou</small><b>${ha(s.entrouEm)}</b></div>
          </div>
          <div class="ordem">Entrar: <b>${esc(s.lado)}</b> com odd mínima <b>${odd(s.teto)}</b>, aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / s.teto)}</b> se ganhar. Segure até o fim.
            <span class="preco-ref">No Polymarket: ordem limitada a ${cents(s.teto)}</span>
            ${s.liquidez < stake ? `<span class="alerta">Só ${usd(s.liquidez)} disponível nessa odd: pode preencher em parte.</span>` : ""}</div>
          <div class="card-foot"><span>Não entre depois que a janela fechar</span><a href="${link(s)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
        </article>`).join("");

    $("#vivo-traders").innerHTML = traders.map((t) => {
      const d = porW[t.carteira] || {};
      const recentes = todos.filter((x) => x.t === t);
      const s = t.stats;
      return `<article class="trader">
        <div class="trader-head"><span class="nivel ${t.nivel}">${{ copiar: "Copiar", observar: "Observar", teste: "Teste" }[t.nivel] || t.nivel}</span><h3>${esc(t.nome)}</h3>
          <a class="wallet" href="https://polymarket.com/profile/${t.carteira}" target="_blank" rel="noopener">${t.carteira}</a></div>
        <div class="chips"><span class="momento vivo">Ao vivo</span>${(t.esportes || []).map((e) => `<span class="chip">${esc(rotuloEsporte(e))}</span>`).join("")}${(t.nichos || []).map((n) => `<span class="chip nicho">só ${esc(rotuloNicho(n))}</span>`).join("")}${(t.nichosFortes || []).map((n) => `<span class="chip forte">forte: ${esc(rotuloNicho(n))}</span>`).join("")}
          <span class="chip">janela ${Math.round(t.janelaSeg / 60)} min</span>${t.minUsd ? `<span class="chip">entradas ≥ ${usd(t.minUsd)}</span>` : ""}</div>
        <div class="stats">
          <span>Lucro <b>${usd(s.lucro)}</b></span><span>Meses + <b>${s.meses_positivos}/${s.meses}</b></span>
          <span>ROI dele <b>${s.roi_dele.toFixed(1).replace(".", ",")}%</b></span>
          <span>Copiando 1 min <b>${s.roi_copia_60s.toFixed(1).replace(".", ",")}%</b></span>
          <span>Preenche <b>${Math.round(s.preenche_60s_pct)}%</b></span>
          <span>Mercado mediano <b>${usd(s.vol_mercado_med)}</b></span>
          <span>Última atividade <b>${d.ultimaAtividade ? ha(d.ultimaAtividade) : "–"}</b></span>
        </div>
        <p class="nota">${esc(t.nota)}</p>
        ${d.erro ? `<p class="erro">Não foi possível ler este trader: ${esc(d.erro)}</p>` : ""}
        ${recentes.length ? `<div class="tbl-wrap"><table><thead><tr><th>Veredito</th><th>Evento</th><th>Lado</th><th class="n">Odd dele</th><th class="n">Odd agora</th><th class="n">Apostou</th><th class="n">Entrou</th></tr></thead><tbody>
          ${recentes.map(({ s }) => `<tr><td><span class="st ${s.status}">${s.status === "COPIAR" ? "Copiar" : "Não"}</span></td>
            <td><a href="${link(s)}" target="_blank" rel="noopener">${esc(s.tituloEvento)}</a><div class="motivo">${esc(s.motivos.join(" · "))}</div></td>
            <td>${esc(s.lado)}</td><td class="n">${odd(s.precoDele)}</td><td class="n">${odd(s.ask)}</td><td class="n">${usd(s.valorDele)}</td><td class="n">${ha(s.entrouEm)}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="sem">Nenhuma entrada nos últimos 15 min.</p>`}
      </article>`;
    }).join("");

    avisar(ativos);
  }

  function bipe() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* sem áudio */ }
  }

  function avisar(ativos) {
    const novos = ativos.filter(({ s }) => !avisados.has(s.asset + s.entrouEm));
    for (const { s } of ativos) avisados.add(s.asset + s.entrouEm);
    if (primeira) { primeira = false; if (!novos.length) return; }
    if (!getCfg().aviso || !novos.length) return;
    bipe();
    if ("Notification" in window && Notification.permission === "granted") {
      for (const { t, s } of novos) {
        new Notification(`AO VIVO: ${s.lado} (${t.nome})`, { body: `${s.tituloEvento} — odd mínima ${odd(s.teto)}, janela ${relogio(s.restanteSeg)}`, tag: s.asset });
      }
    }
  }

  // contagem regressiva sem esperar a próxima consulta
  setInterval(() => {
    document.querySelectorAll(".countdown").forEach((el) => { el.textContent = relogio((+el.dataset.fim - Date.now()) / 1000); });
  }, 1000);

  tick();
  return { agora: () => { tick(); } };
}
