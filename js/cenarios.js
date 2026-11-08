// Aba "Cenários" do padroes.html (08/11): blowout por time (política do técnico, quem perde e quem ganha minutos),
// chance de blowout/jogo parelho pelo handicap, clutch por jogador e regras da liga. Dados: data/padroes/cenarios.json
// (nba_pbp/cenarios_site.py). Só descreve comportamento: nada foi testado contra a linha ao vivo.
import { esc } from "./formato.js";

let CEN = null;
const pc = (x) => `${Math.round(100 * x)}%`;
const n1 = (x) => (x == null ? "–" : x.toFixed(1).replace(".", ","));
const n2 = (x) => (x == null ? "–" : x.toFixed(2).replace(".", ","));
const chip = (t, cor, tip = "") => `<span class="chip" title="${esc(tip)}" style="color:${cor};border:1px solid ${cor};background:transparent">${t}</span>`;
const OVER = "var(--sig-o)", UNDER = "var(--sig-u)", NEUTRO = "var(--ink-3)";

// política do técnico: minutos no Q4 dos 5 que mais jogaram, ganhando/perdendo 16+ no fim do 3º, × a liga
function chipPol(p) {
  if (!p) return chip("poucos jogos", NEUTRO, "menos de 4 jogos nessa situação");
  const v = p.vs_liga;
  const [t, c] = v < 0.85 ? ["tira cedo", UNDER] : v > 1.15 ? ["mantém", OVER] : ["padrão", NEUTRO];
  return chip(t, c, `${n1(p.min)} min no Q4 × ${n1(p.normal)} em jogo normal (${p.n} jogos); ${n2(v)} × a liga`);
}
function politica(p) {
  return p ? `${chipPol(p)} <span class="muted">${n1(p.min)} min no Q4 (normal ${n1(p.normal)}, ${p.n} j)</span>` : chipPol(p);
}
const polAtual = (t, lado) => t[`${lado}_atual`] || t[lado];

function barra(x, cor) {
  return `<span style="display:inline-block;width:90px;height:8px;border-radius:4px;background:var(--line);vertical-align:middle;margin-right:6px"><span style="display:block;height:8px;border-radius:4px;width:${Math.min(100, Math.round(100 * x))}%;background:${cor}"></span></span>`;
}

function chanceDe(h) {
  if (h == null) return null;
  const a = Math.abs(h);
  return CEN.chance.find((c) => a >= c.lo && a <= c.hi + 0.25) || null;
}

const jogNome = (j) => `${esc(j.nome)} <span class="muted">${n1(j.normal)} → ${n1(j.blowout)} min (${j.n} j)</span>`;
function listaMin(t) {
  const per = t.perdem.slice(0, 4).map((j) => `<li>${chip("▼", UNDER)} ${jogNome(j)}</li>`).join("");
  const gan = t.ganham.slice(0, 4).map((j) => `<li>${chip("▲", OVER)} ${jogNome(j)}</li>`).join("");
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:4px 16px">
    <div><b style="font-size:13px">Perdem minutos no Q4 em blowout</b><ul class="hint" style="margin:4px 0;padding-left:0;list-style:none">${per || "<li>–</li>"}</ul></div>
    <div><b style="font-size:13px">Ganham minutos</b><ul class="hint" style="margin:4px 0;padding-left:0;list-style:none">${gan || "<li>–</li>"}</ul></div></div>`;
}
function listaClutch(t) {
  const L = (t.clutch || []).slice(0, 4).map((j) => {
    const lado = j.uso >= 1.12 || j.pts >= 1.1 ? chip("assume", OVER) : j.uso <= 0.88 ? chip("some", UNDER) : chip("igual", NEUTRO);
    return `<li>${lado} ${esc(j.nome)} <span class="muted">parte ${pc(j.parte_antes)} → ${pc(j.parte)} · pontos/min ${n2(j.pts)} · fim inteiro ${pc(j.fim)} (${j.n} j)</span></li>`;
  }).join("");
  return `<b style="font-size:13px">No clutch (últimos 5 min, até 5 pontos)</b><ul class="hint" style="margin:4px 0;padding-left:0;list-style:none">${L || "<li>–</li>"}</ul>`;
}

function timeBloco(ab, t, papel) {
  if (!t) return `<p class="hint">${esc(ab)}: sem dados.</p>`;
  return `<div class="trader" style="gap:8px"><div class="card-top"><b>${esc(ab)}${papel ? ` <span class="muted">· ${papel}</span>` : ""}</b>
    <span class="muted">blowout em ${pc(t.blowout)} dos jogos (${t.jogos})</span></div>
    <div class="hint">Ganhando 16+ no fim do 3º: ${politica(polAtual(t, "ganhando"))}</div>
    <div class="hint">Perdendo 16+: ${politica(polAtual(t, "perdendo"))}</div>
    ${listaMin(t)}${listaClutch(t)}</div>`;
}

function jogoBloco(g) {
  const h = g.handicap;
  const c = chanceDe(h);
  const fav = h == null || h === 0 ? null : h < 0 ? g.casa : g.fora;
  const azr = fav === g.casa ? g.fora : fav ? g.casa : null;
  const ind = c
    ? `<div class="hint" style="display:grid;gap:4px">
        <div>${barra(c.fav16, UNDER)}<b>${pc(c.fav16)}</b> ${esc(fav)} (favorito) ganhando por 16+ no fim do 3º</div>
        <div>${barra(c.azarao16, UNDER)}<b>${pc(c.azarao16)}</b> ${esc(azr)} (azarão) ganhando por 16+</div>
        <div>${barra(c.parelho5, OVER)}<b>${pc(c.parelho5)}</b> parelho (até 5) a 5:00 do fim</div>
        <div class="muted">Pelo handicap ${n1(Math.abs(h))} (faixa ${esc(c.faixa)}: ${c.n} jogos de 2025-26 e 2026-27).</div></div>`
    : `<p class="hint">Sem handicap ainda.</p>`;
  return `<section style="margin-top:22px"><div class="sec-head"><h2>${esc(g.fora)} @ ${esc(g.casa)}</h2>
    <span class="muted">handicap do mandante ${h ?? "–"} · total ${g.total ?? "–"}</span></div>${ind}
    <div class="cards" style="margin-top:10px">${timeBloco(g.fora, CEN.times[g.fora], g.fora === fav ? "favorito" : fav ? "azarão" : "")}${timeBloco(g.casa, CEN.times[g.casa], g.casa === fav ? "favorito" : fav ? "azarão" : "")}</div></section>`;
}

function tabelaTimes() {
  const L = Object.entries(CEN.times).sort((a, b) => b[1].blowout - a[1].blowout);
  const cel = (p) => (p ? `${n1(p.min)} <span class="muted">(${p.n})</span> ${chipPol(p)}` : `<span class="muted">–</span>`);
  const linhas = L.map(([ab, t]) => `<tr><td><b>${esc(ab)}</b></td><td>${pc(t.blowout)} <span class="muted">${t.ganhando16}V ${t.perdendo16}D</span></td>
    <td>${cel(t.ganhando)}</td><td>${cel(t.ganhando_atual)}</td><td>${cel(t.perdendo)}</td><td>${cel(t.perdendo_atual)}</td>
    <td class="hint">${t.perdem.slice(0, 2).map((j) => esc(j.nome)).join(", ") || "–"}</td><td class="hint">${t.ganham.slice(0, 2).map((j) => esc(j.nome)).join(", ") || "–"}</td></tr>`).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Blowout (16+ no fim do 3º)</th><th>Q4 ganhando 16+</th><th>só 2026-27</th>
    <th>Q4 perdendo 16+</th><th>só 2026-27</th><th>Mais perdem minutos</th><th>Mais ganham</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

function regras() {
  const bloco = (t, L) => `<div class="trader" style="gap:6px"><b>${t}</b><ul class="hint" style="margin:0;padding-left:18px">${L.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  return `<div class="cards">${bloco("Blowout", CEN.regras.blowout)}${bloco("Clutch", CEN.regras.clutch)}${bloco("Rotação", CEN.regras.rotacao)}</div>`;
}

export async function mostrarCenarios(el, dia) {
  try {
    if (!CEN) CEN = await fetch("data/padroes/cenarios.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  } catch (e) {
    el.innerHTML = `<p class="erro">Não consegui ler os cenários (${esc(e.message)}).</p>`;
    return;
  }
  const lg = CEN.liga;
  const jogos = dia?.jogos || [];
  el.innerHTML = `<p class="hint">Como cada time reage ao blowout e quem decide o fim parelho, com base em ${esc(CEN.temporadas)} (atualizado em ${new Date(CEN.gerado_em).toLocaleDateString("pt-BR")}).
    Na liga, os 5 que mais jogaram até o fim do 3º fazem ${n1(lg.normal[0])} min no Q4 em jogo normal, ${n1(lg.ganhando[0])} ganhando por 16+ e ${n1(lg.perdendo[0])} perdendo por 16+.
    <b>Tira cedo</b> = menos de 85% do que a liga faz na mesma situação; <b>mantém</b> = mais de 115%. Quando a temporada atual tem 4+ jogos na situação, vale ela (técnico novo muda a política). ${esc(CEN.notas)}</p>
    <h2 style="margin-top:18px">Jogos do dia</h2>${jogos.length ? jogos.map(jogoBloco).join("") : `<p class="muted">Sem jogos neste dia.</p>`}
    <h2 style="margin-top:26px">Regras da liga</h2>${regras()}
    <h2 style="margin-top:26px">Todos os times</h2><p class="hint">Minutos no Q4 dos 5 que mais jogaram até o fim do 3º (entre parênteses, nº de jogos). Ordem: mais jogos de blowout primeiro.</p>${tabelaTimes()}`;
}
