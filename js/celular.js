// Aba Celular (padroes.html, 28/11/2026, pedido do usuário: "preciso do Painel no celular, sem aquele negócio bagunçado;
// as informações têm de ser reduzidas"). A MESMA conta do Painel (dadosJogo: justa, minutos, rotação, quadra/banco,
// cenário, chips), mostrada em cartões: um por jogador, com feito → linha justa e a linha pré-jogo de cada estatística
// escolhida. Toque no cartão = detalhes (minutos por quarto, confiança, o texto de cada chip); toque num chip = o que ele
// diz (no celular não há "passar o mouse"). Cor: verde = a favor do Over (ritmo acima / justa acima da pré), vermelho = Under.
import { esc } from "./formato.js";
import {
  ESTATS, dadosJogo, chipsJogador, cenarioJogo, tabelasPainel, horaAnalise, seloMin, confMin, paradaDe, quandoPainel,
  rotacaoChip, ddTodosLigado, alternarDDTodos,
} from "./painel.js";

const num = (v, c = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
const nomeCurto = (n) => String(n).split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w)).slice(-1)[0] || n;

const CEL = { sel: null, sb: null, sum: null, carregando: false, abertos: new Set(), op: { time: "todos", quadra: false, est: ["pts", "reb", "ast", "tpm", "pra"] } };
try { CEL.sel = localStorage.getItem("traderpoly.cel.jogo") || null; } catch { /* sem armazenamento */ }
try { Object.assign(CEL.op, JSON.parse(localStorage.getItem("traderpoly.cel") || "{}")); } catch { /* padrão */ }
const guardar = () => { try { localStorage.setItem("traderpoly.cel", JSON.stringify(CEL.op)); } catch { /* sem armazenamento */ } };

// ---------- pedaços ----------
function estadoDe(g, st, par) {
  const e = st?.type?.state;
  return e === "in" ? (par ? "parado" : "rolando") : e === "post" ? "fim" : "pre";
}

function faixaJogos(dia) {
  const ev = Object.fromEntries((CEL.sb?.events || []).map((e) => [e.id, e]));
  return `<div class="cel-jogos">${dia.jogos.map((g) => {
    const e = ev[g.id]?.competitions?.[0];
    const st = e?.status, est = st?.type?.state;
    const sc = e ? Object.fromEntries(e.competitors.map((c) => [c.team.abbreviation, c.score])) : {};
    const cls = estadoDe(g, st, g.id === CEL.sel ? CEL.parada : paradaDe(g.id, st, null));
    const hora = e?.date ? new Date(e.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    const q = est === "in" ? quandoPainel(st).replace(" aos ", " ") : est === "post" ? "final" : hora;
    const txt = est && est !== "pre" ? `${esc(g.fora)} <b>${sc[g.fora] ?? ""}</b>–<b>${sc[g.casa] ?? ""}</b> ${esc(g.casa)}` : `${esc(g.fora)} @ ${esc(g.casa)}`;
    return `<button type="button" data-cel-jogo="${g.id}" aria-pressed="${g.id === CEL.sel}" class="${cls}"><i class="pt-dot"></i><span>${txt}</span><small>${q}</small></button>`;
  }).join("")}</div>`;
}

function botao(attr, on, txt) {
  return `<button type="button" class="cel-op${on ? " on" : ""}" ${attr}>${txt}</button>`;
}

function opcoes(g, vivo) {
  const t = CEL.op.time;
  const times = [["todos", "Os dois"], [g.fora, g.fora], [g.casa, g.casa]].map(([v, r]) => botao(`data-cel-time="${esc(v)}"`, t === v, esc(r))).join("");
  const est = ESTATS.map(([k, n]) => botao(`data-cel-est="${k}"`, CEL.op.est.includes(k), n)).join("");
  return `<div class="cel-ops"><span class="cel-grupo">${times}${vivo ? botao("data-cel-quadra", CEL.op.quadra, "só em quadra") : ""}</span><span class="cel-grupo">${est}</span><span class="cel-grupo">${botao("data-cel-dd", ddTodosLigado(), `Chips DD ${ddTodosLigado() ? "ligados" : "desligados"}`)}</span></div>`;
}

// estatística: feito (cor do ritmo) → linha justa (negrito) · pré (seta = justa acima/abaixo da pré)
function celEst(e, k, nome, vivo) {
  if (!e) return "";
  if (e.deveria == null) return `<div class="cel-e"><small>${nome}</small><b class="cel-f">${e.feito ?? "–"}</b><span class="muted">sem linha</span></div>`;
  // antes do jogo a justa é a própria linha pré: um número só (DK = linha da DraftKings; proj = sem linha, projeção)
  if (!vivo) return `<div class="cel-e"><small>${nome}</small><span class="cel-j">${num(e.pre ?? e.justa)}</span><small class="cel-pre">${e.pre == null ? "justa" : e.fonte === "DK" ? "DK" : "proj"}</small></div>`;
  const r = vivo && e.deveria >= 0.5 ? e.feito / e.deveria : null;
  const cls = r == null ? "" : r >= 1.15 ? " quente" : r <= 0.85 ? " frio" : "";
  const d = e.justa - e.pre;
  const seta = e.pre == null || Math.abs(d) < Math.max(0.5, 0.04 * e.pre) ? "" : d > 0 ? '<i class="up">▲</i>' : '<i class="dn">▼</i>';
  const pre = e.pre == null ? "" : `<small class="cel-pre">${e.fonte === "DK" ? "pré" : "proj"} ${num(e.pre)}</small>`;
  return `<div class="cel-e${cls}"><small>${nome}</small>${vivo ? `<b class="cel-f">${e.feito}</b>` : ""}<span class="cel-j">${seta}${num(e.justa)}</span>${pre}</div>`;
}

// o texto dos chips (no celular não há title ao passar o mouse): lista no detalhe do cartão
const textosChips = (html) => [...html.matchAll(/<span class="[^"]*"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => `<li><b>${m[2].trim()}</b><br>${m[1].replace(/\n/g, "<br>")}</li>`).join("");

function cartao(p, rel, vivo, ests) {
  const { j, b, x, quadra, mq } = p;
  const cm = confMin(j, rel);
  const pf = b?.pf ?? 0;
  const pfH = b && pf >= 2 ? `<span class="cel-pf${pf >= 5 ? " f5" : pf >= 4 ? " f4" : ""}">${pf}F</span>` : "";
  const min = !vivo && !rel.fim ? `<span class="cel-min">prev. <b>${num(x.minEsp)}</b></span>`
    : b ? `<span class="cel-min"><b>${b.min}</b>/~${num(x.minAgora, 0)} · fim ~${num((b.min || 0) + x.minResto, 0)}${cm && !rel.fim ? `±${num(cm.sdResto, 0)}` : ""}</span>`
    : `<span class="cel-min muted">não entrou</span>`;
  const dot = quadra == null ? "" : `<span class="dot${quadra ? " on" : ""}"></span>`;
  const chips = chipsJogador(p, rel);
  const aberto = CEL.abertos.has(String(j.aid));
  let det = "";
  if (aberto) {
    const qs = [1, 2, 3, 4].map((q) => `Q${q} ${mq ? `${num(mq[q - 1])}/` : ""}${num(x.espQ[q - 1])}`).join(" · ");
    const conf = cm ? `previsto ${num(x.minEsp)} ± ${num(cm.sd)} min${cm.mot.length ? ` · ${esc(cm.mot.join("; "))}` : ""}` : `previsto ${num(x.minEsp)} min`;
    const outras = ESTATS.filter(([k]) => !ests.includes(k)).map(([k, n]) => { const e = x.est[k]; return e?.justa == null ? "" : `${n} ${vivo ? `${e.feito} → ` : ""}${num(e.justa)}${e.pre != null ? ` (pré ${num(e.pre)})` : ""}`; }).filter(Boolean).join(" · ");
    const txt = textosChips(chips);
    det = `<div class="cel-det"><div><small class="muted">minutos (real/esperado)</small> ${qs}</div><div><small class="muted">confiança</small> ${conf}</div>${outras ? `<div><small class="muted">outras</small> ${outras}</div>` : ""}${txt ? `<ul class="cel-dicas">${txt}</ul>` : ""}</div>`;
  }
  return `<article class="cel-c${quadra === false ? " banco" : ""}${cm?.n === 2 ? " incerto" : ""}${aberto ? " aberto" : ""}" data-cel-aid="${j.aid}">
    <div class="cel-l1">${dot}<b class="cel-nome">${esc(j.nome)}</b>${seloMin(j, rel)}${pfH}${min}</div>
    ${chips ? `<div class="cel-chips">${chips}</div>` : ""}
    <div class="cel-ests" style="--n:${ests.length}">${ests.map((k) => celEst(x.est[k], k, ESTATS.find((e) => e[0] === k)[1], vivo)).join("")}</div>${det}</article>`;
}

// ---------- o jogo inteiro (puro: serve também ao teste em node com o summary congelado) ----------
export function celularHtml(g, s, par = null) {
  const D = dadosJogo(g, s);
  const { st, rel, placar, porTime, chance, semBase } = D;
  const estado = estadoDe(g, st, par);
  const vivo = st.type?.state === "in";
  const comecou = st.type?.state !== "pre";
  const estTxt = estado === "parado" ? `■ parado · ${esc(par)}` : estado === "rolando" ? "● bola rolando" : "";
  const ini = g.inicio ? new Date(g.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const fav = g.handicap == null || g.handicap === 0 ? "" : `${esc(g.handicap < 0 ? g.casa : g.fora)} −${num(Math.abs(g.handicap))} · total ${num(g.total)}`;
  const topo = `<div class="cel-placar ${estado}"><div class="cel-pl"><span>${esc(g.fora)} <b>${comecou ? placar[g.fora] ?? "–" : ""}</b></span><span class="muted">${comecou ? "×" : "@"}</span><span><b>${comecou ? placar[g.casa] ?? "–" : ""}</b> ${esc(g.casa)}</span></div><small>${comecou ? quandoPainel(st) : `começa ${ini}`}${estTxt ? ` · <span class="cel-est">${estTxt}</span>` : ""}${fav ? ` · ${fav}` : ""}</small></div>`;
  const C = rel.fim ? null : cenarioJogo(g, chance);
  const cen = C ? `<div class="cel-cen ${C.cls}"><b>${C.titulo}</b>${C.cls === "aberto" ? ` <small>${C.sub}</small>` : ` <small>${C.cls === "blow" ? `${esc(C.lider)} na frente: titulares perdem min no Q4` : "titulares até o fim"}</small>`}</div>` : "";
  const ordemRot = { passou: 0, prestes: 1, sentou: 2 };
  const rots = Object.values(porTime).flat().filter((p) => p.rot).sort((a, c) => ordemRot[a.rot.tipo] - ordemRot[c.rot.tipo] || a.rot.s - c.rot.s);
  const rotH = rots.length ? `<div class="cel-rot">${rots.slice(0, 6).map((p) => `<span><small class="muted">${esc(p.j.time)}</small> ${esc(nomeCurto(p.j.nome))}${rotacaoChip(p.rot)}</span>`).join("")}</div>` : "";
  const fora = !comecou ? Object.entries(g.lesoes || {}).flatMap(([t, v]) => v.filter((x) => /\(Out\)/.test(x)).map((x) => `${esc(t)} ${esc(nomeCurto(x.replace(/ \(.*$/, "")))}`)) : [];
  const foraH = fora.length ? `<p class="cel-fora"><b>Fora:</b> ${fora.join(" · ")}</p>` : "";
  const ests = ESTATS.map(([k]) => k).filter((k) => CEL.op.est.includes(k));
  const siglas = [g.fora, g.casa].filter((t) => CEL.op.time === "todos" || CEL.op.time === t);
  const times = siglas.map((t) => {
    let L = (porTime[t] || []).slice().sort((a, c) => (c.b?.starter - a.b?.starter) || (c.x.minEsp - a.x.minEsp));
    if (vivo && CEL.op.quadra) L = L.filter((p) => p.quadra);
    const sem = semBase.filter((b) => b.sigla === t);
    return `<h3 class="cel-time">${esc(t)}${vivo ? ` <small class="muted">${placar[t] ?? ""}</small>` : ""}</h3>${L.map((p) => cartao(p, rel, comecou, ests)).join("") || '<p class="muted">ninguém em quadra agora</p>'}${sem.length ? `<p class="cel-fora muted">Sem projeção: ${sem.map((b) => `${esc(nomeCurto(b.nome))} ${b.min} min ${b.pts} pts`).join(" · ")}</p>` : ""}`;
  }).join("");
  return `${topo}${cen}${rotH}${foraH}${opcoes(g, vivo)}${times}`;
}

// ---------- página ----------
function dica(el, alvo) {
  let d = el.querySelector(".cel-dica");
  if (!d) { el.insertAdjacentHTML("beforeend", `<div class="cel-dica" role="dialog"><button type="button" class="cel-x" aria-label="fechar">×</button><div></div></div>`); d = el.querySelector(".cel-dica"); d.querySelector(".cel-x").onclick = () => d.classList.remove("on"); }
  d.querySelector("div").innerHTML = `<b>${esc(alvo.textContent.trim())}</b><br>${esc(alvo.title).replace(/\n/g, "<br>")}`;
  d.classList.add("on");
}

export async function mostrarCelular(el, dia, espn, forcar = false) {
  if (!dia || CEL.carregando || document.hidden) return;
  CEL.carregando = true;
  Object.assign(CEL, { dia, espn });
  const redesenhar = (f = false) => { CEL.carregando = false; mostrarCelular(el, CEL.dia, CEL.espn, f); };
  try {
    await tabelasPainel();
    if (!el.querySelector("#cel-vivo")) {
      el.innerHTML = `<div id="cel-vivo" class="cel"><p class="muted">buscando o jogo…</p></div>`;
      const vivoEl = el.querySelector("#cel-vivo");
      vivoEl.addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (b && vivoEl.contains(b)) {
          if (b.dataset.celJogo) { CEL.sel = b.dataset.celJogo; try { localStorage.setItem("traderpoly.cel.jogo", CEL.sel); } catch { /* */ } CEL.abertos.clear(); return redesenhar(true); }
          if (b.dataset.celTime) { CEL.op.time = b.dataset.celTime; guardar(); return redesenhar(); }
          if (b.dataset.celQuadra != null) { CEL.op.quadra = !CEL.op.quadra; guardar(); return redesenhar(); }
          if (b.dataset.celEst) { const k = b.dataset.celEst, s = new Set(CEL.op.est); if (s.has(k)) { if (s.size > 1) s.delete(k); } else s.add(k); CEL.op.est = [...s]; guardar(); return redesenhar(); }
          if (b.dataset.celDd != null) { alternarDDTodos(); return redesenhar(); }
          return;
        }
        const chip = ev.target.closest("[title]");
        if (chip && chip.closest(".cel-c")) { ev.stopPropagation(); return dica(el, chip); }
        const c = ev.target.closest(".cel-c");
        if (c) { const a = c.dataset.celAid; if (CEL.abertos.has(a)) CEL.abertos.delete(a); else CEL.abertos.add(a); redesenhar(); }
      });
    }
    const vivo = el.querySelector("#cel-vivo");
    try { CEL.sb = await espn(`/scoreboard?dates=${dia.data.replaceAll("-", "")}`); } catch { /* fica com o anterior */ }
    const ids = dia.jogos.map((g) => g.id);
    if (!ids.includes(CEL.sel)) {
      const st = (id) => CEL.sb?.events?.find((e) => e.id === id)?.competitions?.[0]?.status?.type?.state;
      CEL.sel = ids.find((id) => st(id) === "in") || ids.find((id) => st(id) === "pre") || ids[0];
    }
    const g = dia.jogos.find((x) => x.id === CEL.sel);
    if (!g) { vivo.innerHTML = '<p class="muted">Sem jogos neste dia.</p>'; return; }
    if (forcar || CEL.sum?.header?.id !== g.id || !CEL.sum?.header?.competitions?.[0]?.status?.type?.completed) {
      try { CEL.sum = await espn(`/summary?event=${g.id}`); } catch { if (CEL.sum?.header?.id !== g.id) CEL.sum = null; }
    }
    const sumG = CEL.sum?.header?.id === g.id ? CEL.sum : null;
    CEL.parada = paradaDe(g.id, sumG?.header?.competitions?.[0]?.status, sumG?.plays);
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    // o redesenho a cada 30 s não pode jogar a tela para o topo nem a faixa de jogos para o começo
    const rolagem = scrollY, faixa = vivo.querySelector(".cel-jogos")?.scrollLeft, mesmo = CEL.ultimo === g.id;
    vivo.innerHTML = `${faixaJogos(dia)}${celularHtml(g, sumG, CEL.parada)}<p class="cel-rodape muted">atualizado às ${hora} (a cada 30 s) · análise das ${horaAnalise(dia)} · toque no jogador para detalhes e no chip para ver o que ele diz · a mesma conta do Painel</p>`;
    scrollTo(0, rolagem);
    const fx = vivo.querySelector(".cel-jogos"), bt = fx?.querySelector('button[aria-pressed="true"]');
    if (fx) fx.scrollLeft = mesmo && faixa != null ? faixa : bt ? bt.offsetLeft - (fx.clientWidth - bt.offsetWidth) / 2 : 0;
    CEL.ultimo = g.id;
    const bar = document.querySelector(".bar");
    if (bar) document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
  } finally { CEL.carregando = false; }
}
