// Aba "Casas × DK" de props.html (25/10/2026; CampeonBet e, desde 25/10 à tarde, JogaBrasil): linhas da CampeonBet coletadas SÓ quando o usuário clica no botão dos
// favoritos (js/coletor_campeon.js, roda no navegador dele, na página da CampeonBet) comparadas com a DraftKings de agora.
// A ideia (do usuário): a CampeonBet demora a acompanhar os movimentos; uma linha "defasada" é a que ainda está onde a DK
// estava antes de andar. Conta: a chance justa da DK agora (sem margem) é levada para a linha da CampeonBet pela mesma
// conta do movimento (core.movimentoMercado) e vira o valor esperado de cada lado na odd da CampeonBet:
//   EV Over = chance × odd Over − 1; EV Under = (1 − chance) × odd Under − 1. Defasada = EV ≥ 3%.
// A coleta fica guardada neste navegador (localStorage) e é comparada com a DK a cada atualização da página; os dados
// brutos ficam só em memória (botão para baixar, para ajustar o leitor se a CampeonBet mudar o formato).
import { esc, hora } from "./formato.js";
import { semMargem, movimentoMercado, nomeChave, TIPOS_PROP } from "./core.js";

// 25/10: também a JogaBrasil (mesmo coletor; o pacote diz a casa). Uma coleta por casa; a de uma casa não apaga a da outra.
const CASAS = { campeon: "CampeonBet", jogabrasil: "JogaBrasil" };
const CHAVE = "casas-coleta", MIN_EV = 0.03;
const coletas = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (c) return c;
    const velha = JSON.parse(localStorage.getItem("campeon-coleta") || "null"); // antes de 25/10: só a CampeonBet
    return velha ? { campeon: velha } : {};
  } catch { return {}; }
})();
const brutos = {};
let link = null;
const num = (v, c = 2) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(c).replace(".", ","));
const lin = (v) => (v == null ? "–" : String(v).replace(".", ","));
const pc = (v) => (v == null || !Number.isFinite(v) ? "–" : `${v >= 0 ? "+" : "−"}${num(Math.abs(100 * v), 1)}%`);

// ---------- leitura do formato da Altenar (defensiva: o formato não é documentado) ----------
// nomes em inglês (API) ou português (tela da CampeonBet: pt-PT/pt-BR)
const PTS = /\bpoints\b|\bpts\b|\bpontos\b/, REB = /rebounds|ressaltos|rebotes|\breb\b/, AST = /assists|assist[eê]ncias|\bast\b/;
const STATS = [
  ["pra", (n) => PTS.test(n) && REB.test(n) && AST.test(n)],
  ["pa", (n) => PTS.test(n) && AST.test(n)],
  ["pr", (n) => PTS.test(n) && REB.test(n)],
  ["ra", (n) => REB.test(n) && AST.test(n)],
  ["stocks", (n) => /steals|roubos|roubadas/.test(n) && /blocks|bloqueios|tocos|desarmes/.test(n)],
  ["threes", (n) => /three|3-?point|3 ?pt|threes|triplos|cestas de (3|tr[eê]s)|lan[cç]amentos de 3|de (3|tr[eê]s) pontos/.test(n)],
  ["points", (n) => PTS.test(n)],
  ["rebounds", (n) => REB.test(n)],
  ["assists", (n) => AST.test(n)],
  ["steals", (n) => /steals|roubos|roubadas/.test(n)],
  ["blocks", (n) => /blocks|bloqueios|tocos|desarmes de lan/.test(n)],
];
// mercados que a DK não tem e que casariam com uma estatística dela (25/10: "3pt tentados" saiu como cestas de 3 a 6,5)
const OUTRO = /tentad|tentativ|attempt|arremess|duplo|double/i;
const PARCIAL = /quarter|half|1st|2nd|3rd|4th|first|second|period|minute|quarto|tempo|per[ií]odo|parte|1º|2º|3º|4º/i;
const lado = (nome) => (/\bover\b|\bmais\b|\bacima\b/i.test(nome) ? "O" : /\bunder\b|\bmenos\b|\babaixo\b/i.test(nome) ? "U" : null);
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

// coleta compacta do coletor v1.1 (js/campeon.user.js): eventos com mercados [[nome, sv, [[nome da odd, preço, sv]]]]
function lerCompacto(p) {
  const eventos = (p?.eventos || []).map((e) => ({
    id: e.id, nome: e.nome, inicio: Date.parse(e.inicio || "") || null,
    mercados: (e.mercados || []).map(([nome, sv, odds]) => {
      const pares = new Map();
      for (const [n, preco, osv] of odds) {
        const l = lado(n), L = numero(osv ?? n) ?? numero(sv);
        if (!l || L == null || !(preco > 1)) continue;
        (pares.get(L) || pares.set(L, { L }).get(L))[l] = preco;
      }
      return { nome: String(nome || ""), pares: [...pares.values()].filter((q) => q.O && q.U), opcoes: odds.map(([n, preco]) => ({ nome: String(n || ""), preco })) };
    }),
  }));
  return { em: p?.em || Date.now(), eventos, erros: p?.erros || 0, amostra: p?.amostra || null };
}
// gzip + base64url (o coletor manda assim no endereço "#campeon=…" ou na área de transferência)
async function abre(b64) {
  const bin = atob(b64.replaceAll("-", "+").replaceAll("_", "/"));
  const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}
let aoChegarCb = null;
function receber(pacote) {
  const casa = CASAS[pacote?.casa] ? pacote.casa : "campeon";
  brutos[casa] = pacote;
  coletas[casa] = pacote?.v === 2 ? lerCompacto(pacote) : lerPacote(pacote);
  try { localStorage.setItem(CHAVE, JSON.stringify(coletas)); } catch { /* sem armazenamento: só nesta visita */ }
  aoChegarCb?.();
}
// recebe a coleta: pelo endereço (coletor v1.1), por "Colar dados" ou por postMessage (coletor antigo/favorito)
export function ouvirCampeon(aoChegar) {
  aoChegarCb = aoChegar;
  const h = location.hash.match(/^#campeon=([A-Za-z0-9_-]+)$/);
  if (h) {
    history.replaceState(null, "", location.pathname + location.search); // tira os dados do endereço
    abre(h[1]).then(receber).catch((e) => alert(`Não consegui ler os dados da CampeonBet: ${e.message || e}`));
  }
  addEventListener("message", (e) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*campeonbet\.[a-z]+$/i.test(e.origin) || e.data?.tipo !== "campeon") return;
    e.source?.postMessage("campeon-ok", e.origin);
    if (brutos.campeon?.em === e.data.pacote?.em) return; // o coletor reenvia até receber o ok
    receber(e.data.pacote);
  });
}
async function colar() {
  const txt = (await navigator.clipboard.readText()).trim();
  receber(txt.startsWith("{") ? JSON.parse(txt) : await abre(txt.replace(/^.*#campeon=/, "")));
}

// ---------- comparação com a DraftKings de agora ----------
// jogo da DK desta coleta: os dois apelidos dos times (Lakers, Thunder…) no nome do evento
const jogoDe = (ev, jogos) => { const n = nomeChave(ev.nome); return jogos.find((j) => j.mercados.length ? [j.mercados[0]?.rotA, j.mercados[0]?.rotB].every((t) => t && n.includes(nomeChave(t))) : false) || jogos.find((j) => { const [a, b] = j.titulo.split(" @ "); return n.includes(nomeChave(a)) && n.includes(nomeChave(b)); }); };
// palavras do nome sem acento e sem Jr./II (a JogaBrasil escreve "Jackson Jaren": casa pelas palavras, em qualquer ordem)
const palavras = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter((w) => w && !/^(jr|sr|ii|iii|iv)$/.test(w));
function comparar(jogos) {
  const linhas = [], semPar = [];
  for (const [casa, coleta] of Object.entries(coletas)) for (const ev of coleta?.eventos || []) {
    const j = jogoDe(ev, jogos);
    if (!j) { semPar.push(`${CASAS[casa]}, jogo: ${ev.nome}`); continue; }
    const jogadores = [...new Set(j.linhas.map((x) => x.jogador))].map((n) => [n, nomeChave(n), palavras(n)]).filter(([, k]) => k.length >= 6);
    const ml = j.mercados.find((m) => m.k === "ml"), tot = j.mercados.find((m) => m.k === "total");
    const n0 = linhas.length;
    for (const m of ev.mercados) {
      const nm = m.nome.toLowerCase(), texto = m.nome + " " + m.opcoes.map((o) => o.nome).join(" "), chave = nomeChave(texto), ws = new Set(palavras(texto));
      if (PARCIAL.test(nm)) continue;
      if (OUTRO.test(nm)) { semPar.push(`${CASAS[casa]}: ${m.nome}`); continue; }
      const jog = jogadores.find(([, k]) => chave.includes(k)) || jogadores.find(([, , p]) => p.length >= 2 && p.every((w) => ws.has(w)));
      if (jog) { // prop de jogador
        const tipo = STATS.find(([, ok]) => ok(nm))?.[0];
        const dk = tipo && j.linhas.find((x) => x.jogador === jog[0] && x.tipo === tipo);
        if (!dk) { semPar.push(`${CASAS[casa]}: ${m.nome}`); continue; }
        for (const p of m.pares) linhas.push(par(j, jog[0], tipo, TIPOS_PROP[tipo], p, dk, m.nome));
        continue;
      }
      if (/winner|money ?line|match result|1x2|vencedor|resultado final/.test(nm) && ml && m.opcoes.length === 2) { // vencedor
        const vis = m.opcoes.find((o) => nomeChave(o.nome).includes(nomeChave(ml.rotA))), cas = m.opcoes.find((o) => nomeChave(o.nome).includes(nomeChave(ml.rotB)));
        const pv = semMargem(ml.dk.over, ml.dk.under);
        if (vis && cas && pv != null) linhas.push({ j, quem: "Vencedor", mercado: "Vencedor", L: null, O: vis.preco, U: cas.preco, dk: ml.dk, rotA: ml.rotA, rotB: ml.rotB, chance: pv, evO: pv * vis.preco - 1, evU: (1 - pv) * cas.preco - 1, nomeCampeon: m.nome });
        continue;
      }
      if (/total/.test(nm) && !/team|player|equipa|equipe|jogador/.test(nm) && tot && !(j.mercados[0] && [j.mercados[0].rotA, j.mercados[0].rotB].some((t) => t && nomeChave(m.nome).includes(nomeChave(t))))) { // total do jogo
        for (const p of m.pares) linhas.push(par(j, "Total do jogo", "jogo-total", "Total do jogo", p, tot, m.nome));
      }
    }
    for (let i = n0; i < linhas.length; i++) if (linhas[i]) linhas[i].casa = casa;
  }
  return { linhas: escada(linhas.filter(Boolean)), semPar };
}
// casa com escada de linhas (JogaBrasil: 6,5 a 13,5 para o mesmo jogador): longe da linha da DK a conta do movimento não
// vale, então fica, por casa × jogo × jogador × estatística, a de maior EV entre as linhas perto da DK (ou só a mais perto)
function escada(linhas) {
  const grupos = new Map();
  for (const r of linhas) { const k = `${r.casa}|${r.j.titulo}|${r.quem}|${r.tipo}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  return [...grupos.values()].flatMap((g) => {
    if (g.length === 1 || g[0].L == null) return g;
    const d = (r) => Math.abs(r.L - r.dk.linha), perto = g.filter((r) => d(r) <= Math.max(1, 0.1 * r.dk.linha));
    const lista = perto.length ? perto : [g.reduce((a, b) => (d(b) < d(a) ? b : a))];
    return [{ ...lista.reduce((a, b) => (Math.max(b.evO, b.evU) > Math.max(a.evO, a.evU) ? b : a)), escada: g.length }];
  });
}
// um par Over/Under da CampeonBet × a linha da DK (x = linha da DK: x.dk com linha e odds de agora)
function par(j, quem, tipo, mercado, p, x, nomeCampeon) {
  const p1 = semMargem(x.dk.over, x.dk.under);
  if (p1 == null || x.dk.linha == null) return null;
  const q = p.L === x.dk.linha ? p1 : movimentoMercado(tipo, p.L, x.dk.linha, 0, p1);
  if (q == null) return null;
  const c = Math.min(0.99, Math.max(0.01, q));
  // linha muito longe da DK (ou chance quase certa) = quase sempre outro mercado lido com o nome errado: não conta como defasada
  const suspeita = p.L !== x.dk.linha && (Math.abs(p.L - x.dk.linha) > Math.max(2, 0.3 * x.dk.linha) || c < 0.1 || c > 0.9);
  return { j, quem, tipo, mercado, L: p.L, O: p.O, U: p.U, dk: x.dk, rotA: "Over", rotB: "Under", chance: c, evO: c * p.O - 1, evU: (1 - c) * p.U - 1, nomeCampeon, suspeita };
}

// ---------- página ----------
async function linkColetor() {
  if (link) return link;
  const txt = await fetch(`js/campeon.user.js?t=${Date.now()}`).then((r) => r.text()).catch(() => null);
  return (link = txt ? `javascript:${encodeURIComponent(`window.__traderPolyFavorito=1;${txt}`)}` : null);
}
export function renderCampeon(el, f, jogos) {
  const alvo = el;
  linkColetor().then((href) => {
    const a = alvo.querySelector("#link-coletor");
    if (a && href) { a.href = href; a.textContent = "Coletor (favorito)"; } // só fica arrastável quando o código carregou
    alvo.querySelector("#copiar-coletor")?.addEventListener("click", (e) => { e.preventDefault(); navigator.clipboard?.writeText(href || "").then(() => { e.target.textContent = "código copiado!"; }, () => { e.target.textContent = "não consegui copiar"; }); });
  });
  const busca = nomeChave(f.busca);
  const casas = Object.keys(CASAS).filter((c) => coletas[c]);
  const { linhas, semPar } = casas.length ? comparar(jogos) : { linhas: [], semPar: [] };
  const L = linhas.filter((r) => (!f.tipo || r.tipo === f.tipo || (f.tipo === "jogo" && !TIPOS_PROP[r.tipo])) && (!busca || nomeChave(r.quem).includes(busca)))
    .map((r) => ({ ...r, melhor: Math.max(r.evO, r.evU) })).sort((a, b) => !!a.suspeita - !!b.suspeita || b.melhor - a.melhor);
  const boa = (r) => r.melhor >= MIN_EV && !r.suspeita;
  const ev = (v, r) => `<td class="n${v >= MIN_EV && !r.suspeita ? " ev-bom" : ""}">${pc(v)}</td>`;
  const tab = L.length ? `<div class="tbl-wrap"><table class="props-tab campeon-tab"><thead><tr><th>Jogador / mercado</th><th>Jogo</th><th class="n">Casa<small>linha · Over / Under</small></th><th class="n">DraftKings agora<small>linha · Over / Under</small></th><th class="n">Chance justa do Over<small>pela DK, na linha da casa</small></th><th class="n">EV Over<small>na casa</small></th><th class="n">EV Under<small>na casa</small></th></tr></thead><tbody>
    ${L.slice(0, 300).map((r) => `<tr${boa(r) ? ' class="defasada"' : r.suspeita ? ' class="suspeita"' : ""}><td><b>${esc(r.quem)}</b><small title="${esc(r.nomeCampeon)}">${esc(r.mercado)} · ${CASAS[r.casa]}${r.escada > 1 ? ` (melhor de ${r.escada} linhas)` : ""}</small>${r.suspeita ? `<small class="aviso">linha longe da DK — confira se é o mesmo mercado: “${esc(r.nomeCampeon.split(" | ")[0])}”</small>` : ""}</td><td>${esc(r.j.titulo)}<small>${r.j.inicio ? hora(r.j.inicio) : ""}</small></td>
      <td class="n"><b>${r.L == null ? "" : `${lin(r.L)} · `}${num(r.O)} / ${num(r.U)}</b><small>${CASAS[r.casa]}</small></td><td class="n">${r.dk.linha == null || r.L == null ? "" : `${lin(r.dk.linha)} · `}${num(r.dk.over)} / ${num(r.dk.under)}${r.L != null && r.dk.linha !== r.L ? `<small>linha diferente: ${r.dk.linha > r.L ? "DK subiu" : "DK caiu"}</small>` : ""}</td>
      <td class="n">${num(100 * r.chance, 1)}%<small>${esc(r.rotA)}</small></td>${ev(r.evO, r)}${ev(r.evU, r)}</tr>`).join("")}
    </tbody></table></div>` : "";
  // uma linha de resumo por casa coletada
  const resumo = casas.map((c) => {
    const co = coletas[c], idade = Math.round((Date.now() - co.em) / 60e3), dela = L.filter((r) => r.casa === c);
    return `<p class="${idade > 15 ? "banner" : "muted"}"><b>${CASAS[c]}</b>: coleta das ${hora(co.em)} (há ${idade} min) · ${co.eventos.length} jogos, ${co.eventos.reduce((t, e) => t + e.mercados.length, 0)} mercados lidos${co.erros ? `, ${co.erros} jogos com erro` : ""} · ${linhas.filter((r) => r.casa === c).length} linhas casadas com a DK · <b>${dela.filter(boa).length} defasadas</b>${dela.some((r) => r.suspeita) ? ` · ${dela.filter((r) => r.suspeita).length} suspeitas (linha longe da DK, no fim da tabela)` : ""}.${idade > 15 ? " As odds podem ter mudado: colete de novo antes de apostar." : ""}${brutos[c] ? ` <a href="#" class="baixar-bruto" data-casa="${c}">baixar os dados brutos</a>` : ""}</p>`;
  }).join("");
  el.innerHTML = `<section class="panel"><h2>Casas × DraftKings</h2>
      <p class="muted">CampeonBet e JogaBrasil costumam demorar a acompanhar os movimentos. Aqui cada linha delas é comparada com a <b>DraftKings de agora</b>: a chance justa da DK (sem a margem) é levada para a linha da casa e vira o <b>valor esperado</b> de cada lado na odd da casa. <b>Defasada</b> (verde) = EV ≥ ${num(100 * MIN_EV, 0)}%: a casa ainda paga como se a linha não tivesse andado. Na JogaBrasil, que mostra uma escada de linhas por jogador, fica a melhor entre as linhas perto da linha da DK. A coleta só acontece quando você clica no botão — nada consulta as casas sozinho.</p>
      <div class="campeon-passos"><b>Como coletar (com a extensão):</b> 1) instale o <a href="https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo" target="_blank" rel="noopener">Tampermonkey</a> no Chrome; nos detalhes da extensão (chrome://extensions), ligue <b>"Permitir scripts do usuário"</b> · 2) <a href="js/campeon.user.js" target="_blank" rel="noopener"><b>instale o coletor</b></a> (o Tampermonkey abre uma tela: clique em "Instalar"; já tinha? clique em "Atualizar" — versão 1.6, vale para as duas casas) · 3) clique em <b>"Capturar esta tela"</b> na caixa azul do canto inferior esquerdo — ela lê só o que já está na tela — e no fim em <b>"Abrir a comparação"</b>:
        <br>· <a href="https://campeonbet.io/pt/sports?page=championship&amp;championshipIds=2980" target="_blank" rel="noopener">CampeonBet</a>: jogo › <b>"Especiais de Jogadores"</b>; capture cada time e cada aba (Pontos, 3 Pontos, Rebotes, Assistências, Combos; nos Combos abra cada quadro) — as capturas se somam.
        <br>· <a href="https://jogabrasil.bet/sports/basketball/13589-nba" target="_blank" rel="noopener">JogaBrasil</a>: jogo › <b>"Mercado de Jogadores"</b>; se a lista carregar aos poucos, role até o fim e capture de novo.
        <br><small class="muted">Sem extensão: arraste este botão para a barra de favoritos: <a id="link-coletor" class="pill" href="#" onclick="return false">carregando o botão…</a> (ou <a href="#" id="copiar-coletor">copie o código</a>, crie um favorito, edite e cole no lugar do endereço) e clique nele na página da casa.</small></div>
      ${casas.length ? `${resumo}<p class="muted"><a href="#" class="colar-dados">colar dados</a></p>` : `<div class="vazio"><b>Nenhuma coleta ainda.</b><span>Siga os passos acima. Se a caixa mostrou "Copiar dados": <a href="#" class="colar-dados">colar dados</a>.</span></div>`}
      ${tab}
      ${semPar.length ? `<details><summary class="muted">${semPar.length} mercados das casas sem par na DK (outro jogador, outra estatística ou mercado que a DK não tem)</summary><p class="muted">${semPar.slice(0, 120).map(esc).join(" · ")}</p></details>` : ""}
    </section>`;
  el.querySelectorAll(".colar-dados").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); colar().catch((err) => { e.target.textContent = `não consegui colar (${err.message || err})`; }); }));
  el.querySelectorAll(".baixar-bruto").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    const c = e.target.dataset.casa, a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(brutos[c])], { type: "application/json" }));
    a.download = `${c}-${new Date(brutos[c].em).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  }));
}
