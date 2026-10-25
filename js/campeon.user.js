// ==UserScript==
// @name         Trader Poly — coletor CampeonBet
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.4
// @downloadURL  https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @updateURL    https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @description  Na CampeonBet: "Capturar esta tela" lê as tabelas de props que JÁ ESTÃO NA TELA (nenhuma consulta extra ao site) e "Abrir a comparação" manda para a aba "CampeonBet × DK" do Trader Poly.
// @match        https://campeonbet.io/*
// @match        https://*.campeonbet.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Coletor da CampeonBet. LÊ A TELA, não chama a API (a API deles tem endereço-isca contra robôs; v1.0–1.2 chamavam e
// não deu). v1.4 (25/10/2026), feita pelos prints do usuário: em "Especiais de Jogadores" cada mercado é um quadro com
// título ("Pontos Mais de/Menos de (incluindo Prorrogação)"), abas dos dois times e uma tabela
//   Jogador | Linha | Mais | Menos
// (a odd é só o número; o rótulo está no cabeçalho). Cada linha da tabela vira um par Over/Under. Tabelas só com "Mais"
// (Pts-Reb/Pts-Ast a 1,01: marcos) e odds trancadas ficam de fora. As capturas SE SOMAM: capture um time, troque de
// time/aba (Pontos, 3 Pontos, Rebotes, Assistências, Combos) e capture de novo. Lê o texto da tabela inclusive dentro de
// shadow DOM e de linhas ainda escondidas.
(() => {
  const SITE = "https://maxmox.github.io/Trader_Poly", CHAVE = "traderpoly_capturas";
  if (window.__traderPolyCampeon) return;
  window.__traderPolyCampeon = true;

  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch { return {}; } };
  const grava = (o) => { try { localStorage.setItem(CHAVE, JSON.stringify(o)); return true; } catch { return false; } };
  const PRECO = /^\d{1,3}[.,]\d{1,3}$/, LINHA = /^\d{1,3}(?:[.,]\d)?$/, NOME = /^[^\d]{3,}$/;
  // todos os elementos, entrando nos shadow roots
  const todos = (raiz) => { const out = []; const anda = (r) => { for (const el of r.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) anda(el.shadowRoot); } }; anda(raiz); return out; };
  // textos das folhas (nós de texto não vazios), em ordem, entrando nos shadow roots
  const folhas = (el) => { const out = []; const anda = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.nodeValue.trim(); if (t) out.push(t); } else if (c.nodeType === 1) { anda(c); if (c.shadowRoot) anda(c.shadowRoot); } } }; anda(el); return out; };
  const ehLinhaDeTabela = (F) => F.length === 4 && NOME.test(F[0]) && LINHA.test(F[1]) && PRECO.test(F[2]) && PRECO.test(F[3]);
  const num = (t) => parseFloat(t.replace(",", "."));

  function capturar() {
    const els = todos(document.body).filter((el) => !el.closest?.("#trader-poly-caixa"));
    const cache = new Map(), F = (el) => cache.get(el) || cache.set(el, folhas(el)).get(el);
    // linhas da tabela: o menor elemento cujo texto é exatamente jogador, linha, Mais, Menos
    const linhas = els.filter((el) => ehLinhaDeTabela(F(el)));
    const minimas = linhas.filter((el) => !linhas.some((o) => o !== el && el.contains(o)));
    const pares = [];
    for (const el of minimas) {
      const [jogador, linha, mais, menos] = F(el);
      // título do quadro: subindo, o 1º texto que é de mercado ("Mais de/Menos de", "incluindo Prorrogação"…)
      let titulo = "", up = el.parentElement || el.getRootNode()?.host;
      for (let k = 0; k < 14 && up && !titulo; k++) {
        titulo = F(up).find((t) => /mais de\s*\/\s*menos de|incluindo prorroga|over\s*\/\s*under/i.test(t)) || "";
        up = up.parentElement || up.getRootNode()?.host;
      }
      if (!titulo) continue;
      pares.push([titulo, jogador, num(linha), num(mais), num(menos)]);
    }
    // jogo: aba do jogo no topo ("Utah Jazz x LA Lakers") ou o título da página
    let jogo = "";
    for (const el of els) { const f = F(el); if (f.length === 3 && f[1].toLowerCase() === "x" && NOME.test(f[0]) && NOME.test(f[2])) { jogo = `${f[0]} - ${f[2]}`; break; } }
    return { nome: jogo || document.title, pares };
  }

  // ---------- caixa e botões ----------
  const caixa = document.createElement("div");
  caixa.id = "trader-poly-caixa";
  caixa.style.cssText = "position:fixed;z-index:2147483646;left:16px;bottom:16px;max-width:400px;padding:10px 12px;border-radius:8px;background:#10243e;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)";
  const texto = document.createElement("div");
  texto.style.whiteSpace = "pre-line";
  caixa.appendChild(texto);
  const botao = (rot, fn) => { const b = document.createElement("button"); b.textContent = rot; b.style.cssText = "margin:8px 6px 0 0;padding:6px 10px;border:0;border-radius:6px;background:#3d8bfd;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer"; b.addEventListener("click", fn); caixa.appendChild(b); return b; };
  const resumo = () => {
    const jogos = Object.values(ler()), n = jogos.reduce((t, j) => t + Object.keys(j.pares || {}).length, 0);
    const velhos = jogos.filter((j) => Date.now() - j.em > 30 * 60e3).length;
    return `📊 Trader Poly · ${jogos.length} jogo(s), ${n} linhas capturadas${velhos ? ` (${velhos} jogo(s) com mais de 30 min)` : ""}`;
  };
  const status = (t) => { texto.textContent = t ? `${resumo()}\n${t}` : resumo(); };
  botao("Capturar esta tela", () => {
    const j = capturar();
    if (!j.pares.length) { status("Não achei tabelas de props nesta tela. Abra o jogo › \"Especiais de Jogadores\" › Pontos (ou outra aba) e tente de novo. Se continuar, use \"Diagnóstico\" e mande o arquivo."); return; }
    const c = ler(), g = (c[j.nome] ||= { nome: j.nome, em: Date.now(), pares: {} });
    let novas = 0;
    for (const [titulo, jogador, L, O, U] of j.pares) { const k = `${titulo}|${jogador}|${L}`; if (!g.pares[k]) novas++; g.pares[k] = [titulo, jogador, L, O, U]; }
    g.em = Date.now();
    const mercados = [...new Set(j.pares.map((p) => p[0].replace(/\s*\(incluindo.*$/i, "")))].join(", ");
    status(grava(c) ? `Capturado em ${j.nome}: ${j.pares.length} linhas (${novas} novas) — ${mercados}.\nTroque de time ou de aba e capture de novo; no fim, "Abrir a comparação".` : "Não consegui guardar neste navegador.");
  });
  botao("Abrir a comparação", async () => {
    // formato compacto que a aba lê: mercado = "título | jogador", odds = Mais de L / Menos de L
    const eventos = Object.values(ler()).map((j) => ({ id: j.nome, nome: j.nome, inicio: null, em: j.em,
      mercados: Object.values(j.pares).map(([titulo, jogador, L, O, U]) => [`${titulo} | ${jogador}`, L, [[`Mais de ${L}`, O, L], [`Menos de ${L}`, U, L]]]) }));
    if (!eventos.length) { status("Nada capturado ainda: abra um jogo › Especiais de Jogadores e clique em \"Capturar esta tela\"."); return; }
    const w = window.open("about:blank", "_blank"); // a janela abre JÁ no clique (depois o navegador bloquearia)
    const txt = JSON.stringify({ v: 2, em: Math.min(...eventos.map((e) => e.em)), fonte: "tela", eventos, erros: 0 });
    const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const url = `${SITE}/props.html?aba=campeon#campeon=${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
    if (w) w.location.href = url; else location.href = url;
  });
  botao("Limpar", () => { grava({}); status("Capturas apagadas."); });
  botao("Diagnóstico", () => {
    // os textos de cada elemento com até 8 folhas (o suficiente para ajustar o leitor), sem dados pessoais da conta
    const amostra = todos(document.body).map(folhas).filter((f) => f.length >= 2 && f.length <= 8 && f.some((t) => PRECO.test(t))).slice(0, 600);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ url: location.href, titulo: document.title, amostra }, null, 1)], { type: "application/json" }));
    a.download = `campeon-diagnostico-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  });
  status("Abra um jogo › \"Especiais de Jogadores\" e clique em \"Capturar esta tela\". Troque de time e de aba (Pontos, 3 Pontos, Rebotes, Assistências, Combos) capturando cada uma; no fim, \"Abrir a comparação\".");
  document.body.appendChild(caixa);
})();
