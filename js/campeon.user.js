// ==UserScript==
// @name         Trader Poly — coletor de casas (CampeonBet, JogaBrasil, 99play)
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.12
// @downloadURL  https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @updateURL    https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @description  Na CampeonBet, JogaBrasil e 99play: "Capturar esta tela" lê as props que JÁ ESTÃO NA TELA (nenhuma consulta extra ao site) e "Abrir a comparação" manda para a aba "Casas × DK" do Trader Poly. Fora dessas duas casas (e dos quadros embutidos nelas) não faz nada.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==
// Coletor das casas. LÊ A TELA, não chama a API (a API da CampeonBet tem endereço-isca contra robôs; v1.0–1.2 chamavam e
// não deu). As capturas SE SOMAM (localStorage do próprio site): capture, troque de time/aba/role a lista e capture de novo.
// - CampeonBet (v1.4, pelos prints do usuário): jogo › "Especiais de Jogadores" › abas Pontos/3 Pontos/Rebotes/…; cada
//   mercado é um quadro com título ("Pontos Mais de/Menos de (incluindo Prorrogação)"), abas dos dois times e a tabela
//     Jogador | Linha | Mais | Menos
//   (odd só o número). Tabelas só com "Mais" (Pts-Reb/Pts-Ast a 1,01: marcos) e odds trancadas ficam de fora. v1.5: título
//   do quadro mais próximo mesmo sem "Mais de/Menos de" ("Tentativas de Arremessos de 3" saía como "3pt conseguidos").
// - JogaBrasil (v1.6, 25/10/2026): jogo › "Mercado de Jogadores" = lista enorme de blocos, um por jogador × estatística
//   ("Ace Bailey Total de pontos. Com prorrogação", "George Keyonte. Cestas de três pontos…"), cada um com a ESCADA de
//   linhas: botões "Mais 6.5 | 1.26" e "Menos 6.5 | 3.11". Lê cada botão e junta Mais/Menos da mesma linha do mesmo bloco;
//   o título é o último título de bloco antes do botão na ordem da página.
//   v1.7: as apostas da JogaBrasil ficam no SDK da TurboSports, num quadro (iframe) de outro domínio, decidido na hora pela
//   API deles — a v1.6 só rodava na página de fora e não via nada. Agora o script roda também dentro de quadros, mas SÓ
//   quando o quadro está embutido numa das casas (location.ancestorOrigins); a caixa azul fica na página de fora e pede a
//   leitura aos quadros por postMessage. v1.11: de volta ao document-idle, sem mexer em nada da página.
(() => {
  const SITE = "https://maxmox.github.io/Trader_Poly", CHAVE = "traderpoly_capturas", VERSAO = "1.12";
  // 99play (v1.9, 25/10/2026): mesma plataforma da CampeonBet (Altenar) — mesmos quadros e tabela; odd com vírgula
  const casaDe = (s) => (/(^|\.|\/\/)campeonbet\.[a-z]+/i.test(s) ? "campeon" : /(^|\.|\/\/)jogabrasil\.[a-z]+/i.test(s) ? "jogabrasil" : /(^|\.|\/\/)99play\.[a-z]+/i.test(s) ? "play99" : null);
  // página de fora = sem ancestrais (com @grant o window do script pode ser um invólucro e window.top !== window)
  const TOPO = location.ancestorOrigins ? location.ancestorOrigins.length === 0 : window.self === window.top;
  const ancestrais = [...(location.ancestorOrigins || [])].join(" ") || document.referrer;
  const CASA = TOPO ? casaDe(location.hostname) : casaDe(location.hostname) || casaDe(ancestrais);
  if (!CASA || window.__traderPolyCampeon) return;
  window.__traderPolyCampeon = true;

  // só shadow DOM aberto. (v1.7–1.10 embrulhavam o attachShadow para ler o fechado, rodando em document-start; a CampeonBet
  // passou a apagar a caixa — v1.11 voltou ao document-idle sem mexer em nada da página. O quadro da JogaBrasil não usa sombra.)
  const raiz = (el) => el.shadowRoot;

  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch { return {}; } };
  const grava = (o) => { try { localStorage.setItem(CHAVE, JSON.stringify(o)); return true; } catch { return false; } };
  const PRECO = /^\d{1,3}[.,]\d{1,3}$/, LINHA = /^\d{1,3}(?:[.,]\d)?$/, NOME = /^[^\d]{3,}$/;
  // todos os elementos, entrando nos shadow roots
  const todos = (r0) => { const out = []; const anda = (r) => { for (const el of r.querySelectorAll("*")) { out.push(el); const s = raiz(el); if (s) anda(s); } }; anda(r0); return out; };
  // textos das folhas (nós de texto não vazios), em ordem, entrando nos shadow roots
  const folhas = (el) => { const out = []; const anda = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.nodeValue.trim(); if (t) out.push(t); } else if (c.nodeType === 1) { anda(c); const s = raiz(c); if (s) anda(s); } } }; anda(el); return out; };
  const ehLinhaDeTabela = (F) => F.length === 4 && NOME.test(F[0]) && LINHA.test(F[1]) && PRECO.test(F[2]) && PRECO.test(F[3]);
  const num = (t) => parseFloat(t.replace(",", "."));
  // título de quadro de mercado (os rótulos das abas, "Pontos", "Assistências"…, são curtos e ficam de fora)
  const ehTitulo = (t) => /mais de\s*\/\s*menos de|incluindo prorroga|over\s*\/\s*under/i.test(t) || (t.length >= 14 && /conseguid|tentad|tentativ|arremess|pontos|rebotes|assist|bloqueio|roubo|3pt|triplo/i.test(t) && !/^mostrar/i.test(t));
  // JogaBrasil: título de bloco ("Ace Bailey Total de pontos. Com prorrogação") e botão "Mais 6.5 1.26"
  const ehTituloJB = (t) => t.length >= 12 && !/^(mais|menos)\b/i.test(t) && /prorroga|total de|cestas|pontos|ressaltos|rebotes|assist|roubos|bloqueios|desarmes/i.test(t);
  const BOTAO_JB = /^(mais|menos)\s+(\d{1,3}(?:[.,]\d)?)\s+(\d{1,3}[.,]\d{1,3})$/i;
  const fora = (el) => el.closest?.("#trader-poly-caixa");

  // jogo: "Utah Jazz x LA Lakers" (CampeonBet) ou "Utah Jazz VS Los Angeles Lakers" (JogaBrasil); "" se não achar
  // v1.8: no quadro da TurboSports o nome dos times não vem como texto; o endereço tem ".../new-york-knicks-vs-orlando-magic-41347459/bets"
  function nomeDoJogo(els, F) {
    for (const el of els) { const f = F(el); if (f.length === 3 && /^(x|vs\.?)$/i.test(f[1]) && NOME.test(f[0]) && NOME.test(f[2])) return `${f[0]} - ${f[2]}`; }
    const u = decodeURIComponent(location.pathname).match(/\/([a-z0-9-]+?)-vs-([a-z0-9-]+?)-\d+(?:\/|$)/i);
    if (u) return `${u[1].replaceAll("-", " ")} - ${u[2].replaceAll("-", " ")}`.replace(/\b\w/g, (c) => c.toUpperCase());
    return "";
  }

  function capturarCampeon(els, F) {
    // linhas da tabela: o menor elemento cujo texto é exatamente jogador, linha, Mais, Menos
    const linhas = els.filter((el) => ehLinhaDeTabela(F(el)));
    const minimas = linhas.filter((el) => !linhas.some((o) => o !== el && el.contains(o)));
    const pares = [];
    for (const el of minimas) {
      const [jogador, linha, mais, menos] = F(el);
      // título do quadro: subindo, o 1º texto que é de mercado
      let titulo = "", up = el.parentElement || el.getRootNode()?.host;
      for (let k = 0; k < 14 && up && !titulo; k++) {
        titulo = F(up).find(ehTitulo) || "";
        up = up.parentElement || up.getRootNode()?.host;
      }
      if (!titulo) continue;
      pares.push([titulo, jogador, num(linha), num(mais), num(menos)]);
    }
    return pares;
  }

  function capturarJogaBrasil(els, F) {
    const txt = (el) => F(el).join(" ");
    const botoes = new Set(els.filter((el) => BOTAO_JB.test(txt(el))));
    for (const b of [...botoes]) for (let up = b.parentElement || b.getRootNode()?.host; up; up = up.parentElement || up.getRootNode()?.host) botoes.delete(up); // só o menor
    // uma passada na ordem da página: o título de bloco vale até o próximo
    const porBloco = new Map();
    let titulo = "";
    for (const el of els) {
      for (const c of el.childNodes) if (c.nodeType === 3 && ehTituloJB(c.nodeValue.trim())) titulo = c.nodeValue.trim();
      if (!botoes.has(el) || !titulo) continue;
      const [, lado, L, preco] = txt(el).match(BOTAO_JB);
      const k = `${titulo}|${num(L)}`;
      const p = porBloco.get(k) || porBloco.set(k, [titulo, "", num(L), null, null]).get(k);
      p[/^mais/i.test(lado) ? 3 : 4] = num(preco);
    }
    return [...porBloco.values()].filter((p) => p[3] > 1 && p[4] > 1);
  }

  // leitura DESTE documento (página de fora ou quadro)
  function capturarAqui() {
    const els = todos(document.documentElement).filter((el) => !fora(el));
    const cache = new Map(), F = (el) => cache.get(el) || cache.set(el, folhas(el)).get(el);
    return { nome: nomeDoJogo(els, F), pares: CASA === "jogabrasil" ? capturarJogaBrasil(els, F) : capturarCampeon(els, F) };
  }
  function diagnosticoAqui() {
    // textos dos elementos com preço (o suficiente para ajustar o leitor); nada da conta (saldo, nome) e nada da caixa
    const els = todos(document.documentElement).filter((el) => !fora(el));
    const amostra = els.map(folhas).filter((f) => f.length >= 2 && f.length <= 8 && f.some((t) => PRECO.test(t)) && !f.some((t) => /R\$|B\$|saldo/i.test(t))).slice(0, 400);
    const titulos = [...new Set(els.flatMap((el) => [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue.trim())).filter(CASA === "jogabrasil" ? ehTituloJB : ehTitulo))].slice(0, 200);
    const quadros = [...document.querySelectorAll("iframe")].map((f) => { try { return new URL(f.src || "about:blank").origin; } catch { return "?"; } });
    return { url: location.origin + location.pathname, elementos: els.length, sombras: els.filter((el) => raiz(el)).length, quadros, titulos, capturado: capturarAqui().pares, amostra };
  }

  // ---------- dentro de um quadro: responde à página de fora ----------
  if (!TOPO) {
    addEventListener("message", (e) => {
      if (casaDe(e.origin) !== CASA || !e.data || typeof e.data !== "object" || !/^tp-(capturar|diagnostico)$/.test(e.data.tp)) return;
      let resp;
      try { resp = e.data.tp === "tp-capturar" ? capturarAqui() : diagnosticoAqui(); } catch (err) { resp = { erro: String(err?.message || err), pares: [] }; }
      (e.source || parent).postMessage({ tp: "tp-resposta", id: e.data.id, resp }, e.origin);
    });
    return;
  }

  // ---------- página de fora: pergunta a todos os quadros (qualquer profundidade) e junta ----------
  function quadrosDe(w, out = []) { try { for (let i = 0; i < w.frames.length; i++) { out.push(w.frames[i]); quadrosDe(w.frames[i], out); } } catch { /* quadro inacessível */ } return out; }
  function perguntar(tp) {
    const id = Math.random().toString(36).slice(2), alvos = quadrosDe(window), resps = [];
    return new Promise((ok) => {
      if (!alvos.length) { ok(resps); return; }
      const fim = setTimeout(() => { removeEventListener("message", ouvir); ok(resps); }, 1500);
      function ouvir(e) {
        if (e.data?.tp !== "tp-resposta" || e.data.id !== id) return;
        resps.push(e.data.resp);
        if (resps.length === alvos.length) { clearTimeout(fim); removeEventListener("message", ouvir); ok(resps); }
      }
      addEventListener("message", ouvir);
      for (const w of alvos) try { w.postMessage({ tp, id }, "*"); } catch { /* ignora */ }
    });
  }
  async function capturar() {
    const aqui = capturarAqui(), deles = await perguntar("tp-capturar");
    const pares = [...aqui.pares, ...deles.flatMap((r) => r?.pares || [])];
    // sem nome (a 99play põe o horário entre os times): o nº do evento no endereço separa os jogos; a aba acha o jogo pelos jogadores
    const nome = aqui.nome || deles.map((r) => r?.nome).find(Boolean) || `${document.title} · evento ${(location.href.match(/event(?:Id=|\/)(\d+)/) || [, "?"])[1]}`;
    return { nome, pares, quadros: deles.length };
  }

  // ---------- ações (caixa e menu do Tampermonkey) ----------
  const resumo = () => {
    const jogos = Object.values(ler()), n = jogos.reduce((t, j) => t + Object.keys(j.pares || {}).length, 0);
    const velhos = jogos.filter((j) => Date.now() - j.em > 30 * 60e3).length;
    return `📊 Trader Poly · ${jogos.length} jogo(s), ${n} linhas capturadas${velhos ? ` (${velhos} jogo(s) com mais de 30 min)` : ""}`;
  };
  const COMO = CASA === "jogabrasil"
    ? "Abra o jogo › \"Mercado de Jogadores\" e clique em \"Capturar esta tela\". Se a lista carrega aos poucos, role até o fim e capture de novo (as capturas se somam); no fim, \"Abrir a comparação\"."
    : "Abra um jogo › \"Especiais de Jogadores\" e clique em \"Capturar esta tela\". Troque de time e de aba (Pontos, 3 Pontos, Rebotes, Assistências, Combos) capturando cada uma; no fim, \"Abrir a comparação\".";
  let mostrar = () => {}; // troca o texto da caixa (montada abaixo)
  // pelo menu do Tampermonkey o resultado também vem num aviso, para o caso de o site esconder a caixa
  const avisa = (t, peloMenu) => { mostrar(t); if (peloMenu) alert(`${resumo()}\n${t}`); };
  async function acaoCapturar(peloMenu) {
    mostrar("Lendo a tela…");
    const j = await capturar();
    if (!j.pares.length) { avisa(`Não achei props nesta tela (${j.quadros} quadro(s) embutido(s) responderam). ${COMO} Se continuar, use "Diagnóstico" e mande o arquivo.`, peloMenu); return; }
    const c = ler(), g = (c[j.nome] ||= { nome: j.nome, em: Date.now(), pares: {} });
    let novas = 0;
    for (const [titulo, jogador, L, O, U] of j.pares) { const k = `${titulo}|${jogador}|${L}`; if (!g.pares[k]) novas++; g.pares[k] = [titulo, jogador, L, O, U]; }
    g.em = Date.now();
    const mercados = new Set(j.pares.map((p) => p[0].replace(/\s*\(incluindo.*$/i, "")));
    avisa(grava(c) ? `Capturado em ${j.nome}: ${j.pares.length} linhas (${novas} novas) em ${mercados.size} mercados${mercados.size <= 6 ? ` — ${[...mercados].join(", ")}` : ""}.\nContinue capturando; no fim, "Abrir a comparação".` : "Não consegui guardar neste navegador.", peloMenu);
  }
  async function acaoAbrir(peloMenu) {
    // formato compacto que a aba lê: mercado = "título | jogador" (na JogaBrasil o jogador já está no título), odds = Mais de L / Menos de L
    const eventos = Object.values(ler()).map((j) => ({ id: j.nome, nome: j.nome, inicio: null, em: j.em,
      mercados: Object.values(j.pares).map(([titulo, jogador, L, O, U]) => [jogador ? `${titulo} | ${jogador}` : titulo, L, [[`Mais de ${L}`, O, L], [`Menos de ${L}`, U, L]]]) }));
    if (!eventos.length) { avisa(`Nada capturado ainda. ${COMO}`, peloMenu); return; }
    const aba = typeof GM_openInTab === "function" ? null : window.open("about:blank", "_blank"); // sem GM: a janela abre JÁ no clique
    const txt = JSON.stringify({ v: 2, casa: CASA, em: Math.min(...eventos.map((e) => e.em)), fonte: "tela", eventos, erros: 0 });
    const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const url = `${SITE}/props.html?aba=campeon#campeon=${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
    if (typeof GM_openInTab === "function") GM_openInTab(url, { active: true });
    else if (aba) aba.location.href = url; else location.href = url;
  }
  function acaoLimpar(peloMenu) { grava({}); avisa("Capturas apagadas.", peloMenu); }
  async function acaoDiagnostico() {
    const dados = { casa: CASA, versao: VERSAO, pagina: diagnosticoAqui(), caixa: estadoCaixa(), quadros: await perguntar("tp-diagnostico") };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" }));
    a.download = `${CASA}-diagnostico-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  }

  // ---------- caixa ----------
  // v1.12: na CampeonBet a caixa sumia logo ao abrir (v1.7–1.11). Agora é um elemento próprio (não <div>), preso na raiz
  // do documento, com o estilo forçado (!important na própria tag) e o conteúdo num shadow DOM fechado (o CSS do site não
  // alcança); volta na hora se for retirado. E tudo também pelo menu do Tampermonkey.
  let host = null;
  function estadoCaixa() {
    if (!host) return "não montada";
    const r = host.getBoundingClientRect(), cs = getComputedStyle(host);
    return { conectada: host.isConnected, pai: host.parentNode?.nodeName || null, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, largura: Math.round(r.width), altura: Math.round(r.height) };
  }
  function montarCaixa() {
    host = document.createElement("trader-poly-caixa");
    host.id = "trader-poly-caixa";
    host.setAttribute("style", "all:initial !important;display:block !important;position:fixed !important;z-index:2147483647 !important;left:16px !important;bottom:16px !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;transform:none !important;clip-path:none !important");
    const sombra = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
    const caixa = document.createElement("div");
    caixa.style.cssText = "max-width:400px;padding:10px 12px;border-radius:8px;background:#10243e;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    const texto = document.createElement("div");
    texto.style.whiteSpace = "pre-line";
    caixa.appendChild(texto);
    sombra.appendChild(caixa);
    const botao = (rot, fn) => { const b = document.createElement("button"); b.textContent = rot; b.style.cssText = "margin:8px 6px 0 0;padding:6px 10px;border:0;border-radius:6px;background:#3d8bfd;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer"; b.addEventListener("click", () => fn(false)); caixa.appendChild(b); return b; };
    mostrar = (t) => { texto.textContent = t ? `${resumo()}\n${t}` : resumo(); };
    botao("Capturar esta tela", acaoCapturar);
    botao("Abrir a comparação", acaoAbrir);
    botao("Limpar", acaoLimpar);
    botao("Diagnóstico", acaoDiagnostico);
    mostrar(COMO);
    const prende = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
    prende();
    new MutationObserver(prende).observe(document.documentElement, { childList: true });
    setInterval(prende, 1000);
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", montarCaixa, { once: true }); else montarCaixa();
  // menu do Tampermonkey (ícone da extensão): funciona mesmo se o site esconder a caixa
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("📊 Capturar esta tela", () => acaoCapturar(true));
    GM_registerMenuCommand("Abrir a comparação", () => acaoAbrir(true));
    GM_registerMenuCommand("Limpar capturas", () => acaoLimpar(true));
    GM_registerMenuCommand("Diagnóstico", () => acaoDiagnostico());
  }
})();
