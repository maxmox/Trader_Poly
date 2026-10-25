// ==UserScript==
// @name         Trader Poly — coletor CampeonBet
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.3
// @downloadURL  https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @updateURL    https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @description  Na CampeonBet: "Capturar este jogo" lê as odds que JÁ ESTÃO NA TELA (nenhuma consulta extra ao site) e "Abrir a comparação" manda para a aba "CampeonBet × DK" do Trader Poly.
// @match        https://campeonbet.io/*
// @match        https://*.campeonbet.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Coletor da CampeonBet. v1.3 (25/10/2026): LÊ A TELA, não chama a API. As versões 1.0–1.2 chamavam a API da Altenar
// (sb2integration-altenar2.biahosted.com/api/Widget), mas a página não usa uma consulta de lista de jogos visível e
// carrega um endereço-isca ("Y21Gd…" = "random bullshit go" em base64 duas vezes): proteção contra robôs. Insistir na
// API arriscaria a conta do usuário. Agora:
//   - "Capturar este jogo": com um jogo da NBA aberto na tela, lê os mercados e odds que a página JÁ mostrou (texto
//     dos botões de odd e o título do bloco de cada mercado). Nenhuma requisição ao site. Guarda neste navegador.
//   - "Abrir a comparação": abre props.html?aba=campeon#campeon=<gzip+base64> com todos os jogos capturados.
//   - "Baixar o HTML": salva a página aberta, para ajustar o leitor se ele não reconhecer os mercados.
(() => {
  const SITE = "https://maxmox.github.io/Trader_Poly", CHAVE = "traderpoly_capturas";
  if (window.__traderPolyCampeon) return;
  window.__traderPolyCampeon = true;

  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch { return {}; } };
  const grava = (o) => { try { localStorage.setItem(CHAVE, JSON.stringify(o)); return true; } catch { return false; } };
  const PRECO = /^\d{1,3}[.,]\d{1,3}$/;
  const linhasDe = (el) => (el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);

  // ---------- leitura da tela ----------
  // botão de odd = elemento cujo texto é "<rótulo>\n<preço>" (ou só o preço), sem outro botão de odd dentro;
  // mercado = o menor ancestral com 2+ botões de odd; nome do mercado = 1ª linha de texto dele que não é de odd
  function capturar() {
    const raiz = document.querySelector("main") || document.body;
    const cands = [];
    for (const el of raiz.querySelectorAll("button, [role=button], [class*=odd], [class*=Odd], [class*=outcome], [class*=Outcome], [class*=selection], [class*=Selection], [class*=bet-btn], [class*=betBtn]")) {
      if (el.closest("#trader-poly-caixa")) continue;
      const L = linhasDe(el);
      if (!L.length || L.length > 3) continue;
      const preco = L[L.length - 1];
      if (!PRECO.test(preco)) continue;
      const v = parseFloat(preco.replace(",", "."));
      if (!(v > 1 && v < 100)) continue;
      cands.push({ el, rot: L.slice(0, -1).join(" "), preco: v });
    }
    // fica só o botão mais interno (um invólucro com o mesmo texto não conta duas vezes)
    const odds = cands.filter((c) => !cands.some((o) => o !== c && c.el.contains(o.el)));
    const porMercado = new Map();
    for (const o of odds) {
      let a = o.el.parentElement;
      while (a && a !== raiz && odds.filter((x) => a.contains(x.el)).length < 2) a = a.parentElement;
      if (!a || a === raiz) continue;
      (porMercado.get(a) || porMercado.set(a, []).get(a)).push(o);
    }
    const mercados = [];
    for (const [bloco, os] of porMercado) {
      const textosOdds = new Set(os.flatMap((o) => linhasDe(o.el)));
      const nome = linhasDe(bloco).find((t) => !textosOdds.has(t) && !PRECO.test(t)) || "";
      // props em tabela ("Pontos do jogador" › linha "LeBron James"): junta o título da seção acima
      let secao = "", up = bloco.parentElement;
      for (let k = 0; k < 4 && up && up !== raiz && !secao; k++, up = up.parentElement) {
        const t = linhasDe(up).find((x) => !textosOdds.has(x) && !PRECO.test(x));
        if (t && t !== nome) secao = t;
      }
      mercados.push([secao ? `${secao} | ${nome}` : nome, null, os.map((o) => [o.rot, o.preco, null])]);
    }
    // nome do jogo: título com "-", "vs" ou "@" (cabeçalho da página) ou o título da aba
    const titulo = [...document.querySelectorAll("h1, h2, [class*=event-name], [class*=eventName], [class*=EventName], [class*=teams], [class*=Teams]")]
      .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).find((t) => / - | vs\.? | v | @ /i.test(t) && t.length < 90) || document.title;
    return { nome: titulo, mercados };
  }

  // ---------- caixa e botões ----------
  const caixa = document.createElement("div");
  caixa.id = "trader-poly-caixa";
  caixa.style.cssText = "position:fixed;z-index:2147483646;left:16px;bottom:16px;max-width:380px;padding:10px 12px;border-radius:8px;background:#10243e;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)";
  const texto = document.createElement("div");
  texto.style.whiteSpace = "pre-line";
  caixa.appendChild(texto);
  const botao = (rot, fn) => { const b = document.createElement("button"); b.textContent = rot; b.style.cssText = "margin:8px 6px 0 0;padding:6px 10px;border:0;border-radius:6px;background:#3d8bfd;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer"; b.addEventListener("click", fn); caixa.appendChild(b); return b; };
  const resumo = () => {
    const jogos = Object.values(ler()), velhos = jogos.filter((j) => Date.now() - j.em > 30 * 60e3).length;
    return `📊 Trader Poly · ${jogos.length} jogo(s) capturado(s)${velhos ? ` (${velhos} com mais de 30 min)` : ""}`;
  };
  const status = (t) => { texto.textContent = t ? `${resumo()}\n${t}` : resumo(); };
  botao("Capturar este jogo", () => {
    const j = capturar(), n = j.mercados.length, nOdds = j.mercados.reduce((t, m) => t + m[2].length, 0);
    if (!n) { status("Não reconheci mercados nesta tela. Abra um jogo da NBA (a página com as props) e tente de novo; se continuar, use \"Baixar o HTML\" e mande o arquivo."); return; }
    const c = ler();
    c[j.nome] = { em: Date.now(), nome: j.nome, mercados: j.mercados };
    status(grava(c) ? `Capturado: ${j.nome} · ${n} mercados, ${nOdds} odds.` : "Não consegui guardar neste navegador.");
  });
  botao("Abrir a comparação", async () => {
    const eventos = Object.values(ler()).map((j) => ({ id: j.nome, nome: j.nome, inicio: null, mercados: j.mercados, em: j.em }));
    if (!eventos.length) { status("Nenhum jogo capturado ainda: abra um jogo e clique em \"Capturar este jogo\"."); return; }
    const w = window.open("about:blank", "_blank"); // a janela abre JÁ no clique (depois o navegador bloquearia)
    const txt = JSON.stringify({ v: 2, em: Math.min(...eventos.map((e) => e.em)), fonte: "tela", eventos, erros: 0 });
    const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const url = `${SITE}/props.html?aba=campeon#campeon=${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
    if (w) w.location.href = url; else location.href = url;
  });
  botao("Limpar", () => { grava({}); status("Capturas apagadas."); });
  botao("Baixar o HTML", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.documentElement.outerHTML], { type: "text/html" }));
    a.download = `campeon-tela-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.html`;
    a.click();
  });
  status("Abra um jogo da NBA e clique em \"Capturar este jogo\". Repita nos jogos que quiser; no fim, \"Abrir a comparação\".");
  document.body.appendChild(caixa);
})();
