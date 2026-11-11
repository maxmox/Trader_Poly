// Aba "Casa × Painel" de padroes.html (11/11/2026, pedido do usuário): as odds AO VIVO que o coletor (js/campeon.user.js)
// capturou na CampeonBet (e nas outras casas do coletor) comparadas com a linha justa do Painel naquele momento.
// A coleta chega pelo endereço (#campeon=…, botão "Abrir no Painel" do coletor v1.17) ou pela aba Casas × DK de
// props.html (mesmo localStorage "casas-coleta"; esta aba percebe a gravação na hora pelo evento "storage").
// Conta: linha justa = a do Painel (feito + ritmo × minutos que faltam); desvio = C·√(o que ainda falta produzir),
// C da simulação do Painel (09/11, nba_pbp/simular_painel.py: pontos/PRA 1,9, rebotes 1,2, assist. 1,1, 3PM 1,0 — a normal
// calibrou; P+A/P+R/R+A sem medida própria). Chance do Over na linha da casa → EV = chance × odd − 1 de cada lado.
// Com sinal do Painel, mostra também a chance pelo alvo (linha justa + efeito do insight). NÃO calibrado contra linhas ao vivo.
import { esc } from "./formato.js";
import { nomeChave } from "./core.js";
import { CASAS, STATS, OUTRO, PARCIAL, palavras, temNome } from "./campeon.js";
import { ESTATS, relogio, lerBox, estimar, ajusteQ4, minEspDe, sinaisJogo } from "./painel.js";

const C = { pts: 1.9, reb: 1.2, ast: 1.1, tpm: 1.0, pra: 1.9, pa: 1.8, pr: 1.8, ra: 1.4 };
const DE_TIPO = { points: ["pts"], rebounds: ["reb"], assists: ["ast"], threes: ["tpm"], pra: ["pra"], pa: ["pts", "ast"], pr: ["pts", "reb"], ra: ["reb", "ast"] };
const NOME_K = { pts: "Pontos", reb: "Rebotes", ast: "Assistências", tpm: "Cestas de 3", pra: "PRA", pa: "P+A", pr: "P+R", ra: "R+A" };
const MIN_EV = 0.05, VELHA_MIN = 3;
const ST = { resumos: new Map(), dados: null, carregando: false };
const num = (v, c = 1) => (v == null || !Number.isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
const pc = (v) => (v == null || !Number.isFinite(v) ? "–" : `${v >= 0 ? "+" : "−"}${num(Math.abs(100 * v), 1)}%`);
const hhmm = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// normal padrão (Abramowitz-Stegun 26.2.17)
function fi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - d : d;
}
// chances de Over, Under e devolução na linha L (linha inteira: o valor exato devolve)
function chances(feito, justa, L, c) {
  if (feito > L) return { o: 1, u: 0, d: 0 };
  const sd = c * Math.sqrt(Math.max(justa - feito, 0.25));
  const o = 1 - fi((Math.floor(L) + 0.5 - justa) / sd);
  const u = feito >= Math.ceil(L) && L % 1 === 0 ? 0 : fi((Math.ceil(L) - 0.5 - justa) / sd);
  return { o, u, d: Math.max(0, 1 - o - u) };
}
const evDe = (ch, O, U) => ({ o: ch.o * O + ch.d - 1, u: ch.u * U + ch.d - 1 });

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
  const ler = (u) => fetch(u, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
  const [cm, ins, jog, pol, tim] = await Promise.all(["chance_minuto", "insights_painel", "insights_jogador", "cenarios", "insights_time"].map((n) => ler(`data/padroes/${n}.json`)));
  return (ST.dados = { cm, ins, jog, pol, tim });
}

function placarHtml(g, s) {
  const comp = s?.header?.competitions?.[0];
  if (!comp) return `<b>${esc(g.fora)} @ ${esc(g.casa)}</b> <span class="muted">(sem placar da ESPN agora)</span>`;
  const sc = Object.fromEntries(comp.competitors.map((c) => [c.team.abbreviation, c.score]));
  return `<b>${esc(g.fora)} ${sc[g.fora] ?? ""} × ${sc[g.casa] ?? ""} ${esc(g.casa)}</b> <span class="muted">${esc(comp.status?.type?.shortDetail || "")}</span>`;
}

function jogoHtml(g, s, linhas, d) {
  const comp = s?.header?.competitions?.[0];
  const st = comp?.status;
  const rel = relogio(st);
  const box = lerBox(s);
  const placar = Object.fromEntries((comp?.competitors || []).map((c) => [c.team.abbreviation, Number(c.score) || 0]));
  const margem = (t) => (comp ? placar[t] - (Object.entries(placar).find(([x]) => x !== t)?.[1] ?? 0) : null);
  const est = new Map();
  for (const j of g.jogadores) {
    const b = box[j.aid];
    est.set(j.aid, { b, x: estimar(j, b, rel, ajusteQ4(minEspDe(j), margem(j.time), rel, d.pol?.times?.[j.time])) });
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
    const ch = chances(feito, justa, r.L, C[r.k]);
    const ev = evDe(ch, r.O, r.U);
    const sn = r.ks.length === 1 ? sinalDe(r.j.aid, r.k) : null;
    const chA = sn ? chances(feito, justa + sn.uj, r.L, C[r.k]) : null;
    const evA = chA ? evDe(chA, r.O, r.U) : null;
    return { r, b, x, feito, justa, ch, ev, sn, chA, evA, melhor: Math.max(ev.o, ev.u) };
  });
  const ok = rows.filter((w) => !w.fora).sort((a, b) => b.melhor - a.melhor);
  const fora = rows.filter((w) => w.fora);
  const evTd = (v) => `<td class="n${v >= MIN_EV ? " ev-bom" : ""}">${pc(v)}</td>`;
  const corpo = ok.map((w) => {
    const { r, b, x, feito, justa, ch, ev, sn, chA, evA } = w;
    const bom = w.melhor >= MIN_EV;
    const sinal = sn ? `<b style="color:${sn.ef > 0 ? "var(--sig-o)" : "var(--sig-u)"}">${sn.ef > 0 ? "↑ Over" : "↓ Under"}</b> alvo ${num(justa + sn.uj)}<small>chance Over ${num(100 * chA.o, 0)}% · EV ${pc(evA.o)} / ${pc(evA.u)}</small>` : `<span class="muted">–</span>`;
    return `<tr${bom ? ' class="defasada"' : ""}><td><b>${esc(r.j.nome)}</b><small>${esc(r.j.time)} · ${NOME_K[r.k]} · ${esc(CASAS[r.casa] || r.casa)}${r.escada > 1 ? ` (escada de ${r.escada}, linha principal)` : ""}</small></td>
      <td class="n"><b>${num(r.L)} · ${num(r.O, 2)} / ${num(r.U, 2)}</b><small>captura ${r.em ? hhmm(r.em) : "?"}</small></td>
      <td class="n">${num(feito, 0)}<small>${num(b?.min ?? 0, 0)} de ~${num(x.minEsp, 0)} min</small></td>
      <td class="n"><b>${num(justa)}</b><small>± ${num(C[r.k] * Math.sqrt(Math.max(justa - feito, 0.25)))}</small></td>
      <td class="n">${num(100 * ch.o, 0)}%</td>${evTd(ev.o)}${evTd(ev.u)}<td>${sinal}</td></tr>`;
  }).join("");
  return `<div class="panel"><p style="margin:0 0 6px">${placarHtml(g, s)}</p>
    ${idade > VELHA_MIN && st?.type?.state === "in" ? `<p class="banner">Odds capturadas há ${idade} min — o jogo andou desde então. Capture de novo antes de comparar.</p>` : ""}
    ${ok.length ? `<div class="tbl-wrap"><table class="props-tab campeon-tab"><thead><tr><th>Jogador</th><th class="n">Casa<small>linha · Mais / Menos</small></th><th class="n">Feito<small>agora</small></th><th class="n">Linha justa<small>Painel · desvio</small></th><th class="n">Chance Over<small>nossa</small></th><th class="n">EV Mais</th><th class="n">EV Menos</th><th>Sinal do Painel</th></tr></thead><tbody>${corpo}</tbody></table></div>` : ""}
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
      <p class="muted">As odds que o coletor capturou na casa comparadas com a <b>linha justa do Painel agora</b> (feito + ritmo × minutos que faltam, com o Q4 ajustado pelo placar). A chance do Over sai da linha justa com o desvio medido na simulação do Painel (pontos/PRA 1,9·√(o que falta), rebotes 1,2, assist. 1,1, 3PM 1,0; P+A/P+R/R+A sem medida própria); <b>EV</b> = chance × odd − 1 (verde = ${num(100 * MIN_EV, 0)}%+). Com sinal do Painel, a chance pelo alvo (linha justa + efeito do insight) vem junto. Estimativa: <b>não calibrada contra linhas ao vivo</b> — a casa sabe coisas que o Painel não sabe (lesão no jogo, quem fecha o jogo). Só jogadores da análise do dia.</p>
      <p class="muted">Como usar: deixe esta aba aberta; na casa, capture a tela (D) e clique em <b>"Abrir no Painel"</b> (coletor 1.17) — ou em "Abrir a comparação": a aba de props grava e esta atualiza sozinha. Odds ao vivo mudam rápido: compare logo depois de capturar.</p>
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
