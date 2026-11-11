// Padrões por jogador (padroes.html): lê data/padroes/<dia>.json, gerado no PC por nba_pbp/analise_dia.py.
// 12/11/2026 (usuário: "muita informação, confuso"): Pré-jogo e Ao vivo viraram UMA aba ("Jogadores"), enxuta — por
// jogador: minutos previstos, rotação (com o estado ao vivo e a janela de entrada), fim de jogo parelho e só os padrões de
// FORÇA ALTA (o resto estava no nível do acaso). Linhas e projeções ficam na página de props; a aba "Blowout e clutch"
// saiu (o Painel mostra em destaque).
import { $, esc } from "./formato.js";
import { mostrarPainel } from "./painel.js";
import { mostrarCasaVivo } from "./casavivo.js";
import { ouvirCampeon } from "./campeon.js";
import { contarAte, margemAte, fechou, condicao, variaveis, tempoDe, emQuadra, consertarResumo } from "./jogada.js";

const num = (v, c = 1) => (v == null ? "–" : Number(v).toFixed(c).replace(".", ","));

async function json(u) {
  const r = await fetch(u, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
}

// ---------- ESPN (relay; se ele falhar, direto) ----------
const ESPN_NBA = "/apis/site/v2/sports/basketball/nba";
const ESPN_DIRETO = "https://site.api.espn.com";
let DIA = null, aba = "jog", RELAY = null, rodando = false;
const resumos = new Map(); // jogo → summary (os encerrados não são buscados de novo)

async function espn(caminho) {
  if (RELAY == null) {
    const cfg = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    let relay = cfg.relay || "";
    try { relay = JSON.parse(localStorage.getItem("traderpoly.cfg") || "{}").relay || relay; } catch { /* padrão */ }
    RELAY = relay.replace(/\/$/, "");
  }
  const urls = RELAY ? [`${RELAY}/espn${ESPN_NBA}${caminho}`, `${ESPN_DIRETO}${ESPN_NBA}${caminho}`] : [`${ESPN_DIRETO}${ESPN_NBA}${caminho}`];
  for (const u of urls) {
    const r = await fetch(u, { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      return caminho.startsWith("/summary") ? consertarResumo(d) : d;
    }
  }
  throw new Error("ESPN sem resposta");
}

// ---------- padrões: só força ALTA (forte com 3+ de: efeito ≥ 15%, ≥ 30%, 25+ jogos, os dois períodos parecidos) ----------
function forcaAlta(a) {
  if (a.classe !== "forte" || a.comum_liga) return false;
  const e = a.padrao ? Math.abs(a.real / a.padrao - 1) : 0;
  const [p1, p2] = (a.per || []).map((v) => Math.abs(v));
  const parecidos = p1 != null && p2 != null && Math.min(p1, p2) >= 0.5 * Math.max(p1, p2);
  return (e >= 0.15) + (e >= 0.3) + (a.n >= 25) + parecidos >= 3;
}
const minusc = (t) => String(t).charAt(0).toLowerCase() + String(t).slice(1);
const ladoDe = (a) => (a.real > a.padrao ? "O" : "U");
const COR = { O: "var(--sig-o)", U: "var(--sig-u)" };
const SETA = { O: "↑ Over", U: "↓ Under" };
const PERIODO = { 12: 1, 24: 2, 36: 3 };

// ---------- rotação (tempos em minutos DECORRIDOS no quarto; o arquivo guarda o relógio regressivo) ----------
const mmss = (s) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };
const decorrido = (rest) => { const [m, s] = String(rest).split(":").map(Number); return mmss(720 - ((m || 0) * 60 + (s || 0))); };
const voltaTxt = (v) => (v.volta === "12:00" ? `início do Q${v.quarto}` : `Q${v.quarto} ${decorrido(v.volta)}`);
const quandoTxt = (t) => (t > 0 && t % 720 < 1 ? `fim do Q${Math.round(t / 720)}` : `Q${Math.floor(t / 720) + 1} ${mmss(t % 720)}`);
const saiuT = (v) => v.saiu_t ?? v.volta_t - 60 * (v.banco_min || 0);

// prazo de um padrão que aconteceu (a aposta é no resto do jogo): Over até 1 min depois da volta típica no quarto
// seguinte (ou 3 min do quarto); Under enquanto ele estiver sentado, até 1 min depois de voltar
function bancoDepois(plays, aid, pc, titular) {
  let quadra = emQuadra((plays || []).filter((p) => (p.period?.number ?? 0) <= pc), aid, titular).quadra, sai = pc * 720;
  const out = [];
  for (const p of plays || []) {
    const per = p.period?.number ?? 0;
    if (per <= pc) continue;
    const t = tempoDe(per, p.clock?.displayValue);
    const ids = (p.participants || []).map((x) => x.athlete?.id);
    const sub = /substitution/i.test(p.type?.text || "");
    if (quadra && sub && ids[1] === aid) { quadra = false; sai = t; }
    else if (!quadra && (sub ? ids[0] === aid : ids.includes(aid) && t > sai)) { quadra = true; out.push({ sai, volta: t }); }
  }
  if (!quadra) out.push({ sai, volta: null });
  return out;
}
function entradaDe(a, j, plays, stQ, titular, tAgora) {
  const pc = PERIODO[a.corte], tc = pc * 720;
  if (ladoDe(a) === "O") {
    const v = j.rotacao?.voltas?.find((x) => x.quarto === pc + 1 && x.volta_t > tc + 30);
    let prazo = v ? v.volta_t + 60 : tc + 180;
    for (const p of plays || []) {
      if ((p.period?.number ?? 0) <= pc) continue;
      const ids = (p.participants || []).map((x) => x.athlete?.id);
      if (/substitution/i.test(p.type?.text || "") ? ids[0] === j.aid : ids.includes(j.aid)) { prazo = Math.min(prazo, tempoDe(p.period.number, p.clock?.displayValue) + 60); break; }
    }
    const vv = j.rotacao?.voltas?.find((x) => x.volta_t > Math.max(tAgora, tc) - 30);
    return { prazo, agora: !!(stQ && !stQ.quadra && vv && tAgora >= vv.volta_t - 150), txt: stQ && !stQ.quadra ? `no banco: entrar ~1 min antes da volta${vv ? ` (${voltaTxt(vv)})` : ""}` : "" };
  }
  const b = bancoDepois(plays, j.aid, pc, titular);
  if (b[0]?.volta != null) return { prazo: b[0].volta + 60, agora: false, txt: `voltou ${quandoTxt(b[0].volta)}` };
  if (b[0]) {
    const v = j.rotacao?.voltas?.find((x) => x.volta_t > Math.max(b[0].sai, tc) + 30);
    return { prazo: Math.max(tAgora, v?.volta_t ?? 0) + 60, agora: true, txt: `sentado: vale até ele voltar${v ? ` (${voltaTxt(v)})` : ""}` };
  }
  const v = j.rotacao?.voltas?.find((x) => saiuT(x) > tAgora - 60 && x.volta_t > tc + 30);
  return v ? { prazo: v.volta_t + 60, agora: false, txt: `esperar ele sentar (~${quandoTxt(saiuT(v))})` } : { prazo: tc + 180, agora: false, txt: "" };
}

// ---------- uma linha por jogador ----------
function minutosCel(j) {
  const m = j.min_final ?? j.min_proj ?? j.edgely?.min;
  const fontes = [j.min_proj != null && `nossa ${num(j.min_proj)}`, j.min_mercado != null && `mercado ${num(j.min_mercado)}`, j.min_hist != null && `recente ${num(j.min_hist)}`, j.darko?.min != null && `DARKO ${num(j.darko.min)}`, j.edgely?.min != null && `Edgely ${num(j.edgely.min)}`].filter(Boolean).join(" · ");
  return `<td class="n"><b class="jg-min">${num(m)}</b><small>${fontes}</small></td>`;
}

function clutchCel(j) {
  const fp = j.fim_parelho;
  if (!fp || !fp.pts36_resto) return `<td><span class="muted">–</span></td>`;
  const r = fp.pts36 / fp.pts36_resto, u = fp.parte_resto ? fp.parte / fp.parte_resto : 1;
  const [t, c] = r >= 1.15 || u >= 1.15 ? ["assume", "var(--sig-o)"] : r <= 0.87 || u <= 0.87 ? ["some", "var(--sig-u)"] : ["igual", "var(--ink-3)"];
  return `<td><span class="chip" style="color:${c};border:1px solid ${c};background:transparent">${t}</span><small>${num(fp.pts36)} × ${num(fp.pts36_resto)} pts/36 · uso ${Math.round(100 * fp.parte)}% × ${Math.round(100 * fp.parte_resto)}% (${fp.jogos} j)</small></td>`;
}

function rotacaoCel(j, ctx) {
  const rot = j.rotacao;
  const vs = rot?.voltas || [];
  if (ctx.vivo && ctx.stQ) {
    const st = ctx.stQ, t = ctx.tAgora, per = ctx.per;
    const v = vs.find((x) => x.quarto === Math.min(per, 4) && t <= x.volta_t + 30) || vs.find((x) => x.volta_t > t);
    const janela = !st.quadra && v && t >= v.volta_t - 150 && t <= v.volta_t + 30;
    const prox = vs.find((x) => saiuT(x) > t);
    const onde = st.quadra ? `<b style="color:var(--good)">● em quadra</b>${prox ? `<small>costuma sentar ${quandoTxt(saiuT(prox))}</small>` : ""}`
      : `<b style="color:var(--ink-3)">○ banco</b> desde ${quandoTxt(st.desde)}${v ? `<small>volta típica ${voltaTxt(v)} (${v.jogos}/${rot.jogos})</small>` : ""}`;
    return { html: `<td${janela ? ' class="jg-janela"' : ""}>${janela ? "⏱ <b>janela Over agora</b><br>" : ""}${onde}</td>`, janela: janela ? v : null };
  }
  if (!vs.length) return { html: `<td><span class="muted">–</span></td>`, janela: null };
  return { html: `<td>${vs.slice(0, 3).map((v) => `${quandoTxt(saiuT(v))} → ${voltaTxt(v)} <span class="muted">(${v.jogos}/${rot.jogos})</span>`).join("<br>")}</td>`, janela: null };
}

// padrões de força alta do jogador: antes do jogo todos; ao vivo, só os que ainda podem acontecer ou estão em aberto
function padroesCel(j, g, ctx) {
  const out = [], abertos = [];
  for (const a of j.achados.filter(forcaAlta)) {
    const lado = ladoDe(a), pre = a.cond?.includes(" in fora");
    let estado = "", destaque = false;
    if (ctx.comecou && !pre && a.cond) {
      const p = PERIODO[a.corte];
      const fech = fechou(ctx.status, p);
      const st = contarAte(ctx.s.plays, fech ? p : ctx.per)[j.aid];
      if (!fech) estado = "aguardando o corte";
      else {
        const ok = condicao(a.cond)(variaveis(st, j.regua?.[String(a.corte)], margemAte(ctx.comp.competitors, j.time, p), []));
        if (!ok) continue; // não aconteceu: some
        const ent = entradaDe(a, j, ctx.s.plays, ctx.stQ, ctx.titular, ctx.tAgora);
        if (ctx.acabou || ctx.tAgora > ent.prazo) continue; // prazo passou: some
        estado = `✔ aconteceu · ${ent.agora ? "⏱ janela agora · " : ""}${ent.txt ? ent.txt + " · " : ""}até ${quandoTxt(ent.prazo)}`;
        destaque = true;
        abertos.push({ j, a, ent });
      }
    } else if (ctx.comecou && pre) continue; // "colega fora" é de antes do jogo
    out.push(`<div class="jg-pad${destaque ? " ativo" : ""}" style="border-left-color:${COR[lado]}"><b style="color:${COR[lado]}">${SETA[lado]}</b> ${esc(a.metrica)} <b>${num(a.real)}</b> × ${num(a.padrao)} <span class="muted">se ${esc(minusc(a.situacao))} (${a.n} j)</span>${estado ? `<small>${esc(estado)}</small>` : ""}</div>`);
  }
  return { html: `<td>${out.join("") || '<span class="muted">–</span>'}</td>`, abertos };
}

function jogoHtml(g, s) {
  const comp = s?.header?.competitions?.[0];
  const status = comp?.status;
  const comecou = !!status && status.type?.state !== "pre";
  const acabou = !!status?.type?.completed;
  const per = status?.period ?? 0;
  const tAgora = comecou ? (acabou ? 1e9 : tempoDe(per, status.displayClock)) : -1;
  const vivo = comecou && !acabou;
  const titulares = new Set((s?.boxscore?.players || []).flatMap((t) => (t.statistics?.[0]?.athletes || []).filter((a) => a.starter).map((a) => a.athlete?.id)));
  const ini = g.inicio ? new Date(g.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const placar = comp ? comp.competitors.map((c) => `${esc(c.team.abbreviation)} ${c.score ?? 0}`).join(" × ") : "";
  const quando = comecou ? `${placar} · ${esc(status.type?.shortDetail || "")}` : `${ini}`;
  const fav = g.handicap == null || g.handicap === 0 ? "" : ` · ${esc(g.handicap < 0 ? g.casa : g.fora)} favorito por ${num(Math.abs(g.handicap))} · total ${num(g.total)}`;
  const out = Object.entries(g.lesoes || {}).flatMap(([t, v]) => v.filter((x) => /\((Out|Doubtful)\)/.test(x)).map((x) => `${esc(t)} ${esc(x.replace(/ \(.*$/, ""))}`));
  const janelas = [], abertos = [];
  const linhas = [g.fora, g.casa].map((time) => {
    const js = g.jogadores.filter((j) => j.time === time).sort((a, b) => (b.min_final ?? b.min_proj ?? 0) - (a.min_final ?? a.min_proj ?? 0));
    if (!js.length) return "";
    return `<tr class="grupo"><td colspan="5"><b>${esc(time)}</b></td></tr>` + js.map((j) => {
      const ctx = { comecou, acabou, vivo, per, tAgora, status, comp, s, stQ: vivo ? emQuadra(s.plays, j.aid, titulares.has(j.aid)) : null, titular: titulares.has(j.aid) };
      const r = rotacaoCel(j, ctx), p = padroesCel(j, g, ctx);
      if (r.janela) janelas.push({ j, v: r.janela });
      abertos.push(...p.abertos);
      const reserva = /reserva/.test(j.origem || "");
      return `<tr${p.abertos.length || r.janela ? ' class="jg-ativo"' : ""}><td><b>${esc(j.nome)}</b>${reserva ? ' <span class="muted">reserva</span>' : ""}${j.base_outro_time ? ' <span class="tag-les" title="poucos jogos no time atual">time novo</span>' : ""}</td>${minutosCel(j)}${r.html}${clutchCel(j)}${p.html}</tr>`;
    }).join("");
  }).join("");
  return {
    janelas, abertos,
    html: `<section class="panel jogo"><div class="jogo-top"><h2>${esc(g.fora)} @ ${esc(g.casa)}</h2><span class="muted">${quando}${fav}</span></div>
      ${out.length ? `<p class="lesoes"><b>Fora:</b> ${out.join(" · ")}</p>` : ""}
      <div class="tbl-wrap"><table class="props-tab jg-tab"><thead><tr><th>Jogador</th><th class="n">Minutos<small>previstos</small></th><th>Rotação${vivo ? "<small>agora</small>" : "<small>senta → volta (últimos jogos)</small>"}</th><th>Fim parelho<small>últimos 5 min, até 5 pts</small></th><th>Padrões fortes<small>resto do jogo × o normal dele</small></th></tr></thead><tbody>${linhas}</tbody></table></div></section>`,
  };
}

async function mostrarJogadores() {
  if (!DIA || document.hidden) return;
  if (rodando) { rodando = "de novo"; return; } // dia trocado no meio: refaz no fim
  rodando = true;
  const dia = DIA;
  try {
    const hoje = Date.now() - Date.parse(dia.data) < 2 * 86400e3;
    if (hoje) await Promise.all(dia.jogos.map(async (g) => {
      if (resumos.get(g.id)?.header?.competitions?.[0]?.status?.type?.completed) return;
      if (g.inicio && Date.parse(g.inicio) - Date.now() > 20 * 60e3 && resumos.has(g.id)) return; // falta muito: não consulta de novo
      try { resumos.set(g.id, await espn(`/summary?event=${g.id}`)); } catch { /* fica com o anterior */ }
    }));
    if (dia !== DIA) return;
    const partes = dia.jogos.map((g) => jogoHtml(g, resumos.get(g.id)));
    const janelas = partes.flatMap((p) => p.janelas), abertos = partes.flatMap((p) => p.abertos);
    const agora = janelas.length || abertos.length ? `<div class="panel jg-agora"><h2>Agora</h2>
      ${janelas.map(({ j, v }) => `<div class="jg-pad ativo" style="border-left-color:var(--sig-o)"><b style="color:var(--sig-o)">⏱ ↑ Over</b> <b>${esc(j.nome)}</b> (${esc(j.time)}) no banco · costuma voltar ${voltaTxt(v)} (${v.jogos}/${j.rotacao.jogos} jogos): entrar ~1 min antes</div>`).join("")}
      ${abertos.sort((x, y) => y.ent.agora - x.ent.agora || x.ent.prazo - y.ent.prazo).map(({ j, a, ent }) => `<div class="jg-pad ativo" style="border-left-color:${COR[ladoDe(a)]}"><b style="color:${COR[ladoDe(a)]}">${ent.agora ? "⏱ " : ""}${SETA[ladoDe(a)]}</b> <b>${esc(j.nome)}</b> ${esc(a.metrica)} ${num(a.real)} × ${num(a.padrao)} <span class="muted">(${esc(minusc(a.situacao))})</span><small>${esc(ent.txt ? ent.txt + " · " : "")}até ${quandoTxt(ent.prazo)}</small></div>`).join("")}</div>` : "";
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("#jogos").innerHTML = `${agora}${partes.map((p) => p.html).join("") || '<p class="muted">Sem jogos neste dia.</p>'}
      <details class="panel"><summary class="muted">Como ler (atualizado às ${hora}, a cada 60 s)</summary><ul class="regras">
        <li><b>Minutos previstos</b>: combinação da nossa conta (quem está fora hoje), do que a linha da DK precifica, da média recente e da DARKO (erro ~4,4 min). Embaixo, cada fonte.</li>
        <li><b>Rotação</b>: quando ele costuma sentar e voltar nos últimos jogos (tempo decorrido no quarto). Ao vivo: em quadra ou no banco, e a <b>janela Over</b> (~2,5 min antes até 30 s depois da volta típica): sentado, a linha cai; na volta, sobe.</li>
        <li><b>Fim parelho</b>: pontos por 36 min e parte do volume do time nos últimos 5 min com até 5 pontos × no resto do jogo. "Assume" = 15%+ acima; "some" = 13%+ abaixo.</li>
        <li><b>Padrões fortes</b>: só os de força alta do jogador (forte, efeito grande, 25+ jogos, os dois períodos parecidos). Os demais estavam no nível do acaso e saíram. Ao vivo, o padrão some se não aconteceu ou se o prazo passou; se aconteceu, aparece em verde com o prazo (↑ Over: ~1 min antes da volta do banco; ↓ Under: enquanto ele está sentado).</li>
        <li>Linhas, projeções (Edgely, nossa, DARKO) e edge real ficam em <a href="props.html">Props NBA</a>; blowout e clutch, no Painel. Nada disso é recomendação de aposta.</li></ul></details>`;
  } finally {
    const outra = rodando === "de novo" || dia !== DIA;
    rodando = false;
    if (outra) mostrarJogadores();
  }
}

async function mostrar(dia) {
  try {
    const d = await json(`data/padroes/${dia}.json`);
    $("#gerado").textContent = `gerado em ${new Date(d.gerado_em).toLocaleString("pt-BR")}`;
    DIA = d;
    resumos.clear();
    if (aba === "jog") mostrarJogadores();
    if (aba === "painel") mostrarPainel($("#painel"), DIA, espn, true);
    if (aba === "casa") mostrarCasaVivo($("#casa"), DIA, espn);
  } catch (e) {
    $("#jogos").innerHTML = `<p class="erro">Não consegui ler a análise de ${esc(dia)} (${esc(e.message)}).</p>`;
  }
}

function trocarAba(nova) {
  aba = nova;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.aba === nova));
  $("#jogos").hidden = nova !== "jog";
  $("#painel").hidden = nova !== "painel";
  $("#casa").hidden = nova !== "casa";
  if (nova === "casa") { $("#casa").innerHTML ||= `<p class="muted">buscando os jogos…</p>`; mostrarCasaVivo($("#casa"), DIA, espn); }
  if (nova === "painel") { $("#painel").innerHTML ||= `<p class="muted">buscando o jogo…</p>`; mostrarPainel($("#painel"), DIA, espn); }
  if (nova === "jog") mostrarJogadores();
}

(async () => {
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => trocarAba(b.dataset.aba);
  setInterval(() => { if (aba === "jog") mostrarJogadores(); }, 60e3);
  setInterval(() => { if (aba === "painel") mostrarPainel($("#painel"), DIA, espn); }, 30e3);
  setInterval(() => { if (aba === "casa") mostrarCasaVivo($("#casa"), DIA, espn); }, 30e3);
  // aba Casa × Painel: captura chegando pelo endereço (#campeon=…, coletor "Abrir a comparação") ou gravada pela página
  // de props em outra janela (evento storage) → mostra na hora
  ouvirCampeon(() => trocarAba("casa"));
  addEventListener("storage", (e) => { if (e.key === "casas-coleta" && aba === "casa") mostrarCasaVivo($("#casa"), DIA, espn); });
  const pedida = new URLSearchParams(location.search).get("aba");
  if (["painel", "casa"].includes(pedida)) trocarAba(pedida);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (aba === "jog") mostrarJogadores();
    if (aba === "painel") mostrarPainel($("#painel"), DIA, espn);
    if (aba === "casa") mostrarCasaVivo($("#casa"), DIA, espn);
  });
  let datas = [];
  try { datas = (await json("data/padroes/indice.json")).datas; } catch { /* sem índice ainda */ }
  const sel = $("#data");
  sel.innerHTML = datas.map((d) => `<option value="${d}">${d.split("-").reverse().join("/")}</option>`).join("");
  sel.onchange = () => mostrar(sel.value);
  if (datas.length) mostrar(datas[0]);
  else $("#jogos").innerHTML = `<p class="muted">Ainda não há análise publicada.</p>`;
})();
