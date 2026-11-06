// Padrões por jogador (padroes.html): lê data/padroes/<dia>.json, gerado no PC por nba_pbp/analise_dia.py.
import { $, esc } from "./formato.js";
import { contarAte, margemAte, fechou, condicao, variaveis, tempoDe, emQuadra } from "./jogada.js";

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
    ${j.rotacao?.voltas?.length ? `<p class="hint"><b>Rotação</b> (últimos ${j.rotacao.jogos} jogos; entrar ao vivo ~1 min antes da volta, com ele no banco): ${j.rotacao.voltas.map((v) => `sai ${esc(v.saiu)}, volta ${voltaTxt(v)} (${v.jogos}/${j.rotacao.jogos} jogos, ${num(v.banco_min)} min sentado) → <b>entrar ${entradaTxt(v)}</b>`).join(" · ")}</p>` : ""}
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
    DIA = d;
    resumos.clear();
    if (aba === "vivo") atualizarVivo();
  } catch (e) {
    $("#jogos").innerHTML = `<p class="erro">Não consegui ler a análise de ${esc(dia)} (${esc(e.message)}).</p>`;
  }
}

// ---------- Ao vivo: o lance a lance da ESPN diz se a situação de cada achado aconteceu ----------
const ESPN_NBA = "/apis/site/v2/sports/basketball/nba";
const ESPN_DIRETO = "https://site.api.espn.com";
const PERIODO = { 12: 1, 24: 2, 36: 3 };
const CHAVE_M = { pontos: "pts", arremessos: "fga", rebotes: "reb", "assistências": "ast", "cestas de 3": "tpm", "tentativas de 3": "tpa", "lances livres": "fta" };
let DIA = null, aba = "pre", RELAY = null, rodando = false;
const resumos = new Map(); // jogo → summary já encerrado (não busca de novo)

async function espn(caminho) {
  if (RELAY == null) {
    const cfg = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    let relay = cfg.relay || "";
    try { relay = JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}").relay || relay; } catch { /* padrão */ }
    RELAY = relay.replace(/\/$/, "");
  }
  // pelo relay (como a aba de props); se ele falhar, direto na ESPN
  const urls = RELAY ? [`${RELAY}/espn${ESPN_NBA}${caminho}`, `${ESPN_DIRETO}${ESPN_NBA}${caminho}`] : [`${ESPN_DIRETO}${ESPN_NBA}${caminho}`];
  for (const u of urls) {
    const r = await fetch(u, { cache: "no-store" }).catch(() => null);
    if (r?.ok) return r.json();
  }
  throw new Error("ESPN sem resposta");
}

const ESTADO = {
  ativou: ["✔ aconteceu", "background:var(--good-bg);color:var(--good)"],
  nao: ["não aconteceu", "background:var(--bg);color:var(--ink-3)"],
  espera: ["aguardando", "background:var(--warn-bg);color:var(--warn)"],
  antes: ["antes do jogo", "background:var(--bg);color:var(--ink-3)"],
};

function parcialTxt(a, st, margem) {
  const k = /z_(\w+)/.exec(a.cond)?.[1];
  if (k) return `agora: ${st?.[k] ?? 0} ${ESTAT[k]}`;
  if (a.cond.includes("pf")) return `agora: ${st?.pf ?? 0} faltas`;
  if (a.cond.includes("margem")) return `placar agora: ${sinal(margem, 0)}`;
  return "";
}

// Volta no começo do quarto (sentou no fim do anterior): a janela é o fim do quarto anterior / a pausa entre eles.
const voltaTxt = (v) => (v.volta === "12:00" ? `no início do Q${v.quarto}` : `no Q${v.quarto} com ~${v.volta}`);
const entradaTxt = (v) => (v.volta === "12:00" ? `no fim do Q${v.quarto - 1} ou na pausa` : `~Q${v.quarto} ${v.entrada}`);
const relogioTxt = (t) => { const r = Math.round(720 - (t % 720 || (t ? 720 : 0))); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };

function vivoJogo(g, s) {
  const comp = s?.header?.competitions?.[0];
  const status = comp?.status;
  const comecou = status && status.type?.state !== "pre";
  const per = status?.period ?? 0;
  const placar = comp ? comp.competitors.map((c) => `${esc(c.team.abbreviation)} ${c.score ?? 0}`).join(" × ") : "";
  const quando = !comecou ? "antes do jogo" : esc(status.type?.shortDetail || "");
  const ativos = [], janelas = [];
  const tAgora = comecou ? tempoDe(per, status.displayClock) : -1;
  const titulares = new Set((s?.boxscore?.players || []).flatMap((t) => (t.statistics?.[0]?.athletes || []).filter((a) => a.starter).map((a) => a.athlete?.id)));
  const jogs = g.jogadores.map((j) => {
    const vivos = j.achados.filter((a) => a.cond && !a.cond.includes(" in fora") && !a.comum_liga);
    const pre = j.achados.filter((a) => a.cond?.includes(" in fora") && !a.comum_liga);
    // Rotação: em quadra ou no banco, e se está na janela (até 2,5 min antes da volta típica neste quarto)
    let rotHtml = "";
    const rot = j.rotacao;
    if (rot?.voltas?.length && comecou && !status.type?.completed) {
      const st = emQuadra(s.plays, j.aid, titulares.has(j.aid));
      const v = rot.voltas.find((x) => x.quarto === Math.min(per, 4) && tAgora <= x.volta_t + 30) || rot.voltas.find((x) => x.volta_t > tAgora);
      const janela = !st.quadra && v && tAgora >= v.volta_t - 150 && tAgora <= v.volta_t + 30;
      if (janela) janelas.push({ j, v });
      const onde = st.quadra ? "em quadra" : `no banco desde Q${Math.min(Math.floor(st.desde / 720) + 1, 4)} ${relogioTxt(st.desde)}`;
      rotHtml = `<p class="hint" style="${janela ? "background:var(--good-bg);color:var(--good);padding:4px 8px;border-radius:6px" : ""}">${janela ? "⏱ <b>janela de entrada agora</b> · " : ""}${onde}${v ? ` · volta típica ${voltaTxt(v)} (entrar ${entradaTxt(v)}, ${v.jogos}/${rot.jogos} jogos)` : ""}</p>`;
    } else if (rot?.voltas?.length) {
      rotHtml = `<p class="hint">Rotação (últimos ${rot.jogos} jogos): ${rot.voltas.map((v) => `volta ${voltaTxt(v)} → entrar ${entradaTxt(v)}`).join(" · ")}</p>`;
    }
    if (!vivos.length && !pre.length && !rotHtml) return "";
    const linhas = vivos.map((a) => {
      const p = PERIODO[a.corte];
      let est = "antes", extra = "";
      if (comecou) {
        const fechado = fechou(status, p);
        const st = contarAte(s.plays, fechado ? p : per)[j.aid];
        const margem = margemAte(comp.competitors, j.time, fechado ? p : per);
        if (fechado) {
          const v = variaveis(st, j.regua?.[String(a.corte)], margem, []);
          est = condicao(a.cond)(v) ? "ativou" : "nao";
          extra = parcialTxt(a, st, margem).replace("agora", "no corte").replace("placar agora", "placar no corte");
        } else { est = "espera"; extra = parcialTxt(a, st, margem); }
      }
      // jogo encerrado: o que ele fez depois do corte, para conferir o achado (minutos não saem do lance a lance)
      const k = CHAVE_M[a.metrica];
      if (est === "ativou" && status.type?.completed && k) {
        const depois = (contarAte(s.plays, 4)[j.aid]?.[k] ?? 0) - (contarAte(s.plays, PERIODO[a.corte])[j.aid]?.[k] ?? 0);
        const certo = (depois - a.padrao) * (a.real - a.padrao) > 0;
        extra += ` · depois fez ${depois} (achado ${num(a.real)}, padrão ${num(a.padrao)}) ${certo ? "→ foi para o lado do achado" : "→ não foi"}`;
      }
      if (est === "ativou") ativos.push({ j, a });
      const [rot, cor] = ESTADO[est];
      return `<li style="${est === "nao" ? "opacity:.55" : ""}"><span class="chip" style="${cor}">${rot}</span>
        <b>${esc(a.situacao)}</b> → ${esc(a.metrica)}: <b>${num(a.real)}</b> × ${num(a.padrao)} no resto do jogo
        <small class="muted">(${a.classe}, ${a.n} jogos${extra ? " · " + esc(extra) : ""})</small></li>`;
    }).join("");
    const preHtml = pre.map((a) => `<li><span class="chip">pré-jogo</span> <b>${esc(a.situacao)}</b> → ${esc(a.metrica)}: <b>${num(a.real)}</b> × ${num(a.padrao)} <small class="muted">(${a.classe}, ${a.n} jogos; vale o jogo todo se ele seguir fora)</small></li>`).join("");
    return `<article class="panel" style="margin:8px 0"><h3 style="margin:0 0 4px">${esc(j.nome)} <small class="muted">${esc(j.time)}</small></h3>${rotHtml}
      ${preHtml ? `<h4 style="margin:6px 0 2px">Pré-jogo</h4><ul class="regras">${preHtml}</ul>` : ""}
      ${linhas ? `<h4 style="margin:6px 0 2px">Ao vivo</h4><ul class="regras">${linhas}</ul>` : ""}</article>`;
  }).join("");
  return { ativos, janelas, html: `<section style="margin-top:22px"><div class="sec-head"><h2>${esc(g.fora)} @ ${esc(g.casa)}</h2><span class="muted">${placar} · ${quando}</span></div>${jogs || '<p class="muted">Nenhum achado próprio dos titulares neste jogo.</p>'}</section>` };
}

async function atualizarVivo() {
  if (!DIA || rodando || document.hidden) return;
  rodando = true;
  try {
    await Promise.all(DIA.jogos.map(async (g) => {
      if (resumos.get(g.id)?.header?.competitions?.[0]?.status?.type?.completed) return;
      try { resumos.set(g.id, await espn(`/summary?event=${g.id}`)); } catch { /* fica com o anterior */ }
    }));
    const partes = DIA.jogos.map((g) => vivoJogo(g, resumos.get(g.id)));
    const ativos = partes.flatMap((p) => p.ativos);
    const janelas = partes.flatMap((p) => p.janelas);
    const janHtml = janelas.length
      ? `<div class="panel" style="border-color:var(--accent);margin-bottom:10px"><h2 style="margin:0 0 6px">⏱ Janelas de entrada agora (${janelas.length})</h2><ul class="regras">${janelas.map(({ j, v }) => `<li><b>${esc(j.nome)}</b> (${esc(j.time)}) está no banco; costuma voltar ${voltaTxt(v)} (${v.jogos} dos últimos ${j.rotacao.jogos} jogos)</li>`).join("")}</ul></div>`
      : "";
    const topo = ativos.length
      ? `<div class="panel" style="border-color:var(--good)"><h2 style="margin:0 0 6px">Situações que aconteceram (${ativos.length})</h2><ul class="regras">${ativos.map(({ j, a }) => `<li><b>${esc(j.nome)}</b> (${esc(j.time)}): ${esc(a.situacao)} → ${esc(a.metrica)} <b>${num(a.real)}</b> × ${num(a.padrao)} no resto do jogo <small class="muted">(${a.classe}, ${a.n} jogos)</small></li>`).join("")}</ul></div>`
      : `<p class="muted">Nenhuma situação dos achados aconteceu ainda.</p>`;
    $("#vivo").innerHTML = `${janHtml}<p class="hint">Atualiza a cada 60 s com a aba aberta (atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}). Em quadra/no banco vem das substituições do lance a lance (aproximado: trocas entre quartos não são registradas). O começo bom/ruim é medido pela régua dele com os minutos típicos; se ele jogou bem mais ou bem menos no período, confira. Só achados próprios do jogador (sem os comuns à liga).</p>${topo}${partes.map((p) => p.html).join("")}`;
  } finally { rodando = false; }
}

function trocarAba(nova) {
  aba = nova;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.aba === nova));
  $("#jogos").hidden = nova !== "pre";
  $("#criterios").hidden = nova !== "pre";
  $("#vivo").hidden = nova !== "vivo";
  if (nova === "vivo") { $("#vivo").innerHTML ||= `<p class="muted">buscando os jogos…</p>`; atualizarVivo(); }
}

(async () => {
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => trocarAba(b.dataset.aba);
  setInterval(() => { if (aba === "vivo") atualizarVivo(); }, 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && aba === "vivo") atualizarVivo(); });
  let datas = [];
  try { datas = (await json("data/padroes/indice.json")).datas; } catch { /* sem índice ainda */ }
  const sel = $("#data");
  sel.innerHTML = datas.map((d) => `<option value="${d}">${d.split("-").reverse().join("/")}</option>`).join("");
  sel.onchange = () => mostrar(sel.value);
  if (datas.length) mostrar(datas[0]);
  else $("#jogos").innerHTML = `<p class="muted">Ainda não há análise publicada.</p>`;
})();
