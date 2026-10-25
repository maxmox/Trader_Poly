// Aba "CampeonBet × DK" de props.html (25/10/2026): linhas da CampeonBet coletadas SÓ quando o usuário clica no botão dos
// favoritos (js/coletor_campeon.js, roda no navegador dele, na página da CampeonBet) comparadas com a DraftKings de agora.
// A ideia (do usuário): a CampeonBet demora a acompanhar os movimentos; uma linha "defasada" é a que ainda está onde a DK
// estava antes de andar. Conta: a chance justa da DK agora (sem margem) é levada para a linha da CampeonBet pela mesma
// conta do movimento (core.movimentoMercado) e vira o valor esperado de cada lado na odd da CampeonBet:
//   EV Over = chance × odd Over − 1; EV Under = (1 − chance) × odd Under − 1. Defasada = EV ≥ 3%.
// A coleta fica guardada neste navegador (localStorage) e é comparada com a DK a cada atualização da página; os dados
// brutos ficam só em memória (botão para baixar, para ajustar o leitor se a CampeonBet mudar o formato).
import { esc, hora } from "./formato.js";
import { semMargem, movimentoMercado, nomeChave, TIPOS_PROP } from "./core.js";

const CHAVE = "campeon-coleta", MIN_EV = 0.03;
let coleta = (() => { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch { return null; } })();
let bruto = null, link = null;
const num = (v, c = 2) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(c).replace(".", ","));
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
const pc = (v) => (v == null || !Number.isFinite(v) ? "–" : `${v >= 0 ? "+" : "−"}${num(Math.abs(100 * v), 1)}%`);

// ---------- leitura do formato da Altenar (defensiva: o formato não é documentado) ----------
const STATS = [
  ["pra", (n) => /points/.test(n) && /rebounds/.test(n) && /assists/.test(n)],
  ["pa", (n) => /points/.test(n) && /assists/.test(n)],
  ["pr", (n) => /points/.test(n) && /rebounds/.test(n)],
  ["ra", (n) => /rebounds/.test(n) && /assists/.test(n)],
  ["stocks", (n) => /steals/.test(n) && /blocks/.test(n)],
  ["threes", (n) => /three|3-?point|3 ?pt|threes/.test(n)],
  ["points", (n) => /\bpoints\b|\bpts\b/.test(n)],
  ["rebounds", (n) => /rebounds/.test(n)],
  ["assists", (n) => /assists/.test(n)],
  ["steals", (n) => /steals/.test(n)],
  ["blocks", (n) => /blocks/.test(n)],
];
const PARCIAL = /quarter|half|1st|2nd|3rd|4th|first|second|period|minute/i;
const lado = (nome) => (/\bover\b|\bmais\b/i.test(nome) ? "O" : /\bunder\b|\bmenos\b/i.test(nome) ? "U" : null);
const numero = (s) => { const m = String(s ?? "").match(/[-+]?\d+(?:[.,]\d+)?/g); return m ? parseFloat(m[m.length - 1].replace(",", ".")) : null; };
// um GetEventDetails → { nome, inicio, mercados: [{ nome, pares: [{L, O, U}], opcoes: [{nome, preco}] }] }
function lerEvento(d, daLista) {
  const ev = d?.event && typeof d.event === "object" ? { ...d, ...d.event } : d || {};
  const odds = new Map((ev.odds || d?.odds || []).map((o) => [o.id, o]));
  const mercados = [];
  for (const m of ev.markets || d?.markets || []) {
    const ids = m.oddIds || [...(m.desktopOddIds || []), ...(m.mobileOddIds || [])].flat();
    const os = [...new Set(ids)].map((id) => odds.get(id)).filter((o) => o && +o.price > 1);
    if (!os.length) continue;
    const pares = new Map();
    for (const o of os) {
      const l = lado(o.name);
      if (!l) continue;
      const L = numero(o.sv ?? o.name) ?? numero(m.sv);
      if (L == null) continue;
      const p = pares.get(L) || pares.set(L, { L }).get(L);
      p[l] = +o.price;
    }
    mercados.push({ nome: String(m.name || ""), pares: [...pares.values()].filter((p) => p.O && p.U), opcoes: os.map((o) => ({ nome: String(o.name || ""), preco: +o.price })) });
  }
  return { id: ev.id ?? daLista?.id, nome: String(ev.name || daLista?.name || ""), inicio: Date.parse(ev.startDate || daLista?.startDate || "") || null, mercados };
}
function lerPacote(p) {
  const lista = new Map((p?.lista?.events || []).map((e) => [e.id, e]));
  const eventos = (p?.detalhes || []).filter((d) => !d?.erro).map((d) => lerEvento(d, lista.get(d?.id ?? d?.event?.id)));
  return { em: p?.em || Date.now(), eventos, erros: (p?.detalhes || []).filter((d) => d?.erro).length };
}

// recebe a coleta do botão dos favoritos (origem: a CampeonBet)
export function ouvirCampeon(aoChegar) {
  addEventListener("message", (e) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*campeonbet\.[a-z]+$/i.test(e.origin) || e.data?.tipo !== "campeon") return;
    e.source?.postMessage("campeon-ok", e.origin);
    if (bruto?.em === e.data.pacote?.em) return; // o coletor reenvia até receber o ok
    bruto = e.data.pacote;
    coleta = lerPacote(bruto);
    try { localStorage.setItem(CHAVE, JSON.stringify(coleta)); } catch { /* sem armazenamento: só nesta visita */ }
    aoChegar?.();
  });
}

// ---------- comparação com a DraftKings de agora ----------
// jogo da DK desta coleta: os dois apelidos dos times (Lakers, Thunder…) no nome do evento
const jogoDe = (ev, jogos) => { const n = nomeChave(ev.nome); return jogos.find((j) => j.mercados.length ? [j.mercados[0]?.rotA, j.mercados[0]?.rotB].every((t) => t && n.includes(nomeChave(t))) : false) || jogos.find((j) => { const [a, b] = j.titulo.split(" @ "); return n.includes(nomeChave(a)) && n.includes(nomeChave(b)); }); };
function comparar(jogos) {
  const linhas = [], semPar = [];
  for (const ev of coleta?.eventos || []) {
    const j = jogoDe(ev, jogos);
    if (!j) { semPar.push(`jogo: ${ev.nome}`); continue; }
    const jogadores = [...new Set(j.linhas.map((x) => x.jogador))].map((n) => [n, nomeChave(n)]).filter(([, k]) => k.length >= 6);
    const ml = j.mercados.find((m) => m.k === "ml"), tot = j.mercados.find((m) => m.k === "total");
    for (const m of ev.mercados) {
      const nm = m.nome.toLowerCase(), chave = nomeChave(m.nome + " " + m.opcoes.map((o) => o.nome).join(" "));
      if (PARCIAL.test(nm)) continue;
      const jog = jogadores.find(([, k]) => chave.includes(k));
      if (jog) { // prop de jogador
        const tipo = STATS.find(([, ok]) => ok(nm))?.[0];
        const dk = tipo && j.linhas.find((x) => x.jogador === jog[0] && x.tipo === tipo);
        if (!dk) { semPar.push(`${jog[0]}: ${m.nome}`); continue; }
        for (const p of m.pares) linhas.push(par(j, jog[0], tipo, TIPOS_PROP[tipo], p, dk, m.nome));
        continue;
      }
      if (/winner|money ?line|match result|1x2/.test(nm) && ml && m.opcoes.length === 2) { // vencedor
        const vis = m.opcoes.find((o) => nomeChave(o.nome).includes(nomeChave(ml.rotA))), cas = m.opcoes.find((o) => nomeChave(o.nome).includes(nomeChave(ml.rotB)));
        const pv = semMargem(ml.dk.over, ml.dk.under);
        if (vis && cas && pv != null) linhas.push({ j, quem: "Vencedor", mercado: "Vencedor", L: null, O: vis.preco, U: cas.preco, dk: ml.dk, rotA: ml.rotA, rotB: ml.rotB, chance: pv, evO: pv * vis.preco - 1, evU: (1 - pv) * cas.preco - 1, nomeCampeon: m.nome });
        continue;
      }
      if (/total/.test(nm) && !/team|player/.test(nm) && tot && !(j.mercados[0] && [j.mercados[0].rotA, j.mercados[0].rotB].some((t) => t && nomeChave(m.nome).includes(nomeChave(t))))) { // total do jogo
        for (const p of m.pares) linhas.push(par(j, "Total do jogo", "jogo-total", "Total do jogo", p, tot, m.nome));
      }
    }
  }
  return { linhas: linhas.filter(Boolean), semPar };
}
// um par Over/Under da CampeonBet × a linha da DK (x = linha da DK: x.dk com linha e odds de agora)
function par(j, quem, tipo, mercado, p, x, nomeCampeon) {
  const p1 = semMargem(x.dk.over, x.dk.under);
  if (p1 == null || x.dk.linha == null) return null;
  const q = p.L === x.dk.linha ? p1 : movimentoMercado(tipo, p.L, x.dk.linha, 0, p1);
  if (q == null) return null;
  const c = Math.min(0.99, Math.max(0.01, q));
  return { j, quem, tipo, mercado, L: p.L, O: p.O, U: p.U, dk: x.dk, rotA: "Over", rotB: "Under", chance: c, evO: c * p.O - 1, evU: (1 - c) * p.U - 1, nomeCampeon };
}

// ---------- página ----------
async function linkColetor() {
  if (link) return link;
  const txt = await fetch(`js/coletor_campeon.js?t=${Date.now()}`).then((r) => r.text()).catch(() => null);
  return (link = txt ? `javascript:${encodeURIComponent(txt)}` : null);
}
export function renderCampeon(el, f, jogos) {
  const alvo = el;
  linkColetor().then((href) => {
    const a = alvo.querySelector("#link-coletor");
    if (a && href) { a.href = href; a.textContent = "Coletar CampeonBet"; } // só fica arrastável quando o código carregou
    alvo.querySelector("#copiar-coletor")?.addEventListener("click", (e) => { e.preventDefault(); navigator.clipboard?.writeText(href || "").then(() => { e.target.textContent = "código copiado!"; }, () => { e.target.textContent = "não consegui copiar"; }); });
  });
  const busca = nomeChave(f.busca);
  const { linhas, semPar } = coleta ? comparar(jogos) : { linhas: [], semPar: [] };
  const L = linhas.filter((r) => (!f.tipo || r.tipo === f.tipo || (f.tipo === "jogo" && !TIPOS_PROP[r.tipo])) && (!busca || nomeChave(r.quem).includes(busca)))
    .map((r) => ({ ...r, melhor: Math.max(r.evO, r.evU) })).sort((a, b) => b.melhor - a.melhor);
  const idade = coleta ? Math.round((Date.now() - coleta.em) / 60e3) : null;
  const defasadas = L.filter((r) => r.melhor >= MIN_EV).length;
  const ev = (v) => `<td class="n${v >= MIN_EV ? " ev-bom" : ""}">${pc(v)}</td>`;
  const tab = L.length ? `<div class="tbl-wrap"><table class="props-tab campeon-tab"><thead><tr><th>Jogador / mercado</th><th>Jogo</th><th class="n">CampeonBet<small>linha · Over / Under</small></th><th class="n">DraftKings agora<small>linha · Over / Under</small></th><th class="n">Chance justa do Over<small>pela DK, na linha da Campeon</small></th><th class="n">EV Over<small>na Campeon</small></th><th class="n">EV Under<small>na Campeon</small></th></tr></thead><tbody>
    ${L.slice(0, 300).map((r) => `<tr${r.melhor >= MIN_EV ? ' class="defasada"' : ""}><td><b>${esc(r.quem)}</b><small title="${esc(r.nomeCampeon)}">${esc(r.mercado)}</small></td><td>${esc(r.j.titulo)}<small>${r.j.inicio ? hora(r.j.inicio) : ""}</small></td>
      <td class="n"><b>${r.L == null ? "" : `${lin(r.L)} · `}${num(r.O)} / ${num(r.U)}</b></td><td class="n">${r.dk.linha == null || r.L == null ? "" : `${lin(r.dk.linha)} · `}${num(r.dk.over)} / ${num(r.dk.under)}${r.L != null && r.dk.linha !== r.L ? `<small>linha diferente: ${r.dk.linha > r.L ? "DK subiu" : "DK caiu"}</small>` : ""}</td>
      <td class="n">${num(100 * r.chance, 1)}%<small>${esc(r.rotA)}</small></td>${ev(r.evO)}${ev(r.evU)}</tr>`).join("")}
    </tbody></table></div>` : "";
  el.innerHTML = `<section class="panel"><h2>CampeonBet × DraftKings</h2>
      <p class="muted">A CampeonBet costuma demorar a acompanhar os movimentos. Aqui cada linha dela é comparada com a <b>DraftKings de agora</b>: a chance justa da DK (sem a margem) é levada para a linha da CampeonBet e vira o <b>valor esperado</b> de cada lado na odd da CampeonBet. <b>Defasada</b> (verde) = EV ≥ ${num(100 * MIN_EV, 0)}%: a CampeonBet ainda paga como se a linha não tivesse andado. A coleta só acontece quando você clica no botão — nada consulta a CampeonBet sozinho.</p>
      <div class="campeon-passos"><b>Como coletar:</b> 1) arraste este botão para a barra de favoritos: <a id="link-coletor" class="pill" href="#" onclick="return false">carregando o botão…</a> <small class="muted">(se não der para arrastar: <a href="#" id="copiar-coletor">copie o código</a>, crie um favorito qualquer, edite e cole o código no lugar do endereço)</small> · 2) abra a <a href="https://campeonbet.io/pt/sports?page=championship&amp;championshipIds=2980" target="_blank" rel="noopener">página da NBA na CampeonBet</a> e espere as odds aparecerem · 3) clique no favorito. Ele lê os jogos devagar (~2 s por jogo, como quem abre um por um) e manda para esta aba.</div>
      ${coleta ? `<p class="${idade > 15 ? "banner" : "muted"}">Coleta das ${hora(coleta.em)} (há ${idade} min): ${coleta.eventos.length} jogos, ${coleta.eventos.reduce((t, e) => t + e.mercados.length, 0)} mercados lidos${coleta.erros ? `, ${coleta.erros} jogos com erro` : ""} · ${linhas.length} linhas casadas com a DK · <b>${defasadas} defasadas</b>.${idade > 15 ? " As odds podem ter mudado: colete de novo antes de apostar." : ""} ${bruto ? `<a href="#" id="baixar-bruto">baixar os dados brutos</a>` : ""}</p>` : `<div class="vazio"><b>Nenhuma coleta ainda.</b><span>Siga os 3 passos acima.</span></div>`}
      ${tab}
      ${semPar.length ? `<details><summary class="muted">${semPar.length} mercados da CampeonBet sem par na DK (outro jogador, outra estatística ou linha que a DK não tem)</summary><p class="muted">${semPar.slice(0, 80).map(esc).join(" · ")}</p></details>` : ""}
    </section>`;
  el.querySelector("#baixar-bruto")?.addEventListener("click", (e) => {
    e.preventDefault();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(bruto)], { type: "application/json" }));
    a.download = `campeon-${new Date(bruto.em).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  });
}
