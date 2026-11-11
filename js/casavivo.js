// Aba "Casa × Painel" de padroes.html (11/11/2026, pedido do usuário): as odds AO VIVO que o coletor (js/campeon.user.js)
// capturou na CampeonBet (e nas outras casas do coletor) comparadas com a linha justa do Painel naquele momento.
// A coleta chega pelo endereço (#campeon=…, botão "Abrir a comparação" do coletor v1.18) ou pela aba Casas × DK de
// props.html (mesmo localStorage "casas-coleta"; esta aba percebe a gravação na hora pelo evento "storage").
// Mostra só a linha justa do Painel (feito + ritmo × minutos que faltam, `estimar`) − a linha da casa (usuário, 11/11: "é só
// isso"; a 1ª versão com chance/EV/desvio era informação demais). Combos P+A/P+R/R+A = soma das justas. NÃO calibrado.
import { esc } from "./formato.js";
import { nomeChave } from "./core.js";
import { CASAS, STATS, OUTRO, PARCIAL, palavras, temNome } from "./campeon.js";
import { ESTATS, relogio, lerBox, estimar, ajusteQ4, minEspDe, sinaisJogo, agoraDe, placarProj, estrelasDe, quentesDoJogo, chanceLinha, chanceLinhaPre } from "./painel.js";

const DE_TIPO = { points: ["pts"], rebounds: ["reb"], assists: ["ast"], threes: ["tpm"], pra: ["pra"], pa: ["pts", "ast"], pr: ["pts", "reb"], ra: ["reb", "ast"] };
const NOME_K = { pts: "Pontos", reb: "Rebotes", ast: "Assistências", tpm: "Cestas de 3", pra: "PRA", pa: "P+A", pr: "P+R", ra: "R+A" };
const VELHA_MIN = 3;
const ST = { resumos: new Map(), dados: null, carregando: false };
const num = (v, c = 1) => (v == null || !Number.isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
const hhmm = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function lerColetas() {
  try { return JSON.parse(localStorage.getItem("casas-coleta") || "null") || {}; } catch { return {}; }
}

// jogador do Painel citado no mercado (nome inteiro colado no texto ou as palavras do nome em qualquer ordem)
function acharJog(jogadores, texto) {
  const chave = nomeChave(texto), ws = new Set(palavras(texto));
  return jogadores.find((j) => { const k = nomeChave(j.nome); return k.length >= 6 && chave.includes(k); })
    || jogadores.find((j) => temNome(ws, palavras(j.nome)));
}

// linhas da coleta → [{casa, g, j, k, L, O, U, em, mercado}]; o jogo é o da análise do dia com mais jogadores citados
function linhasDaColeta(coletas, dia) {
  const out = [], sem = [];
  for (const [casa, co] of Object.entries(coletas)) for (const ev of co?.eventos || []) {
    const textos = (ev.mercados || []).map((m) => m.nome + " " + (m.opcoes || []).map((o) => o.nome).join(" "));
    let g = null, max = 0;
    for (const x of dia.jogos) {
      const n = textos.filter((t) => acharJog(x.jogadores, t)).length;
      if (n > max) { max = n; g = x; }
    }
    if (!g) { if ((ev.mercados || []).length) sem.push(`${CASAS[casa] || casa}: ${ev.nome} (nenhum jogador da análise do dia)`); continue; }
    ev.mercados.forEach((m, i) => {
      const nm = m.nome.toLowerCase();
      if (PARCIAL.test(nm) || OUTRO.test(nm)) return;
      const tipo = STATS.find(([, ok]) => ok(nm))?.[0];
      const ks = DE_TIPO[tipo];
      const j = ks && acharJog(g.jogadores, textos[i]);
      if (!j) { sem.push(`${CASAS[casa] || casa}: ${m.nome}`); return; }
      for (const p of m.pares || []) out.push({ casa, g, j, k: ks.length === 1 ? ks[0] : tipo, ks, L: p.L, O: p.O, U: p.U, em: ev.em || co.em, mercado: m.nome.split(" | ")[0] });
    });
  }
  // escada (várias linhas do mesmo jogador × estatística na mesma casa): fica a linha principal da casa, a de odds mais
  // equilibradas — nunca a de maior EV escolhida a dedo (garimparia o erro do modelo)
  const grupos = new Map();
  for (const r of out) { const k = `${r.casa}|${r.g.id}|${r.j.aid}|${r.k}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  const linhas = [...grupos.values()].map((gr) => {
    const r = gr.reduce((a, b) => (Math.abs(1 / b.O - 1 / b.U) < Math.abs(1 / a.O - 1 / a.U) ? b : a));
    return { ...r, escada: gr.length };
  });
  return { linhas, sem: [...new Set(sem)] };
}

async function carregarDados() {
  if (ST.dados) return ST.dados;
  const ler = (u) => (u.includes("/-.json") ? Promise.resolve({}) : fetch(u, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}))); // insights antigos desligados (11/11)
  const [cm, ins, jog, pol, tim, cal] = await Promise.all(["chance_minuto", "-", "-", "cenarios", "-", "calibra_justa"].map((n) => ler(`data/padroes/${n}.json`)));
  return (ST.dados = { cm, ins, jog, pol, tim, cal });
}

function placarHtml(g, s) {
  const comp = s?.header?.competitions?.[0];
  if (!comp) return `<b>${esc(g.fora)} @ ${esc(g.casa)}</b> <span class="muted">(sem placar da ESPN agora)</span>`;
  const sc = Object.fromEntries(comp.competitors.map((c) => [c.team.abbreviation, c.score]));
  return `<b>${esc(g.fora)} ${sc[g.fora] ?? ""} × ${sc[g.casa] ?? ""} ${esc(g.casa)}</b> <span class="muted">${esc(comp.status?.type?.shortDetail || "")}</span>`;
}

// lado de maior valor esperado: chance de acerto (ao vivo: dispersão dele; antes do jogo: odd da DK) e EV com a odd da casa
function chanceHtml(ch, evO, evU) {
  if (ch.semDK) return `<span class="muted" title="antes do jogo a chance vem da DraftKings; sem linha dela não há como estimar vantagem">sem DK</span>`;
  const over = (evO ?? -9) >= (evU ?? -9);
  const p = over ? ch.over : ch.under, ev = over ? evO : evU;
  if (ev == null) return "–";
  const cor = over ? "var(--sig-o)" : "var(--sig-u)";
  return `<span style="color:${cor}">${over ? "Mais" : "Menos"} ${Math.round(100 * p)}%</span> · <b style="color:${ev > 0 ? cor : "var(--ink-3)"}">EV ${ev > 0 ? "+" : "−"}${Math.round(Math.abs(100 * ev))}%</b>${ch.dk ? ` <span class="muted" title="antes do jogo a chance vem da odd sem margem da DraftKings">DK</span>` : ""}`;
}

function jogoHtml(g, s, linhas, d) {
  const comp = s?.header?.competitions?.[0];
  const st = comp?.status;
  const rel = relogio(st);
  const box = lerBox(s);
  const placar = Object.fromEntries((comp?.competitors || []).map((c) => [c.team.abbreviation, Number(c.score) || 0]));
  const margem = (t) => (comp ? placar[t] - (Object.entries(placar).find(([x]) => x !== t)?.[1] ?? 0) : null);
  const est = new Map();
  const quentes = quentesDoJogo(g, box);
  for (const j of g.jogadores) {
    const b = box[j.aid];
    est.set(j.aid, { b, x: estimar(j, b, rel, ajusteQ4(minEspDe(j), margem(j.time), rel, d.pol?.times?.[j.time]), agoraDe(s?.plays || [], j.aid, b, rel, st), { tab: d.cal, pm: placarProj(g, j.time, margem(j.time), rel), rank: estrelasDe(g)[j.aid], quente: quentes[j.aid] }) });
  }
  let sinais = [];
  try { sinais = sinaisJogo(g, s, d); } catch { /* sem sinais */ }
  const sinalDe = (aid, k) => sinais.find((x) => x.j.aid === aid && x.k === k);
  const idade = Math.round((Date.now() - Math.min(...linhas.map((r) => r.em || Date.now()))) / 60e3);
  const rows = linhas.map((r) => {
    const { b, x } = est.get(r.j.aid);
    if (b?.dnp) return { r, fora: "não está jogando" };
    if ((b?.pf ?? 0) >= 6) return { r, fora: "eliminado (6 faltas)" };
    const partes = r.ks.map((k) => x.est[k]);
    if (partes.some((e) => e?.justa == null)) return { r, fora: "sem linha pré-jogo para a base" };
    const feito = partes.reduce((t, e) => t + e.feito, 0), justa = partes.reduce((t, e) => t + e.justa, 0);
    const sn = r.ks.length === 1 ? sinalDe(r.j.aid, r.k) : null;
    // chance de acerto pela dispersão (dele e da liga) em volta da linha justa; PRA usa a dispersão própria do PRA
    const ks = r.k === "pra" ? ["pra"] : r.ks;
    const mus = r.k === "pra" ? [["pra", justa - feito]] : r.ks.map((k) => [k, x.est[k].justa - x.est[k].feito]);
    // antes do jogo: chance pela odd sem margem da DK (a dispersão sozinha perde da DK pré-jogo); ao vivo: dispersão
    const MK = { pts: "points", reb: "rebounds", ast: "assists", tpm: "threes", pra: "pra" };
    const dk = r.ks.length === 1 || r.k === "pra" ? r.j.linhas?.[MK[r.k]] : null;
    const antes = st?.type?.state !== "in" && st?.type?.state !== "post";
    const pre = antes && dk ? chanceLinhaPre(d.cal, r.j.aid, r.k, dk.l, dk.over, r.L) : null;
    // antes do jogo sem linha da DK não há como estimar vantagem (a dispersão sozinha perdeu da DK): sem chance
    const ch = antes ? pre || { semDK: true, dp: chanceLinha(d.cal, r.j.aid, 0, mus, feito, r.L).dp } : chanceLinha(d.cal, r.j.aid, rel.t, mus, feito, r.L);
    const evO = r.O && !ch.semDK ? ch.over * r.O + ch.push - 1 : null, evU = r.U && !ch.semDK ? ch.under * r.U + ch.push - 1 : null;
    return { r, feito, justa, sn, ch, evO, evU, ks };
  });
  // 11/11 (usuário): só o que importa — linha justa do Painel − linha da casa; ordem = maior diferença
  const ok = rows.filter((w) => !w.fora).map((w) => ({ ...w, dif: w.justa - w.r.L })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  const fora = rows.filter((w) => w.fora);
  const corpo = ok.map(({ r, justa, dif, sn, ch, evO, evU }) => {
    const cor = dif > 0 ? "var(--sig-o)" : "var(--sig-u)";
    const sinal = sn ? ` <span title="sinal do Painel: alvo ${num(justa + sn.uj)}" style="color:${sn.ef > 0 ? "var(--sig-o)" : "var(--sig-u)"}">${sn.ef > 0 ? "↑" : "↓"} alvo ${num(justa + sn.uj)}</span>` : "";
    return `<tr><td><b>${esc(r.j.nome)}</b> <span class="muted">${NOME_K[r.k]}</span></td>
      <td class="n">${num(r.L)} <span class="muted">· ${num(r.O, 2)} / ${num(r.U, 2)}</span></td>
      <td class="n"><b>${num(justa)}</b> <span class="muted">± ${num(ch.dp)}</span>${sinal}</td>
      <td class="n"><b style="color:${cor}">${dif > 0 ? "▲ +" : "▼ −"}${num(Math.abs(dif))}</b></td>
      <td class="n">${chanceHtml(ch, evO, evU)}</td></tr>`;
  }).join("");
  return `<div class="panel"><p style="margin:0 0 6px">${placarHtml(g, s)}${linhas[0]?.em ? ` <span class="muted">· odds das ${hhmm(Math.min(...linhas.map((r) => r.em || Date.now())))}</span>` : ""}</p>
    ${idade > VELHA_MIN && st?.type?.state === "in" ? `<p class="banner">Odds capturadas há ${idade} min — o jogo andou desde então. Capture de novo.</p>` : ""}
    ${ok.length ? `<div class="tbl-wrap"><table class="props-tab campeon-tab"><thead><tr><th>Jogador</th><th class="n">Casa<small>linha · Mais / Menos</small></th><th class="n">Linha justa<small>Painel, agora</small></th><th class="n">Justa − linha</th><th class="n">Chance · valor<small>lado de maior valor esperado com a odd da casa</small></th></tr></thead><tbody>${corpo}</tbody></table></div>` : ""}
    ${fora.length ? `<p class="muted">Sem conta: ${fora.map((w) => `${esc(w.r.j.nome)} ${NOME_K[w.r.k]} (${w.fora})`).join(" · ")}</p>` : ""}</div>`;
}

export async function mostrarCasaVivo(el, dia, espn) {
  if (!dia || ST.carregando || document.hidden) return;
  ST.carregando = true;
  try {
    const coletas = lerColetas();
    const { linhas, sem } = linhasDaColeta(coletas, dia);
    const d = await carregarDados();
    const jogos = dia.jogos.filter((g) => linhas.some((r) => r.g.id === g.id));
    await Promise.all(jogos.map(async (g) => {
      if (ST.resumos.get(g.id)?.header?.competitions?.[0]?.status?.type?.completed) return;
      try { ST.resumos.set(g.id, await espn(`/summary?event=${g.id}`)); } catch { /* fica com o anterior */ }
    }));
    const casas = Object.entries(coletas).filter(([, co]) => co?.eventos?.length);
    const resumo = casas.map(([c, co]) => `<b>${esc(CASAS[c] || c)}</b>: captura das ${hhmm(co.em)} · ${co.eventos.length} jogo(s) · ${linhas.filter((r) => r.casa === c).length} linhas casadas com o Painel`).join(" · ");
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    el.innerHTML = `<section class="panel"><h2>Casa × Painel</h2>
      <p class="muted">Linha da casa (capturada pelo coletor) × <b>linha justa do Painel agora</b> (o que ele já fez + ritmo × minutos que faltam — o mesmo número da aba Painel). <b>Justa − linha</b>: ▲ azul = justa acima da linha da casa, ▼ laranja = abaixo; ordem = maior diferença. <b>± desvio</b> e <b>chance</b>: ao vivo, o que falta é tratado como contagem com a dispersão própria do jogador (concentrado × tudo-ou-nada, medida nos jogos de 2024-27) — com a mesma projeção, quem é concentrado acerta mais linhas baixas. <b>Antes do jogo</b> a chance vem da odd sem margem da DraftKings (marca "DK"): no teste de 11/11 a nossa dispersão com a linha como média perdeu da DK antes do jogo. EV = chance × odd − 1. Na casa: capture (D) e clique em <b>"Abrir a comparação"</b> (coletor 1.18).</p>
      ${casas.length ? `<p class="muted">${resumo} · atualizado às ${hora} · <a href="#" id="cv-limpar">limpar as coletas</a></p>` : `<div class="vazio"><b>Nenhuma captura ainda.</b><span>Capture na casa com o coletor e abra no Painel.</span></div>`}
      ${jogos.map((g) => jogoHtml(g, ST.resumos.get(g.id), linhas.filter((r) => r.g.id === g.id), d)).join("")}
      ${sem.length ? `<details><summary class="muted">${sem.length} mercados sem par (jogador fora da análise do dia, estatística sem projeção ou mercado parcial)</summary><p class="muted">${sem.slice(0, 150).map(esc).join(" · ")}</p></details>` : ""}
    </section>`;
    el.querySelector("#cv-limpar")?.addEventListener("click", (e) => {
      e.preventDefault();
      try { localStorage.removeItem("casas-coleta"); } catch { /* sem armazenamento */ }
      ST.carregando = false;
      mostrarCasaVivo(el, dia, espn);
    });
  } finally { ST.carregando = false; }
}
