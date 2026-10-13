import { criarApi, carregarTodos, cents, odd, rotuloEsporte, FORA, PADRAO } from "./core.js";
import { iniciarAoVivo } from "./aovivo.js";

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
const regras = () => ({ ...PADRAO, tetoCentavos: cfg.teto });

async function json(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function buscarVivo() {
  const api = criarApi({ relay: cfg.relay });
  const res = await carregarTodos(api, traders, { prefixos, regras: regras() });
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
    fonte = cfg.relay ? "relay" : "direto";
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
  b.innerHTML = `<b>Sem acesso direto ao Polymarket${cfg.relay ? " (nem pelo relay)" : ""}.</b>
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
const link = (p) => `https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}`;

// ---------- render ----------
function render() {
  const pill = $("#fonte");
  const rot = { direto: ["ao vivo", "live"], relay: ["ao vivo · relay", "live"], retrato: ["retrato do servidor", "snap"], off: ["sem dados", "off"], carregando: ["carregando…", ""] }[fonte];
  pill.textContent = rot[0]; pill.className = `pill ${rot[1]}`;
  if (!dados) return;
  $("#atualizado").textContent = `dados de ${dataHora(dados.geradoEm)} (${ha(dados.geradoEm)})`;

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
  agoraLista.sort((a, b) => (a.p.status === b.p.status ? (a.p.inicio ?? 9e15) - (b.p.inicio ?? 9e15) : a.p.status === "COPIAR" ? -1 : 1));
  const nCopiar = agoraLista.filter((x) => x.p.status === "COPIAR").length;
  document.title = nCopiar ? `(${nCopiar}) Trader Poly` : "Trader Poly";
  $("#titulo-agora").textContent = nCopiar ? `Copiáveis agora · ${nCopiar}` : "Copiáveis agora";

  $("#lista-agora").innerHTML = agoraLista.length
    ? agoraLista.map(({ t, p }) => {
        const cotas = p.teto > 0 ? stake / p.teto : 0;
        return `<article class="card ${p.status}">
          <div class="card-top"><span class="st ${p.status}">${p.status === "COPIAR" ? "Copiar" : "Esperar"}</span>
            <span class="quem">${esc(t.nome)} · ${esc(rotuloEsporte(p.esporte))}</span></div>
          <div><div class="evento">${esc(p.tituloEvento)}</div><div class="lado">${esc(p.lado)}</div></div>
          <div class="kv">
            <div><small>Odd dele</small><b>${odd(p.precoDele)}</b></div>
            <div><small>Odd agora</small><b>${odd(p.ask)}</b></div>
            <div><small>Começa</small><b>${quando(p.horasParaInicio)}</b></div>
            <div><small>Ele apostou</small><b>${usd(p.valorDele)}</b></div>
            <div><small>Livre até o teto</small><b>${usd(p.liquidez)}</b></div>
            <div><small>Ele entrou</small><b>${ha(p.entrouEm)}</b></div>
          </div>
          <div class="ordem">${p.status === "COPIAR" ? "Entrar" : "Deixe ordem limitada"}: <b>${esc(p.lado)}</b> com odd mínima <b>${odd(p.teto)}</b>,
            aposta <b>${usd(stake)}</b> → retorno <b>${usd(stake / p.teto)}</b> se ganhar
            <span class="preco-ref">No Polymarket: ordem limitada a ${cents(p.teto)} (~${Math.floor(cotas).toLocaleString("pt-BR")} cotas)</span>
            ${p.status === "COPIAR" && p.liquidez < stake ? `<span class="alerta">Só ${usd(p.liquidez)} à venda até o teto: a ordem pode ser preenchida em parte.</span>` : ""}</div>
          <div class="card-foot"><span>${p.status === "ESPERAR" ? esc(p.motivos.join(" · ")) : `Odd mínima = odd dele piorada em ${cfg.teto}¢ de preço`}</span><a href="${link(p)}" target="_blank" rel="noopener">Abrir no Polymarket ↗</a></div>
        </article>`;
      }).join("")
    : `<div class="vazio"><b>Nenhuma posição copiável neste momento.</b><span>Os traders recomendados não têm entradas abertas que passem nas regras. A página se atualiza sozinha.</span></div>`;

  // fichas dos traders
  $("#traders").innerHTML = traders.map((t) => {
    const d = porCarteira[t.carteira] || {};
    const s = t.stats;
    const pos = (d.posicoes || []).map((p) => revalidar(p, agora)).filter((p) => cfg.fora || p.esporte !== FORA);
    const ocultas = (d.posicoes || []).length - pos.length;
    const linhas = pos.map((p) => `<tr>
        <td><span class="st ${p.status}">${p.status === "NAO" ? "Não" : p.status === "COPIAR" ? "Copiar" : "Esperar"}</span></td>
        <td><a href="${link(p)}" target="_blank" rel="noopener">${esc(p.tituloEvento)}</a><div class="motivo">${esc(p.motivos.join(" · "))}</div></td>
        <td>${esc(p.lado)}</td><td>${esc(rotuloEsporte(p.esporte))}</td>
        <td class="n">${odd(p.precoDele)}</td><td class="n">${odd(p.ask)}</td><td class="n">${usd(p.valorDele)}</td>
        <td class="n">${quando(p.horasParaInicio)}</td></tr>`).join("");
    return `<article class="trader">
      <div class="trader-head"><span class="nivel ${t.nivel}">${t.nivel === "copiar" ? "Copiar" : "Observar"}</span><h3>${esc(t.nome)}</h3>
        <a class="wallet" href="https://polymarket.com/profile/${t.carteira}" target="_blank" rel="noopener">${t.carteira}</a></div>
      <div class="chips">${t.esportes.map((e) => `<span class="chip">${esc(rotuloEsporte(e))}</span>`).join("")}</div>
      <div class="stats">
        <span>Lucro <b>${usd(s.lucro)}</b></span><span>Sem top 5 <b>${usd(s.lucro_sem_top5)}</b></span>
        <span>Meses + <b>${s.meses_positivos}/${s.meses}</b></span><span>Apostas <b>${(s.apostas || 0).toLocaleString("pt-BR")}</b></span>
        <span>Copiando 5 min <b>${s.roi_copia_5min == null ? "–" : s.roi_copia_5min.toFixed(1).replace(".", ",") + "%"}</b></span>
        <span>Última atividade <b>${ha(d.ultimaAtividade)}</b></span>
      </div>
      <p class="nota">${esc(t.nota)}</p>
      ${d.erro ? `<p class="erro">Não foi possível ler este trader: ${esc(d.erro)}</p>` : ""}
      ${pos.length
        ? `<div class="tbl-wrap"><table><thead><tr><th>Veredito</th><th>Evento</th><th>Lado</th><th>Esporte</th><th class="n">Odd dele</th><th class="n">Odd agora</th><th class="n">Apostou</th><th class="n">Começa</th></tr></thead><tbody>${linhas}</tbody></table></div>`
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
    new Notification(`Copiar: ${p.lado} (${t.nome})`, { body: `${p.tituloEvento} — odd mínima ${odd(p.teto)}, começa ${quando(p.horasParaInicio)}`, tag: p.asset });
  }
}

// ---------- início ----------
(async function iniciar() {
  try {
    [{ traders }, prefixos] = await Promise.all([json("data/traders.json"), json("data/prefixos.json")]);
  } catch (e) {
    $("#lista-agora").innerHTML = `<div class="vazio"><b>Não consegui carregar a lista de traders.</b><span>${esc(e.message)}</span></div>`;
    return;
  }
  // mostra o retrato na hora e depois tenta o tempo real
  try { dados = await json("data/snapshot.json"); fonte = "retrato"; render(); } catch { /* ainda não existe retrato */ }
  atualizar();
  setInterval(render, 30_000); // relógio: "começa em", "há X min" e revalidação

  // aba ao vivo
  let vivo = null;
  const abrir = (qual) => {
    const v = qual === "vivo";
    $("#aba-pre").hidden = v; $("#aba-vivo").hidden = !v;
    $("#tab-pre").setAttribute("aria-selected", String(!v)); $("#tab-vivo").setAttribute("aria-selected", String(v));
    try { history.replaceState(null, "", v ? "#aovivo" : "#"); } catch { /* sem history */ }
    if (v) vivo?.agora();
  };
  $("#tab-pre").addEventListener("click", () => abrir("pre"));
  $("#tab-vivo").addEventListener("click", () => abrir("vivo"));
  try {
    const { traders: tv } = await json("data/traders_live.json");
    vivo = iniciarAoVivo({ getCfg: () => cfg, esc, usd, prefixos, traders: tv, ativa: () => !$("#aba-vivo").hidden });
  } catch (e) {
    $("#vivo-lista").innerHTML = `<div class="vazio"><b>Lista de traders ao vivo indisponível.</b><span>${esc(e.message)}</span></div>`;
  }
  if (location.hash === "#aovivo") abrir("vivo");
})();
