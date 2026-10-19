// Página de CS2: odd justa do time que vai para o intervalo perdendo (dados: polymarket_traders/gerar_cs2_site.py)
import { $, esc, odd } from "./formato.js";

const LINHAS = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const N_MIN = 60;
const pct = (p) => `${(100 * p).toFixed(1).replace(".", ",")}%`; // probabilidade, sem sinal
const num = (v) => v.toFixed(1).replace(".", ",");
const linhaTxt = (l) => `+${String(l).replace(".", ",")}`;

let D = null, T = null;

function filtrados() {
  const m = $("#f-mapa").value, l = $("#f-lado").value, f = $("#f-forca").value;
  return D.casos.filter((c) => (m === "" || c[2] === +m) && (l === "" || c[1] === +l) && (f === "" || c[4] === +f));
}

// chance de vencer o mapa e de cobrir cada linha, por placar no intervalo (a = rounds do time atrás)
function estat(casos) {
  const g = new Map();
  for (const c of casos) {
    if (!g.has(c[0])) g.set(c[0], []);
    g.get(c[0]).push(c[3]);
  }
  const out = new Map();
  for (const [a, mg] of g) {
    const n = mg.length;
    out.set(a, { n, vence: mg.filter((x) => x > 0).length / n, cobre: Object.fromEntries(LINHAS.map((l) => [l, mg.filter((x) => x > -l).length / n])) });
  }
  return out;
}

function tabela() {
  const e = estat(filtrados());
  const cab = `<tr><th>Intervalo</th><th class="n">Mapas</th><th class="n">Vence o mapa</th>${LINHAS.map((l) => `<th class="n">${linhaTxt(l)}</th>`).join("")}</tr>`;
  const cel = (p, n) => `<td class="n${n < N_MIN ? " pouco" : ""}">${pct(p)}<small>${odd(p)}</small></td>`;
  const linhas = [0, 1, 2, 3, 4, 5].map((a) => {
    const x = e.get(a);
    if (!x) return `<tr><td>${a}–${12 - a}</td><td class="n">0</td><td colspan="${LINHAS.length + 1}" class="muted">sem mapas</td></tr>`;
    return `<tr><td><b>${a}–${12 - a}</b></td><td class="n">${x.n}</td>${cel(x.vence, x.n)}${LINHAS.map((l) => cel(x.cobre[l], x.n)).join("")}</tr>`;
  }).join("");
  $("#tab").innerHTML = `<thead>${cab}</thead><tbody>${linhas}</tbody>`;
  valor();
}

function valor() {
  const a = +$("#v-placar").value, l = $("#v-linha").value, o = parseFloat(($("#v-odd").value || "").replace(",", "."));
  const x = estat(filtrados()).get(a);
  const r = $("#v-res");
  r.className = "valor";
  if (!x) { r.textContent = "Sem mapas com esse placar nesses filtros."; return; }
  const p = l === "vence" ? x.vence : x.cobre[+l];
  const aposta = l === "vence" ? "vencer o mapa" : `${linhaTxt(+l)} rounds`;
  if (!(o > 1)) { r.innerHTML = `${a}–${12 - a}, ${aposta}: chance ${pct(p)} em ${x.n} mapas · <b>odd justa ${odd(p)}</b>.`; return; }
  const ev = p * o - 1;
  r.classList.add(ev > 0.03 ? "bom" : ev > -0.03 ? "neutro" : "ruim");
  r.innerHTML = `${a}–${12 - a}, ${aposta}: chance ${pct(p)} em ${x.n} mapas · odd justa <b>${odd(p)}</b> · odd da casa ${o.toFixed(2).replace(".", ",")} → ` +
    `<b>${ev >= 0 ? "+" : "−"}${Math.abs(100 * ev).toFixed(0)}% de valor esperado</b>` +
    (x.n < N_MIN ? " <em>(pouca amostra)</em>" : "") + (ev > 0.03 ? "" : ev > -0.03 ? " — praticamente justo." : " — sem valor.");
}

function blocoTime(nome) {
  const t = T.times[(nome || "").trim().toLowerCase()];
  if (!nome) return "";
  if (!t) return `<div class="panel"><h3>${esc(nome)}</h3><p class="muted">Não encontrado (ou menos de 5 mapas no período).</p></div>`;
  const ordem = ["Geral", ...Object.keys(t).filter((k) => k !== "Geral").sort((a, b) => t[b][0] - t[a][0])];
  const linhas = ordem.map((mp) => {
    const [n, v, ced, gan] = t[mp];
    const d = n - v;
    return `<tr${mp === "Geral" ? ' class="geral"' : ""}><td>${esc(mp)}</td><td class="n">${n}</td><td class="n">${Math.round((100 * v) / n)}%</td>` +
      `<td class="n">${v ? num(ced / v) : "–"}</td><td class="n">${d ? num(gan / d) : "–"}</td></tr>`;
  }).join("");
  return `<div class="panel"><h3>${esc(nome)}</h3><div class="rolagem"><table class="cs2-times"><thead><tr><th>Mapa</th><th class="n">Mapas</th>` +
    `<th class="n">Vitórias</th><th class="n">Cede nas vitórias</th><th class="n">Ganha nas derrotas</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
}

function times() {
  $("#times").innerHTML = blocoTime($("#t-a").value) + blocoTime($("#t-b").value);
}

async function iniciar() {
  [D, T] = await Promise.all(["data/cs2_intervalo.json", "data/cs2_times.json"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json())));
  const base = `${D.n_mapas.toLocaleString("pt-BR")} mapas (${D.periodo[0].slice(0, 4)}–${D.periodo[1].slice(0, 4)})`;
  $("#base").textContent = base;
  $("#base2").textContent = base;
  const cont = D.mapas.map((m, i) => [m, i, D.casos.filter((c) => c[2] === i).length]).filter((x) => x[2] >= 200).sort((a, b) => b[2] - a[2]);
  $("#f-mapa").insertAdjacentHTML("beforeend", cont.map(([m, i]) => `<option value="${i}">${esc(m)}</option>`).join(""));
  $("#v-placar").innerHTML = [0, 1, 2, 3, 4, 5].map((a) => `<option value="${a}"${a === 4 ? " selected" : ""}>${a}–${12 - a}</option>`).join("");
  $("#v-linha").innerHTML = `<option value="vence">vencer o mapa</option>` + LINHAS.map((l) => `<option value="${l}"${l === 7.5 ? " selected" : ""}>${linhaTxt(l)} rounds</option>`).join("");
  $("#lista-times").innerHTML = Object.keys(T.times).sort().map((t) => `<option value="${esc(t)}">`).join("");
  for (const id of ["#f-mapa", "#f-lado", "#f-forca"]) $(id).addEventListener("change", tabela);
  for (const id of ["#v-placar", "#v-linha"]) $(id).addEventListener("change", valor);
  $("#v-odd").addEventListener("input", valor);
  for (const id of ["#t-a", "#t-b"]) $(id).addEventListener("change", times);
  tabela();
}

iniciar().catch((e) => { $("#tab").innerHTML = `<tr><td class="muted">Não foi possível carregar os dados: ${esc(e.message || e)}</td></tr>`; });
