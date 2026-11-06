// Padrões por jogador (padroes.html): lê data/padroes/<dia>.json, gerado no PC por nba_pbp/analise_dia.py.
import { $, esc } from "./formato.js";

const MERC = { points: "Pontos", rebounds: "Rebotes", assists: "Assist.", threes: "3PM", pra: "PRA" };
const CHAVE = { points: "pts", rebounds: "reb", assists: "ast", threes: "tpm", pra: "pra" };
const num = (v, c = 1) => (v == null ? "–" : Number(v).toFixed(c).replace(".", ","));
let RUIDO = null; // fração dos testes que passa por acaso (calibrada em analise_dia.py)
const sinal = (v, c = 1) => (v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(c).replace(".", ","));

async function json(u) {
  const r = await fetch(u, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
}

function linhasHtml(j) {
  const ls = Object.entries(j.linhas || {});
  if (!ls.length) return `<p class="muted">Sem linha da DraftKings.</p>`;
  const rec = j.recente;
  const linhas = ls.map(([mk, x]) => {
    const k = CHAVE[mk];
    return `<tr><td>${MERC[mk]}</td><td class="num">${num(x.l)}${x.abriu != null && x.abriu !== x.l ? ` <small class="muted">(abriu ${num(x.abriu)})</small>` : ""}</td>
      <td class="num">${x.over ? Math.round(100 * x.over) + "%" : "–"}</td><td class="num">${num(j.edgely?.[k])}</td>
      <td class="num">${rec ? num(rec.media[k]) : "–"}</td><td class="num">${rec?.acima?.[mk] ?? "–"}</td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Mercado</th><th>Linha DK</th><th>Over</th><th>Edgely</th><th>Últimos ${rec?.n ?? ""}</th><th>Acima</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

const ESTAT = { pts: "pontos", fga: "arremessos", reb: "rebotes", ast: "assistências", tpm: "cestas de 3", margem: "placar do time", pf: "faltas" };
const CORTE = { 12: "fim do 1º quarto", 24: "intervalo", 36: "fim do 3º quarto" };

function reguaHtml(rg) {
  if (!rg) return "";
  const linha = (k, nome) => {
    const r = rg[k];
    if (!r) return "";
    const it = ["pts", "fga", "reb", "ast", "tpm"].map((s) => `${ESTAT[s]} ${r[s].ruim < 0 ? "–" : "≤ " + r[s].ruim} · ${num(r[s].esperado)} · ≥ ${r[s].bom}`).join(" &nbsp;|&nbsp; ");
    return `<li><b>${nome}</b> (jogando ~${num(r.min_tipico)} min): ruim · esperado · bom → ${it}</li>`;
  };
  return `<details><summary class="muted">O que é começo bom ou ruim para ele</summary><ul class="regras">${linha("12", "1º quarto")}${linha("24", "1º tempo")}</ul>
    <p class="hint">Com mais ou menos minutos que o típico, a régua muda junto. "–" = não dá para ficar abaixo de zero.</p></details>`;
}

function achadoHtml(a) {
  const per = a.per.map((v) => sinal(v, 2)).join(" / ");
  const nc = a.no_corte ? ` · nesses jogos, ${a.no_corte.estat === "margem" ? "placar" : ESTAT[a.no_corte.estat]} no ${CORTE[a.corte]}: ${a.no_corte.estat === "margem" ? sinal(a.no_corte.media) : num(a.no_corte.media)} em média` : "";
  const liga = a.liga == null ? "" : ` · liga ${sinal(a.liga, 2)}${a.comum_liga ? " (comum à liga)" : ""}`;
  return `<li><span class="chip" style="${a.classe === "forte" ? "" : "background:var(--warn-bg);color:var(--warn)"}">${a.classe}</span>
    <b>${esc(a.situacao)}</b> → ${esc(a.metrica)}: <b>${num(a.real)}</b> × ${num(a.padrao)} do padrão no resto do jogo
    <small class="muted">(${a.n} jogos${nc} · dif. ${sinal(a.d, 2)} · P ${num(a.p, 3)} · períodos ${per}${liga})</small></li>`;
}

function jogadorHtml(j) {
  const e = j.edgely;
  const fp = j.fim_parelho;
  const base = j.base_outro_time
    ? `<span class="tag-les">base de outro time ou papel: ${j.jogos_time_atual} jogos no time atual</span>`
    : `<span class="muted">${j.jogos_base} jogos na base</span>`;
  const proprios = j.achados.filter((a) => !a.comum_liga);
  const comuns = j.achados.filter((a) => a.comum_liga);
  const acaso = RUIDO ? `${num(j.testes * RUIDO.forte)} forte e ${num(j.testes * RUIDO.candidato)} candidato(s)` : "";
  const contagem = j.testes ? `<p class="hint">${j.testes} testes; só por acaso, sairiam ~${acaso}. Achado isolado pode ser sorte; vale mais o que combina com outros (mesma situação em várias estatísticas) ou com o que você já viu nos jogos.</p>` : "";
  return `<article class="panel" style="margin:10px 0">
    <div class="sec-head"><h3 style="margin:0">${esc(j.nome)} <small class="muted">${esc(j.time)}</small></h3>
      <span class="muted">titular provável (${esc(j.origem)}) · ${base}</span></div>
    ${e ? `<p class="hint">Edgely: ${num(e.min)} min · ${num(e.pts)} pts · ${num(e.reb)} reb · ${num(e.ast)} ast · ${num(e.tpm)} 3PM · PRA ${num(e.pra)}</p>` : ""}
    ${linhasHtml(j)}
    ${fp ? `<p class="hint">Fim de jogo parelho (últimos 5 min, até 5 pontos; ${fp.min} min em ${fp.jogos} jogos): ${num(fp.pts36)} × ${num(fp.pts36_resto)} pontos por 36 · parte no volume do time ${num(100 * fp.parte)}% × ${num(100 * fp.parte_resto)}%${fp.posicao ? ` · ${fp.posicao}º maior aumento de ${fp.de}` : ""}</p>` : ""}
    <h4 style="margin:10px 0 4px">Situações do jogo</h4>${reguaHtml(j.regua)}${contagem}
    ${proprios.length ? `<ul class="regras">${proprios.map(achadoHtml).join("")}</ul>` : `<p class="muted">Nada firme dele: em ${j.testes} testes, nenhuma situação passou do critério além do que a liga já faz.</p>`}
    ${comuns.length ? `<details><summary class="muted">${comuns.length} efeito(s) que quase todo jogador tem</summary><ul class="regras">${comuns.map(achadoHtml).join("")}</ul></details>` : ""}
  </article>`;
}

function jogoHtml(g) {
  const ini = g.inicio ? new Date(g.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const les = Object.entries(g.lesoes || {}).filter(([, v]) => v.length).map(([t, v]) => `${esc(t)}: ${v.map(esc).join(", ")}`).join(" · ");
  return `<section style="margin-top:22px"><div class="sec-head"><h2>${esc(g.fora)} @ ${esc(g.casa)}</h2>
    <span class="muted">${ini} · handicap do mandante ${g.handicap ?? "–"} · total ${g.total ?? "–"}</span></div>
    ${les ? `<p class="hint">Fora ou em dúvida: ${les}</p>` : ""}
    ${g.jogadores.map(jogadorHtml).join("")}</section>`;
}

async function mostrar(dia) {
  try {
    const d = await json(`data/padroes/${dia}.json`);
    RUIDO = d.ruido || null;
    $("#gerado").textContent = `gerado em ${new Date(d.gerado_em).toLocaleString("pt-BR")}`;
    $("#criterios").textContent = [d.definicoes, d.criterios].filter(Boolean).join(" ");
    $("#jogos").innerHTML = d.jogos.length ? d.jogos.map(jogoHtml).join("") : `<p class="muted">Sem jogos neste dia.</p>`;
  } catch (e) {
    $("#jogos").innerHTML = `<p class="erro">Não consegui ler a análise de ${esc(dia)} (${esc(e.message)}).</p>`;
  }
}

(async () => {
  let datas = [];
  try { datas = (await json("data/padroes/indice.json")).datas; } catch { /* sem índice ainda */ }
  const sel = $("#data");
  sel.innerHTML = datas.map((d) => `<option value="${d}">${d.split("-").reverse().join("/")}</option>`).join("");
  sel.onchange = () => mostrar(sel.value);
  if (datas.length) mostrar(datas[0]);
  else $("#jogos").innerHTML = `<p class="muted">Ainda não há análise publicada.</p>`;
})();
