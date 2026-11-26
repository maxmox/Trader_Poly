// Aba "Casa × Painel" de padroes.html (11/11/2026, pedido do usuário): as odds AO VIVO que o coletor (js/campeon.user.js)
// capturou na CampeonBet (e nas outras casas do coletor) comparadas com a linha justa do Painel naquele momento.
// A coleta chega pelo endereço (#campeon=…, botão "Abrir a comparação" do coletor v1.19) ou pela aba Casas × DK de
// props.html (mesmo localStorage "casas-coleta"; esta aba percebe a gravação na hora pelo evento "storage").
// Mostra só a linha justa do Painel (feito + ritmo × minutos que faltam, `estimar`) − a linha da casa (usuário, 11/11: "é só
// isso"; a 1ª versão com chance/EV/desvio era informação demais). Combos P+A/P+R/R+A = soma das justas. NÃO calibrado.
import { esc } from "./formato.js";
import { nomeChave } from "./core.js";
import { CASAS, STATS, OUTRO, PARCIAL, palavras, temNome, porSobrenome } from "./campeon.js";
import { ESTATS, relogio, lerBox, estimar, ajusteQ4, minEspDe, sinaisJogo, agoraDe, placarProj, estrelasDe, quentesDoJogo, chanceLinha, chanceLinhaPre, confMin, seloMin, matchupChip, ddChip, ddFotos, horaAnalise, rotacaoInfo, rotacaoAgora } from "./painel.js";

const DE_TIPO = { points: ["pts"], rebounds: ["reb"], assists: ["ast"], threes: ["tpm"], pra: ["pra"], pa: ["pts", "ast"], pr: ["pts", "reb"], ra: ["reb", "ast"] };
const NOME_K = { pts: "Pontos", reb: "Rebotes", ast: "Assistências", tpm: "Cestas de 3", pra: "PRA", pa: "P+A", pr: "P+R", ra: "R+A" };
const VELHA_MIN = 3;
const ST = { resumos: new Map(), dados: null, carregando: false };
// ordem da tabela (12/11/2026, usuário: "ordenar por EV, as de maior EV no topo"): ev (padrão) | dif | nome
let ORDEM = (() => { try { return localStorage.getItem("traderpoly.casa.ordem") || "ev"; } catch { return "ev"; } })();
const EV_SUSPEITO = 0.3;
const evMax = (w) => Math.max(w.evO ?? -Infinity, w.evU ?? -Infinity);
const num = (v, c = 1) => (v == null || !Number.isFinite(v) ? "–" : Number(v).toFixed(c).replace(".", ","));
const hhmm = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function lerColetas() {
  try { return JSON.parse(localStorage.getItem("casas-coleta") || "null") || {}; } catch { return {}; }
}

// jogador do Painel citado no mercado (nome inteiro colado no texto ou as palavras do nome em qualquer ordem)
function acharJog(jogadores, texto) {
  const chave = nomeChave(texto), ws = new Set(palavras(texto));
  return jogadores.find((j) => { const k = nomeChave(j.nome); return k.length >= 6 && chave.includes(k); })
    || jogadores.find((j) => temNome(ws, palavras(j.nome)))
    || porSobrenome(jogadores.map((j) => [j, palavras(j.nome)]), ws);
}

// linhas da coleta → [{casa, g, j, k, L, O, U, em, mercado}]; o jogo é o da análise do dia com mais jogadores citados
function linhasDaColeta(coletas, dia) {
  const out = [], sem = [];
  for (const [casa, co] of Object.entries(coletas)) for (const ev of co?.eventos || []) {
    const textos = (ev.mercados || []).map((m) => m.nome + " " + (m.opcoes || []).map((o) => o.nome).join(" "));
    // captura velha (> 8 h) não entra: jogo de ontem pode cair no de hoje pelo sobrenome (13/11: Overtime das 00:08,
    // "Bridges" de CHA virou Mikal Bridges do NY com EV +42%)
    if (Date.now() - (ev.em || co.em || 0) > 8 * 3600e3) { sem.push(`${CASAS[casa] || casa}: ${ev.nome} (captura antiga, capture de novo)`); continue; }
    // o jogo é escolhido só por nome completo (sem o sobrenome) e precisa de 2+ jogadores dele
    const estrito = (js, t) => { const ch = nomeChave(t), ws = new Set(palavras(t)); return js.some((j) => { const k = nomeChave(j.nome); return (k.length >= 6 && ch.includes(k)) || temNome(ws, palavras(j.nome)); }); };
    let g = null, max = 0;
    for (const x of dia.jogos) {
      const n = textos.filter((t) => estrito(x.jogadores, t)).length;
      if (n > max) { max = n; g = x; }
    }
    if (max < 2) g = null;
    if (!g) { if ((ev.mercados || []).length) sem.push(`${CASAS[casa] || casa}: ${ev.nome} (nenhum jogador da análise do dia)`); continue; }
    ev.mercados.forEach((m, i) => {
      const nm = m.nome.toLowerCase();
      if (PARCIAL.test(nm) || OUTRO.test(nm)) return;
      const tipo = STATS.find(([, ok]) => ok(nm))?.[0];
      const ks = DE_TIPO[tipo];
      const j = ks && acharJog(g.jogadores, textos[i]);
      if (!j) { sem.push(`${CASAS[casa] || casa}: ${m.nome}`); return; }
      for (const p of [...(m.pares || []), ...(m.soMais || [])]) out.push({ casa, g, j, k: ks.length === 1 ? ks[0] : tipo, ks, L: p.L, O: p.O, U: p.U, em: ev.em || co.em, mercado: m.nome.split(" | ")[0] });
    });
  }
  // escada (várias linhas do mesmo jogador × estatística na mesma casa): fica a linha principal da casa, a de odds mais
  // equilibradas — nunca a de maior EV escolhida a dedo (garimparia o erro do modelo)
  const grupos = new Map();
  for (const r of out) { const k = `${r.casa}|${r.g.id}|${r.j.aid}|${r.k}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  const linhas = [...grupos.values()].map((gr) => {
    // marco (só o Mais, Betcoin "8+") só entra se não houver linha com os dois lados; entre marcos, o de odd mais perto de 2
    const eq = (x) => (x.O && x.U ? Math.abs(1 / x.O - 1 / x.U) : 9 + Math.abs(1 / (x.O || x.U) - 0.5));
    const r = gr.reduce((a, b) => (eq(b) < eq(a) ? b : a));
    return { ...r, escada: gr.length };
  });
  return { linhas, sem: [...new Set(sem)] };
}

export function limparDadosCasa() { ST.dados = null; }

// 21/11/2026 (pedido do usuário, discreto): em quadra/banco há quanto tempo e a rotação típica (mesma conta da lateral do
// Painel): "sai ~X" / "volta ~X" só com rotação regular; ⚠ passou da saída típica (vermelho); saída em até 2 min (amarelo)
const mmss = (s) => { const x = Math.max(0, Math.round(s)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };
function rotTexto(j, rel, ag) {
  const ri = rotacaoInfo(j, rel, ag), ra = rotacaoAgora(j, rel, ag);
  let t = ag.quadra ? `em quadra há ${mmss(ag.dur)}` : `banco há ${mmss(ag.dur)}`;
  if (ag.quadra && ra?.tipo === "passou") return `<span style="color:var(--bad)">${t} · ⚠ +${mmss(ra.s)} além do normal</span>`;
  if (ag.quadra && ri?.sai != null) t += ` · sai ~${mmss(ri.sai)}`;
  if (!ag.quadra && ri?.volta != null) t += ` · volta ~${mmss(ri.volta)}`;
  return ra?.tipo === "prestes" ? `<span style="color:var(--warn)">${t}</span>` : t;
}
async function carregarDados() {
  if (ST.dados) return ST.dados;
  const ler = (u) => (u.includes("/-.json") ? Promise.resolve({}) : fetch(u, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}))); // insights antigos desligados (11/11)
  const [cm, ins, jog, pol, tim, cal, celulas, dd] = await Promise.all(["chance_minuto", "-", "-", "cenarios", "-", "calibra_justa", "calibracao/celulas", "caca_dd"].map((n) => ler(`data/padroes/${n}.json`)));
  return (ST.dados = { cm, ins, jog, pol, tim, cal, celulas, dd });
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

// Calibração da situação (23/11/2026, pedido do usuário): o jogador classificado agora — titular/reserva, com/sem linha DK,
// em quadra/banco, placar do time (até 6 / 7–14 / 15+) — e, nesta temporada, nessa mesma situação e minuto (±2 min), o
// Over contra a linha justa: real × esperado pelo modelo e a diferença (aba Calibração; celulas.json). Só informa: não
// mexe na justa nem no EV. Positivo = nessa situação a justa costuma ficar baixa (Over ganha mais que o modelo espera).
function calibSituacao(cel, k, tit, dk, quadra, mg, t, aid, time) {
  if (!cel?.c || t == null) return null;
  const am = Math.abs(mg ?? 0), pl = am <= 6 ? 0 : am < 15 ? 1 : 2;
  const arr = cel.c[`${k}|${tit ? 1 : 0}|${dk ? 1 : 0}|${quadra ? 1 : 0}|${pl}`];
  let m = 0;
  cel.grade.forEach((tc, i) => { if (Math.abs(tc - t) < Math.abs(cel.grade[m] - t)) m = i; });
  const v = arr?.[m];
  const de = (x, rot) => (x ? { n: x[0], over: x[1] / 1000, esp: x[2] / 1000, ep: x[3] / 1000, jogos: x[4], rot } : null);
  // time (23/11, usuário: "é para olhar o time e o jogador"): mesmo time, estatística e linha DK, jogo todo; no placar de agora
  // se houver 5+ jogos nessa faixa, senão qualquer placar
  const tPl = cel.time?.[`${time}|${k}|${dk ? 1 : 0}|${pl}`];
  const tTudo = cel.time?.[`${time}|${k}|${dk ? 1 : 0}|*`];
  const tm = tPl && tPl[4] >= 5 ? de(tPl, `${time}, ${dk ? "com" : "sem"} linha DK, placar ${["até 6", "7–14", "15+"][pl]}`) : de(tTudo, `${time}, ${dk ? "com" : "sem"} linha DK, qualquer placar`);
  return {
    liga: { n: v?.[0] ?? 0, over: (v?.[1] ?? 0) / 1000, esp: (v?.[2] ?? 0) / 1000, ep: (v?.[3] ?? 0) / 1000 },
    jog: de(cel.jog?.[`${aid}|${k}`], "ele, nesta estatística"), time: tm,
    tit, dk, quadra, pl, min: cel.grade[m] / 60,
  };
}
// um nível (jogador, time ou liga na situação): diferença em pp, verde/vermelho, apagado se dentro de 2 erros-padrão
function nivelHtml(rotulo, c, minN) {
  if (!c || c.n < minN) return `<span class="muted">${rotulo} –</span>`;
  const dif = 100 * (c.over - c.esp), forte = Math.abs(c.over - c.esp) >= 2 * c.ep && Math.abs(dif) >= 2;
  return `<span class="muted">${rotulo}</span> <span class="${dif > 0 ? "cal-over" : "cal-under"}${forte ? "" : " cv-cal-fraco"}">${Math.round(Math.abs(dif)) === 0 ? "0" : `${dif > 0 ? "+" : "−"}${Math.abs(dif).toFixed(0)}`}</span>`;
}
function nivelTxt(nome, c, minN) {
  if (!c || c.n < minN) return `${nome}: pouca amostra.`;
  const dif = 100 * (c.over - c.esp), forte = Math.abs(c.over - c.esp) >= 2 * c.ep && Math.abs(dif) >= 2;
  return `${nome}${c.rot ? ` (${c.rot})` : ""}: Over ${Math.round(100 * c.over)}% × ${Math.round(100 * c.esp)}% esperado = ${dif > 0 ? "+" : "−"}${Math.abs(dif).toFixed(0)} pp (${c.n} jogadores-jogo${c.jogos ? `, ${c.jogos} jogos` : ""})${forte ? "" : ", dentro do acaso"}.`;
}
function calibHtml(c) {
  if (!c) return `<span class="muted" title="Só ao vivo e numa estatística (pontos, rebotes, assistências, cestas de 3 ou PRA).">—</span>`;
  const sit = `${c.tit ? "tit" : "res"} · ${c.dk ? "DK" : "sem DK"} · ${c.quadra ? "quadra" : "banco"} · ${["≤6", "7–14", "15+"][c.pl]}`;
  const sitLonga = `${c.tit ? "titular" : "reserva"}, ${c.dk ? "com" : "sem"} linha DK, ${c.quadra ? "em quadra" : "no banco"}, placar do time ${["até 6", "de 7 a 14", "15 ou mais"][c.pl]}, perto do min ${String(c.min).replace(".", ",")}`;
  const tip = `Over contra a linha justa nesta temporada, real × esperado pelo modelo (pp = diferença; + = a justa costuma ficar baixa, Over ganha mais que o esperado; − = alta). `
    + `${nivelTxt("Jogador", c.jog, 4)} ${nivelTxt("Time", c.time, 10)} ${nivelTxt(`Liga na situação agora (${sitLonga}, ±2 min)`, c.liga, 30)} Apagado = dentro de 2 erros-padrão. Só informa: não muda a justa nem o EV.`;
  return `<span title="${esc(tip)}">${nivelHtml("jog", c.jog, 4)} · ${nivelHtml("time", c.time, 10)} · ${nivelHtml("liga", c.liga, 30)}</span><small class="cv-sub">pp · ${sit}</small>`;
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
    const ag = agoraDe(s?.plays || [], j.aid, b, rel, st);
    est.set(j.aid, { b, ag, x: estimar(j, b, rel, ajusteQ4(minEspDe(j), margem(j.time), rel, d.pol?.times?.[j.time]), ag, { tab: d.cal, pm: placarProj(g, j.time, margem(j.time), rel), mg: margem(j.time), rank: estrelasDe(g)[j.aid], quente: quentes[j.aid] }) });
  }
  const ddF = d.dd?.j ? ddFotos(s?.plays || [], rel) : null; // chips de double-double (fim do Q1 e intervalo)
  let sinais = [];
  try { sinais = sinaisJogo(g, s, d); } catch { /* sem sinais */ }
  const sinalDe = (aid, k) => sinais.find((x) => x.j.aid === aid && x.k === k);
  const idade = Math.round((Date.now() - Math.min(...linhas.map((r) => r.em || Date.now()))) / 60e3);
  const rows = linhas.map((r) => {
    const { b, ag, x } = est.get(r.j.aid);
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
    const ch = antes ? pre || { semDK: true, dp: chanceLinha(d.cal, r.j.aid, 0, mus, feito, r.L).dp } : chanceLinha(d.cal, r.j.aid, rel.t, mus, feito, r.L, ag ? { quadra: ag.quadra, tit: !!b?.starter, mg: margem(r.j.time), pre: dk } : null);
    const evO = r.O && !ch.semDK ? ch.over * r.O + ch.push - 1 : null, evU = r.U && !ch.semDK ? ch.under * r.U + ch.push - 1 : null;
    const cb = !antes && ag && (r.ks.length === 1 || r.k === "pra") ? calibSituacao(d.celulas, r.k, !!b?.starter, !!dk, ag.quadra, margem(r.j.time), rel.t, r.j.aid, r.j.time) : null;
    return { r, feito, justa, sn, ch, evO, evU, ks, cb };
  });
  // ordem: maior EV (padrão), maior diferença justa − linha ou nome
  const cmp = { ev: (a, b) => evMax(b) - evMax(a) || Math.abs(b.dif) - Math.abs(a.dif), dif: (a, b) => Math.abs(b.dif) - Math.abs(a.dif), nome: (a, b) => a.r.j.nome.localeCompare(b.r.j.nome) || a.r.k.localeCompare(b.r.k) }[ORDEM] || ((a, b) => evMax(b) - evMax(a));
  const ok = rows.filter((w) => !w.fora).map((w) => ({ ...w, dif: w.justa - w.r.L })).sort(cmp);
  const fora = rows.filter((w) => w.fora);
  const corpo = ok.map(({ r, feito, justa, dif, sn, ch, evO, evU, cb }) => {
    const { b, ag } = est.get(r.j.aid);
    const dot = ag ? `<span class="dot${ag.quadra ? " on" : ""}" title="${ag.quadra ? "em quadra" : "no banco"}"></span>` : "";
    const naoEntrou = b && !b.min && !ag?.quadra;
    const sub = b ? `<small class="cv-sub">tem <b>${num(feito, 0)}</b>${naoEntrou ? " · ainda não entrou" : ag ? ` · ${rotTexto(r.j, rel, ag)}` : ""}</small>` : "";
    const cor = dif > 0 ? "var(--sig-o)" : "var(--sig-u)";
    const sinal = sn ? ` <span title="sinal do Painel: alvo ${num(justa + sn.uj)}" style="color:${sn.ef > 0 ? "var(--sig-o)" : "var(--sig-u)"}">${sn.ef > 0 ? "↑" : "↓"} alvo ${num(justa + sn.uj)}</span>` : "";
    // minutos incertos (12/11, feedback do usuário: Jarace Walker): sem fundo verde, e o aviso fica na linha
    const cm = confMin(r.j, rel);
    // EV ≥ 30% ao vivo = quase sempre informação que falta ao modelo (12/11, bilhetes de 10–11/11: com EV a favor o Painel
    // dava 70% de chance em média e acertou 37%; Jarace/Quenton Jackson +57–61% com minutos incertos): sem verde, com aviso
    const evm = Math.max(evO ?? -9, evU ?? -9);
    const suspeito = evm >= EV_SUSPEITO;
    const forte = evm >= 0.05 && !suspeito && cm?.n !== 2;
    return `<tr${forte ? ' style="background:var(--good-bg)"' : cm?.n === 2 ? ' class="min-incerto"' : ""}><td>${dot}<b>${esc(r.j.nome)}</b>${seloMin(r.j, rel)}${matchupChip(r.j)}${r.k === "ast" || r.k === "reb" ? ddChip(d.dd, r.j, b, rel, g.id, r.k, ddF ? ddF(r.j.aid, !!b?.starter) : null, { est: est.get(r.j.aid)?.x?.est, quadra: ag ? ag.quadra : null, tit: !!b?.starter, mg: margem(r.j.time), tab: d.cal }) : ""} <span class="muted">${NOME_K[r.k]}</span>${sub}</td>
      <td class="n">${r.O && r.U ? `${num(r.L)} <span class="muted">· ${num(r.O, 2)} / ${num(r.U, 2)}</span>`
        : /marco/i.test(r.mercado || "") ? `<span title="marco: a casa só oferece o Mais (${num(r.L + 0.5, 0)} ou mais = Mais de ${num(r.L)})">${num(r.L + 0.5, 0)}+</span> <span class="muted">· só Mais ${num(r.O, 2)}</span>`
        : `${num(r.L)} <span class="muted" title="o outro lado está suspenso na casa">· ${r.O ? `só Mais ${num(r.O, 2)}` : `só Menos ${num(r.U, 2)}`}</span>`}</td>
      <td class="n"><b>${num(justa)}</b> <span class="muted">± ${num(ch.dp)}</span>${sinal}</td>
      <td class="n"><b style="color:${cor}">${dif > 0 ? "▲ +" : "▼ −"}${num(Math.abs(dif))}</b></td>
      <td class="n">${chanceHtml(ch, evO, evU)}${suspeito ? `<br><small style="color:var(--warn)" title="Com a linha ao vivo da casa, EV tão alto quase sempre é algo que o modelo não sabe (rotação, lesão, papel). Nas apostas de 10–11/11 o Painel dava 70% de chance em média e acertou 37%.">⚠ EV alto demais: confira rotação e notícia</small>` : ""}</td>
      <td class="n cv-cal">${calibHtml(cb)}</td></tr>`;
  }).join("");
  const melhor = ok.length ? evMax(ok.reduce((a, b) => (evMax(b) > evMax(a) ? b : a))) : -Infinity;
  return { melhor, html: `<div class="panel"><p style="margin:0 0 6px">${placarHtml(g, s)}${linhas[0]?.em ? ` <span class="muted">· odds das ${hhmm(Math.min(...linhas.map((r) => r.em || Date.now())))}</span>` : ""}</p>
    ${idade > VELHA_MIN && st?.type?.state === "in" ? `<p class="banner">Odds capturadas há ${idade} min — o jogo andou desde então. Capture de novo.</p>` : ""}
    ${ok.length ? `<div class="tbl-wrap"><table class="props-tab campeon-tab"><thead><tr><th>Jogador</th><th class="n">Casa<small>linha · Mais / Menos</small></th><th class="n">Linha justa<small>Painel, agora</small></th><th class="n">Justa − linha</th><th class="n">Chance · valor<small>lado de maior valor esperado com a odd da casa</small></th><th class="n" title="Over real contra a linha justa × esperado pelo modelo, nesta temporada, em pp: do jogador (nesta estatística, jogo todo), do time dele (mesma estatística, linha DK e placar) e da liga na situação de agora (papel, linha DK, quadra/banco, placar, minuto). Verde = a justa costuma ficar baixa (Over); vermelho = alta (Under); apagado = dentro do acaso. Passe o mouse na célula para os números.">Calibração<small>jogador · time · liga (pp)</small></th></tr></thead><tbody>${corpo}</tbody></table></div>` : ""}
    ${fora.length ? `<p class="muted">Sem conta: ${fora.map((w) => `${esc(w.r.j.nome)} ${NOME_K[w.r.k]} (${w.fora})`).join(" · ")}</p>` : ""}</div>` };
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
      <p class="muted">Linha da casa (capturada pelo coletor) × <b>linha justa do Painel agora</b> (o que ele já fez + ritmo × minutos que faltam — o mesmo número da aba Painel). <b>Justa − linha</b>: ▲ azul = justa acima da linha da casa, ▼ laranja = abaixo. Ordem padrão: maior EV no topo (os jogos também, pelo melhor EV). <b>± desvio</b> e <b>chance</b>: ao vivo, o que falta é tratado como contagem com a dispersão própria do jogador (concentrado × tudo-ou-nada, medida nos jogos de 2024-27) — com a mesma projeção, quem é concentrado acerta mais linhas baixas. <b>Antes do jogo</b> a chance vem da odd sem margem da DraftKings (marca "DK"): no teste de 11/11 a nossa dispersão com a linha como média perdeu da DK antes do jogo. EV = chance × odd − 1. Na casa: capture (D) e clique em <b>"Abrir a comparação"</b> (coletor 1.19).</p>
      <p class="muted"><b>Selo dos minutos</b> ao lado do nome (passe o mouse para ver o motivo): <span class="selo-min" style="color:var(--good);border-color:var(--good)">min ✓</span> confiável, <span class="selo-min" style="color:var(--warn);border-color:var(--warn)">min ~</span> atenção, <span class="selo-min n2" style="color:var(--bad);border-color:var(--bad)">min ?</span> incerto (em casos assim ~1 em 5 joga 70% ou menos do previsto): a linha justa depende dos minutos — confira a rotação antes. Linha com minutos incertos não ganha o fundo verde. <b>EV de 30%+</b> também não: ao vivo, contra a linha da casa, quase sempre é informação que falta ao modelo (nas apostas de 10–11/11, com EV a favor o Painel dava 70% de chance em média e acertou 37%) — o Painel não está calibrado contra linhas ao vivo; use para confirmar a sua leitura.</p>
      ${casas.length ? `<p class="muted">${resumo} · atualizado às ${hora} · análise das ${horaAnalise(dia)} (a mesma do Painel se o horário bater) ·<a href="#" id="cv-limpar">limpar as coletas</a></p>` : `<div class="vazio"><b>Nenhuma captura ainda.</b><span>Capture na casa com o coletor e abra no Painel.</span></div>`}
      ${jogos.length ? `<div class="chips" role="group" aria-label="Ordem">Ordenar por: ${[["ev", "maior EV"], ["dif", "maior diferença"], ["nome", "jogador"]].map(([k, t]) => `<button type="button" class="chip" data-ordem="${k}" aria-pressed="${ORDEM === k}" style="${ORDEM === k ? "background:var(--accent);color:var(--panel);border-color:var(--accent)" : ""}">${t}</button>`).join(" ")} <span class="muted">· verde = EV ≥ 5%</span></div>` : ""}
      ${jogos.map((g) => jogoHtml(g, ST.resumos.get(g.id), linhas.filter((r) => r.g.id === g.id), d)).sort((a, b) => (ORDEM === "ev" ? b.melhor - a.melhor : 0)).map((x) => x.html).join("")}
      ${sem.length ? `<details><summary class="muted">${sem.length} mercados sem par (jogador fora da análise do dia, estatística sem projeção ou mercado parcial)</summary><p class="muted">${sem.slice(0, 150).map(esc).join(" · ")}</p></details>` : ""}
    </section>`;
    for (const b of el.querySelectorAll("[data-ordem]")) b.onclick = () => {
      ORDEM = b.dataset.ordem;
      try { localStorage.setItem("traderpoly.casa.ordem", ORDEM); } catch { /* sem armazenamento */ }
      ST.carregando = false;
      mostrarCasaVivo(el, dia, espn);
    };
    el.querySelector("#cv-limpar")?.addEventListener("click", (e) => {
      e.preventDefault();
      try { localStorage.removeItem("casas-coleta"); } catch { /* sem armazenamento */ }
      ST.carregando = false;
      mostrarCasaVivo(el, dia, espn);
    });
  } finally { ST.carregando = false; }
}
