import { criarApi, carregarTodos, cents, odd, rotuloEsporte, rotuloTipo, rotuloNicho, vigentes, notaEntrada, linkMercado, custoCopia, FORA, PADRAO, historicoNoMercado, momentoDaEntrada, liberado } from "./core.js";
import { iniciarAoVivo } from "./aovivo.js";
import { blocoNota, pilulaNota, tamanhoTxt, blocoSaida, seloMercado } from "./nota.js";
import { linhaPlacar, secaoPlacar } from "./placar.js";

const INTERVALO_VIVO = 60_000;     // busca direta a cada 1 min
const INTERVALO_RETRATO = 120_000; // sem acesso direto, relê o retrato do servidor a cada 2 min

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (v) => (v == null ? "–" : "$" + Math.round(v).toLocaleString("pt-BR"));

// ---------- ajustes (só neste navegador) ----------
const CFG_PADRAO = { banca: 1000, pct: 1.5, teto: PADRAO.tetoCentavos, relay: "", fora: false, aviso: false };
function lerCfg() {
  try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}") }; } catch { return { ...CFG_PADRAO }; }
}
function salvarCfg() { try { localStorage.setItem("traderpoly.cfg", JSON.stringify(cfg)); } catch { /* sem storage: segue só na sessão */ } }
let cfg = lerCfg();

const campos = { banca: "#cfg-banca", pct: "#cfg-pct", teto: "#cfg-teto", relay: "#cfg-relay", fora: "#cfg-fora", aviso: "#cfg-aviso" };
for (const [k, sel] of Object.entries(campos)) {
  const el = $(sel);
  if (el.type === "checkbox") el.checked = cfg[k]; else el.value = cfg[k];
  el.addEventListener("change", async () => {
    cfg[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Math.max(0, parseFloat(el.value) || 0) : el.value.trim();
    salvarCfg();
    if (k === "aviso" && cfg.aviso && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    if (k === "relay" || k === "teto") atualizar(); else render();
  });
}
$("#btn-ajustes").addEventListener("click", () => {
  const p = $("#ajustes"); p.hidden = !p.hidden;
  $("#btn-ajustes").setAttribute("aria-expanded", String(!p.hidden));
});
$("#btn-atualizar").addEventListener("click", () => atualizar());

// ---------- estado ----------
let traders = [], prefixos = {}, dados = null, fonte = "carregando", jaAvisados = new Set(), primeiraCarga = true;
let relayPadrao = "";
let indices = null; // data/indices.json: efeitos dos fatores da nota da entrada
let desempenho = null; // data/desempenho.json: últimos 30 dias de cada trader (Action)
let mercados = null; // data/mercados_trader.json: como cada trader se sai em cada mercado
let registro = []; // sinais reais enviados ao Telegram (Worker /registro)
let tradersVivo = [];
const sinaisDe = (w) => registro.filter((s) => s.w === w);
async function carregarPlacar() {
  desempenho = await json("data/desempenho.json").catch(() => desempenho);
  if (relay()) {
    try {
      const r = await fetch(`${relay().replace(/\/$/, "")}/registro`, { cache: "no-store" });
      if (r.ok) registro = (await r.json()).sinais || [];
    } catch { /* sem relay: só o desempenho simulado */ }
  }
  renderPlacar();
}
function renderPlacar() {
  $("#placar").innerHTML = secaoPlacar({ desempenho, registro, esc,
    traders: [...tradersVivo.map((t) => ({ t, momento: "ao vivo" })), ...traders.map((t) => ({ t, momento: "pré-jogo" }))] });
} // data/config.json: relay do repositório, usado quando Ajustes está vazio
const relay = () => cfg.relay || relayPadrao;
const regras = () => ({ ...PADRAO, tetoCentavos: cfg.teto });

async function json(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function buscarVivo() {
  const api = criarApi({ relay: relay() });
  const res = await carregarTodos(api, traders, { prefixos, regras: regras(), indices });
  if (res.traders.every((t) => t.erro)) throw new Error(res.traders[0]?.erro || "sem resposta");
  return res;
}

let timer = null, rodando = false;
async function atualizar() {
  if (rodando) return;
  rodando = true;
  clearTimeout(timer);
  $("#btn-atualizar").textContent = "Atualizando…";
  try {
    dados = await buscarVivo();
    fonte = relay() ? "relay" : "direto";
    $("#aviso-dns").hidden = true;
  } catch (e) {
    try {
      dados = await json("data/snapshot.json");
      fonte = "retrato";
    } catch {
      fonte = "off";
    }
    mostrarAvisoDns(e);
  }
  rodando = false;
  $("#btn-atualizar").textContent = "Atualizar";
  render();
  timer = setTimeout(atualizar, fonte === "retrato" ? INTERVALO_RETRATO : INTERVALO_VIVO);
}

function mostrarAvisoDns(e) {
  const b = $("#aviso-dns");
  b.hidden = false;
  b.innerHTML = `<b>Sem acesso direto ao Polymarket${relay() ? " (nem pelo relay)" : ""}.</b>
    <span>Mostrando o retrato que o servidor gera a cada ~10 min; o veredito de "jogo começou" continua sendo recalculado pelo relógio.
    Para tempo real: ative o DNS seguro do navegador (Chrome/Edge: Configurações → Privacidade e segurança → Usar DNS seguro → Cloudflare)
    ou publique o relay do repositório e cole a URL em Ajustes.</span>
    <span class="muted">Detalhe: ${esc(e?.message || e)}</span>`;
}

// O retrato pode ter alguns minutos: se o jogo começou depois, rebaixa para NÃO.
function revalidar(p, agora) {
  if (p.status !== "NAO" && p.inicio && agora >= p.inicio) {
    return { ...p, status: "NAO", motivos: ["jogo já começou — regra: nunca copiar ao vivo"] };
  }
  return p;
}

function quando(h) {
  if (h == null) return "–";
  if (h < 0) return "começou";
  if (h < 1) return `em ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `em ${h.toFixed(h < 10 ? 1 : 0).replace(".", ",")} h`;
  return `em ${Math.round(h / 24)} dias`;
}
const dataHora = (t) => (t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const ha = (t) => {
  if (!t) return "–";
  const m = (Date.now() - t) / 60000;
  return m < 60 ? `há ${Math.max(1, Math.round(m))} min` : m < 2880 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`;
};
const link = linkMercado; // vai direto ao mercado (não só ao evento)

// ---------- quadro único (pré-jogo + ao vivo) ----------
const quadro = { pre: { n: 0, copiar: 0 }, vivo: { n: 0, copiar: 0 } };
function atualizarQuadro() {
  const copiar = quadro.pre.copiar + quadro.vivo.copiar;
  document.title = copiar ? `(${copiar}) Trader Poly` : "Trader Poly";
  $("#titulo-agora").textContent = copiar ? `Sinais agora · ${copiar}` : "Sinais agora";
  $("#quadro-vazio").hidden = quadro.pre.n + quadro.vivo.n > 0;
}

// ---------- render ----------
function render() {
  const pill = $("#fonte");
  const rot = { direto: ["ao vivo", "live"], relay: ["ao vivo · relay", "live"], retrato: ["retrato do servidor", "snap"], off: ["sem dados", "off"], carregando: ["carregando…", ""] }[fonte];
  pill.textContent = rot[0]; pill.className = `pill ${rot[1]}`;
  if (!dados) return;
  $("#atualizado").textContent = `pré-jogo: dados de ${dataHora(dados.geradoEm)} (${ha(dados.geradoEm)}) · ao vivo: a cada 15 s`;

  const agora = Date.now();
  const porCarteira = Object.fromEntries((dados.traders || []).map((t) => [t.carteira, t]));
  const stake = (cfg.banca * cfg.pct) / 100;

  // copiáveis agora (todas as carteiras)
  const agoraLista = [];
  for (const t of traders) {
    for (const p0 of porCarteira[t.carteira]?.posicoes || []) {
      const p = revalidar(p0, agora);
      if (p.status !== "NAO") agoraLista.push({ t, p });
    }
  }
  // traders reais primeiro; o trader de teste aparece no máximo 6 vezes, no fim
  const teste = (x) => x.t.nivel === "teste";
  agoraLista.sort((a, b) => teste(a) - teste(b) || (a.p.status === b.p.status ? (a.p.inicio ?? 9e15) - (b.p.inicio ?? 9e15) : a.p.status === "COPIAR" ? -1 : 1));
  for (let i = agoraLista.length - 1, n = agoraLista.filter(teste).length; i >= 0 && n > 6; i--) if (teste(agoraLista[i])) { agoraLista.splice(i, 1); n--; }
  // conflito: outro trader recomendado está do lado oposto do mesmo mercado
  const ladosDoMercado = {};
  for (const t of traders) for (const q of porCarteira[t.carteira]?.posicoes || []) {
    if (q.cond) (ladosDoMercado[q.cond] ||= []).push({ t, q });
  }
  const conflito = (t, p) => (ladosDoMercado[p.cond] || []).filter((o) => o.q.asset !== p.asset && o.t.carteira !== t.carteira);
  const nCopiar = agoraLista.filter((x) => x.p.status === "COPIAR").length;
  quadro.pre = { n: agoraLista.length, copiar: nCopiar };
  atualizarQuadro();

  $("#lista-agora").innerHTML = agoraLista.map(({ t, p }) => {
        const cotas = p.teto > 0 ? stake / p.teto : 0;
        const n = notaEntrada(p, t, indices, mercados);
        return `<article class="card ${p.status}">
          <div class="card-top"><span class="momento pre">Pré-jogo</span><span class="st ${p.status}">${p.status === "COPIAR" ? "Copiar" : "Esperar"}</span>
            <span class="quem">${esc(t.nome)} · ${esc(rotuloEsporte(p.esporte))}${p.tipo ? " · " + esc(rotuloTipo(p.tipo)) : ""}</span></div>
          <div><div class="evento">${esc(p.tituloEvento)}</div><div class="lado">${esc(p.aposta || p.lado)}</div>${p.pergunta && p.pergunta !== p.tituloEvento ? `<div class="pergunta">Mercado: ${esc(p.pergunta)} · lado <b>${esc(p.lado)}</b></div>` : ""}</div>
          <div class="kv">
            <div><small>Odd dele</small><b>${odd(p.precoDele)}</b></div>
            <div><small>Odd agora</small><b>${odd(p.ask)}</b></div>
            <div><small>Começa</small><b>${quando(p.horasParaInicio)}</b></div>
            <div><small>Ele apostou</small><b>${usd(p.valorDele)}</b>${tamanhoTxt(p.tamanho)}</div>
            <div><small>Livre até o teto</small><b>${usd(p.liquidez)}</b></div>
            <div><small>Ele entrou</small><b>${ha(p.entrouEm)}</b></div>
          </div>
          ${conflito(t, p).map((o) => `<div class="conflito">Conflito: <b>${esc(o.t.nome)}</b> está do lado oposto neste mercado (${esc(o.q.aposta || o.q.lado)}). Copiar os dois anula a aposta.</div>`).join("")}
          ${blocoNota(n, esc)}
          ${blocoSaida(t.saida, p.precoDele)}
          <div class="ordem">${p.status === "COPIAR" ? "Entrar" : "Deixe ordem limitada"}: <b>${esc(p.aposta || p.lado)}</b> com odd mínima <b>${odd(p.teto)}</b>,
            aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / custoCopia(p.teto))}</b> se ganhar (já descontada a taxa)
            <span class="preco-ref">No Polymarket: ordem limitada a ${cents(p.teto)} (~${Math.floor(cotas).toLocaleString("pt-BR")} cotas)</span>
            ${p.status === "COPIAR" && p.liquidez < stake ? `<span class="alerta">Só ${usd(p.liquidez)} à venda até o teto: a ordem pode ser preenchida em parte.</span>` : ""}
            ${t.props ? `<span class="alerta">Prop de jogador: mercado raso (na temporada passada, só em 1 de cada 4 apostas dele dava para comprar $100 até o teto). Use <b>ordem limitada</b> (quem deixa ordem no livro não paga taxa) e no máximo <b>${usd(t.props.max_usd)}</b>.</span>` : ""}</div>
          <div class="card-foot"><span>${p.status === "ESPERAR" ? esc(p.motivos.join(" · ")) : `Odd mínima = no máximo ${cfg.teto}¢ (ou 10%) de preço pior que a dele`}</span><a href="${link(p)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
        </article>`;
      }).join("");

  // fichas dos traders
  $("#traders").innerHTML = traders.map((t) => {
    const d = porCarteira[t.carteira] || {};
    const s = t.stats || {}; // traders novos (garimpo) não têm todas as estatísticas
    const pos = (d.posicoes || []).map((p) => revalidar(p, agora)).filter((p) => cfg.fora || p.esporte !== FORA);
    const ocultas = (d.posicoes || []).length - pos.length;
    const linhas = pos.map((p) => `<tr>
        <td><span class="st ${p.status}">${p.status === "NAO" ? "Não" : p.status === "COPIAR" ? "Copiar" : "Esperar"}</span></td>
        <td><a href="${link(p)}" target="_blank" rel="noopener">${esc(p.tituloEvento)}</a><div class="motivo">${esc(p.motivos.join(" · "))}</div></td>
        <td>${esc(p.aposta || p.lado)}</td><td>${esc(rotuloEsporte(p.esporte))}${p.tipo ? `<div class="motivo">${esc(rotuloTipo(p.tipo))}</div>` : ""}
          ${p.esporte !== FORA ? seloMercado(historicoNoMercado(mercados, t.carteira, p.esporte, p.tipo, momentoDaEntrada(p)), liberado(t, p.esporte, p.tipo, momentoDaEntrada(p)).ok, esc) : ""}</td>
        <td class="n">${odd(p.precoDele)}</td><td class="n">${odd(p.ask)}</td><td class="n">${usd(p.valorDele)}</td>
        <td class="n">${quando(p.horasParaInicio)}</td><td class="n">${p.esporte === FORA ? "–" : pilulaNota(notaEntrada({ ...p, momento: momentoDaEntrada(p) }, t, indices, mercados))}</td></tr>`).join("");
    return `<article class="trader">
      <div class="trader-head"><span class="nivel ${t.nivel}">${{ copiar: "Copiar", observar: "Observar", teste: "Teste" }[t.nivel] || t.nivel}</span><h3>${esc(t.nome)}</h3>
        <a class="wallet" href="https://polymarket.com/profile/${t.carteira}" target="_blank" rel="noopener">${t.carteira}</a></div>
      <div class="chips"><span class="momento pre">Pré-jogo</span>${(t.esportes || []).map((e) => `<span class="chip">${esc(rotuloEsporte(e))}</span>`).join("")}${(t.nichos || []).map((n) => `<span class="chip nicho">só ${esc(rotuloNicho(n))}</span>`).join("")}${(t.nichosFortes || []).map((n) => `<span class="chip forte">forte: ${esc(rotuloNicho(n))}</span>`).join("")}</div>
      <div class="stats">
        <span>Lucro <b>${usd(s.lucro)}</b></span><span>Sem top 5 <b>${usd(s.lucro_sem_top5)}</b></span>
        <span>Meses + <b>${s.meses_positivos ?? "–"}/${s.meses ?? "–"}</b></span><span>Apostas <b>${(s.apostas || 0).toLocaleString("pt-BR")}</b></span>
        ${s.roi_copia_5min != null ? `<span>Copiando 5 min <b>${s.roi_copia_5min.toFixed(1).replace(".", ",")}%</b></span>`
          : s.roi_copia_60s != null ? `<span>Copiando 1 min <b>${s.roi_copia_60s.toFixed(1).replace(".", ",")}%</b></span>` : ""}
        <span>Última atividade <b>${ha(d.ultimaAtividade)}</b></span>
      </div>
      ${linhaPlacar(desempenho?.traders?.[t.carteira], sinaisDe(t.carteira), esc)}
      <p class="nota">${esc(t.nota)}</p>
      ${d.erro ? `<p class="erro">Não foi possível ler este trader: ${esc(d.erro)}</p>` : ""}
      ${pos.length
        ? `<div class="tbl-wrap"><table><thead><tr><th>Veredito</th><th>Evento</th><th>Lado</th><th>Esporte</th><th class="n">Odd dele</th><th class="n">Odd agora</th><th class="n">Apostou</th><th class="n">Começa</th><th class="n">Nota</th></tr></thead><tbody>${linhas}</tbody></table></div>`
        : `<p class="sem">Sem posições abertas em esporte${ocultas ? ` (${ocultas} fora de esporte ocultas)` : ""}.</p>`}
      ${pos.length && ocultas ? `<p class="sem">${ocultas} posições fora de esporte ocultas.</p>` : ""}
    </article>`;
  }).join("");

  avisar(agoraLista.filter((x) => x.p.status === "COPIAR"));
}

function avisar(lista) {
  const novos = lista.filter(({ p }) => !jaAvisados.has(p.asset));
  for (const { p } of lista) jaAvisados.add(p.asset);
  if (primeiraCarga) { primeiraCarga = false; return; } // não avisa o que já estava aberto ao entrar
  if (!cfg.aviso || !novos.length || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const { t, p } of novos) {
    new Notification(`Copiar: ${p.aposta || p.lado} (${t.nome})`, { body: `${p.tituloEvento} — odd mínima ${odd(p.teto)}, começa ${quando(p.horasParaInicio)}`, tag: p.asset });
  }
}

// ---------- início ----------
(async function iniciar() {
  try {
    [{ traders }, prefixos] = await Promise.all([json("data/traders.json"), json("data/prefixos.json")]);
    traders = vigentes(traders);
    relayPadrao = (await json("data/config.json").catch(() => ({}))).relay || "";
    indices = await json("data/indices.json").catch(() => null);
    mercados = await json("data/mercados_trader.json").catch(() => null);
    if (relayPadrao) $("#cfg-relay").placeholder = `${relayPadrao} (padrão do repositório)`;
  } catch (e) {
    $("#quadro-vazio").hidden = false;
    $("#quadro-vazio").innerHTML = `<b>Não consegui carregar a lista de traders.</b><span>${esc(e.message)}</span>`;
    return;
  }
  // mostra o retrato na hora e depois tenta o tempo real
  try { dados = await json("data/snapshot.json"); fonte = "retrato"; render(); } catch { /* ainda não existe retrato */ }
  atualizar();
  setInterval(render, 30_000); // relógio: "começa em", "há X min" e revalidação

  // ao vivo: mesmo quadro, consulta a cada 15 s
  try {
    const tv = vigentes((await json("data/traders_live.json")).traders);
    tradersVivo = tv;
    iniciarAoVivo({ getCfg: () => ({ ...cfg, relay: relay() }), esc, usd, prefixos, traders: tv, indices, mercados,
      placar: (w) => linhaPlacar(desempenho?.traders?.[w], sinaisDe(w), esc),
      aoRenderizar: (c) => { quadro.vivo = c; atualizarQuadro(); } });
  } catch (e) {
    $("#vivo-traders").innerHTML = `<p class="erro">Lista de traders ao vivo indisponível: ${esc(e.message)}</p>`;
  }
  carregarPlacar().then(render);
  setInterval(() => carregarPlacar().then(render), 5 * 60_000);
})();
