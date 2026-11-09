// Registro das entradas do usuário no Painel (09/11/2026, pedido do usuário: "eu coloco a linha e a odd que entrar").
// Grava no navegador (localStorage) a entrada + o contexto do Painel naquele momento (feito, minutos, linha justa, insight,
// sinal da aba Ao vivo, chance de blowout/clutch). Depois do jogo, busca o box da ESPN e fecha: G / P / devolvida.
// Botão "Baixar" exporta o JSON (para analisar no PC e medir se os sinais ganham da linha ao vivo da casa).
import { esc } from "./formato.js";
import { ESTATS, lerBox } from "./painel.js";

const CHAVE = "traderpoly.entradas";
const num = (v, c = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
// ESTATS é lido só dentro das funções (painel.js e este módulo se importam um ao outro)
const NOME = new Proxy({}, { get: (_, k) => ESTATS.find((e) => e[0] === k)?.[1] ?? k });

export function lerEntradas() {
  try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch { return []; }
}
function gravar(L) {
  try { localStorage.setItem(CHAVE, JSON.stringify(L)); return true; } catch { return false; }
}

// resultado de uma entrada pelo valor final: lucro por unidade apostada
export function fechar(e, final) {
  if (final == null) return e;
  const d = e.lado === "O" ? final - e.linha : e.linha - final;
  const res = d > 0 ? "G" : d < 0 ? "P" : "D";
  return { ...e, final, res, lucro: res === "G" ? e.odd - 1 : res === "P" ? -1 : 0 };
}

let CTX = null, FORM_JOGO = null, BUSCADO = new Map();

// formulário (montado de novo só quando muda o jogo, para não apagar o que está sendo digitado)
function formHtml(ctx) {
  const ops = Object.entries(ctx.jogadores).sort((a, b) => a[1].time.localeCompare(b[1].time) || a[1].nome.localeCompare(b[1].nome))
    .map(([aid, j]) => `<option value="${aid}">${esc(j.time)} · ${esc(j.nome)}</option>`).join("");
  return `<div class="panel reg-form"><h2 style="margin:0 0 8px">Registrar minha entrada</h2>
    <div class="reg-grid">
      <label>Jogador<select id="rg-j">${ops}</select></label>
      <label>Estatística<select id="rg-k">${ESTATS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
      <label>Lado<select id="rg-l"><option value="U">Under</option><option value="O">Over</option></select></label>
      <label>Linha<input id="rg-linha" type="text" inputmode="decimal" autocomplete="off" placeholder="ex.: 24,5"></label>
      <label>Odd<input id="rg-odd" type="text" inputmode="decimal" autocomplete="off" placeholder="ex.: 1,85"></label>
      <label>Casa<input id="rg-casa" type="text" value="CampeonBet"></label>
    </div>
    <button type="button" id="rg-ok">Registrar</button> <span id="rg-msg" class="muted"></span>
    <p class="hint" style="margin:6px 0 0">Clique numa célula da tabela para preencher jogador e estatística. Guarda junto o que o Painel mostrava na hora (feito, minutos, linha justa, insight, sinal). Fica neste navegador: use "Baixar" para levar a outro aparelho ou me mandar.</p></div>`;
}

function listaHtml() {
  const L = lerEntradas();
  if (!L.length) return `<p class="muted">Nenhuma entrada registrada ainda.</p>`;
  const fechadas = L.filter((e) => e.res);
  const resumo = (xs) => {
    if (!xs.length) return "–";
    const lucro = xs.reduce((t, e) => t + e.lucro, 0);
    return `${xs.filter((e) => e.res === "G").length}/${xs.length} · ${lucro >= 0 ? "+" : "−"}${num(Math.abs(lucro), 2)} un · ROI ${num((100 * lucro) / xs.length, 1)}%`;
  };
  const comSinal = fechadas.filter((e) => e.sinal), semSinal = fechadas.filter((e) => !e.sinal);
  const linhas = [...L].reverse().map((e) => {
    const cor = e.res === "G" ? "var(--good)" : e.res === "P" ? "var(--bad)" : "var(--ink-3)";
    const st = e.res ? `<b style="color:${cor}">${e.res === "G" ? "ganhou" : e.res === "P" ? "perdeu" : "devolvida"}</b> (${e.final})` : `<span class="muted">aberta</span>`;
    const ctx = [e.justa != null ? `justa ${num(e.justa)}` : "", e.sinal ? `sinal ${e.sinal.lado === "O" ? "Over" : "Under"} alvo ${num(e.sinal.alvo)}` : "", e.insight ? `insight ${e.insight.z > 0 ? "↑" : "↓"}` : ""].filter(Boolean).join(" · ");
    return `<tr><td>${esc(e.data)}<br><small class="muted">${esc(e.quando || "")}</small></td><td><b>${esc(e.nome)}</b><br><small class="muted">${esc(e.jogo)}</small></td>
      <td>${NOME[e.k]} ${e.lado === "O" ? "Over" : "Under"} ${num(e.linha)} @ ${num(e.odd, 2)}<br><small class="muted">${esc(e.casa || "")} · tinha ${e.feito ?? "–"} em ${num(e.min, 0)} min</small></td>
      <td><small>${esc(ctx)}</small></td><td>${st}</td><td><button type="button" class="rg-del" data-id="${e.id}" title="apagar">×</button></td></tr>`;
  }).join("");
  return `<div class="panel"><h2 style="margin:0 0 6px">Minhas entradas (${L.length})</h2>
    <p style="margin:0 0 6px">Fechadas: <b>${resumo(fechadas)}</b> &nbsp;|&nbsp; com sinal do Painel: ${resumo(comSinal)} &nbsp;|&nbsp; sem sinal: ${resumo(semSinal)}</p>
    <div class="tbl-wrap"><table class="estreita" style="max-width:none"><thead><tr><th>Quando</th><th>Jogador</th><th>Entrada</th><th>Painel na hora</th><th>Resultado</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
    <button type="button" id="rg-baixar">Baixar (JSON)</button></div>`;
}

function registrar(box) {
  const aid = box.querySelector("#rg-j").value, k = box.querySelector("#rg-k").value, lado = box.querySelector("#rg-l").value;
  const linha = Number(String(box.querySelector("#rg-linha").value).replace(",", "."));
  const odd = Number(String(box.querySelector("#rg-odd").value).replace(",", "."));
  const msg = box.querySelector("#rg-msg");
  if (!CTX || !aid || !isFinite(linha) || !(odd > 1)) { msg.textContent = "Preencha a linha e a odd (maior que 1)."; return; }
  const j = CTX.jogadores[aid];
  const e = j.est[k] || {};
  const sinal = CTX.sinais[`${aid}|${k}`];
  const ins = j.ins?.[k];
  const nova = {
    id: Date.now().toString(36), data: CTX.data, jogo_id: CTX.jogo_id, jogo: CTX.jogo, quando: CTX.quando, t: CTX.t, margem: j.margem,
    aid, nome: j.nome, time: j.time, k, lado, linha, odd, casa: box.querySelector("#rg-casa").value.trim(), registrada: new Date().toISOString(),
    feito: e.feito, min: j.min, justa: e.justa, pre: e.pre, chance: CTX.chance?.[j.time] || null,
    insight: ins ? { z: ins.z, u: ins.u, ini: ins.ini, dim: ins.dim, nivel: ins.nivel, corte: ins.corte } : null,
    sinal: sinal ? { lado: sinal.ef > 0 ? "O" : "U", ef: +sinal.ef.toFixed(3), alvo: +(sinal.justa + sinal.uj).toFixed(2), fator: +sinal.fator.toFixed(2) } : null,
  };
  const L = lerEntradas();
  L.push(nova);
  msg.textContent = gravar(L) ? `Registrada: ${j.nome} ${NOME[k]} ${lado === "O" ? "Over" : "Under"} ${num(linha)} @ ${num(odd, 2)}.` : "Não consegui gravar neste navegador.";
  box.querySelector("#rg-linha").value = "";
  box.querySelector("#rg-odd").value = "";
  box.querySelector("#rg-lista").innerHTML = listaHtml();
  ligarLista(box);
}

function ligarLista(box) {
  for (const b of box.querySelectorAll(".rg-del")) b.onclick = () => {
    if (!confirm("Apagar esta entrada?")) return;
    gravar(lerEntradas().filter((e) => e.id !== b.dataset.id));
    box.querySelector("#rg-lista").innerHTML = listaHtml();
    ligarLista(box);
  };
  const bx = box.querySelector("#rg-baixar");
  if (bx) bx.onclick = () => {
    const blob = new Blob([JSON.stringify(lerEntradas(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `entradas_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
}

// chamado a cada atualização do Painel com o contexto do jogo aberto
export function atualizarRegistro(box, ctx) {
  CTX = ctx;
  if (!ctx) return;
  if (FORM_JOGO !== ctx.jogo_id || !box.querySelector("#rg-ok")) {
    FORM_JOGO = ctx.jogo_id;
    box.innerHTML = `${formHtml(ctx)}<div id="rg-lista"></div>`;
    box.querySelector("#rg-ok").onclick = () => registrar(box);
  }
  box.querySelector("#rg-lista").innerHTML = listaHtml();
  ligarLista(box);
}

// clique numa célula do Painel preenche jogador e estatística
export function preencher(box, aid, k) {
  const j = box.querySelector("#rg-j"), s = box.querySelector("#rg-k");
  if (!j || !s) return;
  j.value = aid;
  s.value = k;
  const sinal = CTX?.sinais?.[`${aid}|${k}`];
  if (sinal) box.querySelector("#rg-l").value = sinal.ef > 0 ? "O" : "U";
  box.querySelector("#rg-linha").focus();
  box.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

// fecha as entradas abertas de jogos encerrados (no máximo 3 jogos por atualização; cada jogo de novo só após 10 min)
export async function resolverPendentes(espn, sumAtual) {
  const L = lerEntradas();
  const abertos = [...new Set(L.filter((e) => !e.res).map((e) => e.jogo_id))];
  let mudou = false;
  for (const id of abertos.slice(0, 3)) {
    let s = sumAtual?.header?.id === id ? sumAtual : null;
    if (!s) {
      if (Date.now() - (BUSCADO.get(id) || 0) < 600e3) continue;
      BUSCADO.set(id, Date.now());
      try { s = await espn(`/summary?event=${id}`); } catch { continue; }
    }
    if (!s?.header?.competitions?.[0]?.status?.type?.completed) continue;
    const box = lerBox(s);
    for (let i = 0; i < L.length; i++) {
      const e = L[i];
      if (e.res || e.jogo_id !== id) continue;
      const b = box[e.aid];
      if (!b || b.dnp) { L[i] = { ...e, res: "D", final: null, lucro: 0, obs: "não jogou" }; mudou = true; continue; }
      L[i] = fechar(e, b[e.k]);
      mudou = true;
    }
  }
  if (mudou) gravar(L);
  return mudou;
}
