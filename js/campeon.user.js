// ==UserScript==
// @name         Trader Poly — coletor de casas (CampeonBet, JogaBrasil, 99play, VelvetSpin, Betcoin, DonBet)
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.22
// @downloadURL  https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @updateURL    https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @description  Na CampeonBet, JogaBrasil, 99play, VelvetSpin, Betcoin e DonBet: "Capturar esta tela" lê as props que JÁ ESTÃO NA TELA (nenhuma consulta extra ao site) e "Abrir a comparação" manda para a aba "Casa × Painel" do Trader Poly (1.18; "Casas × DK" num botão à parte). Fora dessas duas casas (e dos quadros embutidos nelas) não faz nada.
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
  const SITE = "https://maxmox.github.io/Trader_Poly", CHAVE = "traderpoly_capturas", VERSAO = "1.22";
  // 99play (v1.9, 25/10/2026): mesma plataforma da CampeonBet (Altenar) — mesmos quadros e tabela; odd com vírgula
  const casaDe = (s) => (/(^|\.|\/\/)campeonbet\.[a-z]+/i.test(s) ? "campeon" : /(^|\.|\/\/)jogabrasil\.[a-z]+/i.test(s) ? "jogabrasil" : /(^|\.|\/\/)99play\.[a-z]+/i.test(s) ? "play99" : /(^|\.|\/\/)velvetspin\.[a-z]+/i.test(s) ? "velvet" : /(^|\.|\/\/)betcoin\.[a-z]+/i.test(s) ? "betcoin" : /(^|\.|\/\/)donbet\.[a-z]+/i.test(s) ? "donbet" : null);
  // DonBet (v1.22, 12/11/2026, pelo print e texto do usuário; donbet.win/en/sportsbook/prematch/match/<id>, em inglês):
  // abas All/Player/Points/Assists/Rebounds/…; quadro "Total assists (incl. overtime)" › time › linhas
  //   "Shannon, Terrence" | "Over (1.5)" 1.69 | "Under (1.5)" 2.04  (nome invertido com vírgula)
  // e quadros de marcos "Player points X+ (incl. overtime)" (jogador | "10+" odd …, só o Mais)
  // VelvetSpin (v1.16, 30/10/2026, pelos prints): quadros "individual total" (= pontos), "Três pontos. individual total",
  // "Rebotes. …", "Assistências. …", "Tocos. …", "Bolas recuperadas. …" com a tabela Jogador | Linha | Mais | Menos
  // → mesmo leitor de tabela da CampeonBet; o título "individual total" entra como título de quadro
  // Betcoin (v1.19, 12/11/2026, pelos prints do usuário): esporte da Betby (endereço "?bt-path=/basketball/usa/nba/<a>-<b>-<id>");
  // jogo › "Adereços de jogador" › abas Principal/Pontos/Assistências/Rebotes/3 pontos/Extras. Dois formatos de quadro:
  //   "Total de pontos (incl. prorrogação)": time | Mais De | Menos De, linha = jogador, botão "24.5 1.81", botão "24.5 1.89"
  //   "Assistências do jogador (incl. prorrogação)": time | Linha | Odds, linha = jogador, "8+" (seletor), odd → marco = só o
  //   Mais na linha 7,5 (a casa não oferece o Menos)
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
  const folhas = (el) => { const out = []; const anda = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.nodeValue.trim(); if (t) out.push(t); } else if (c.nodeType === 1) { if (c.tagName === "OPTION" && !c.selected) continue; anda(c); const s = raiz(c); if (s) anda(s); } } }; anda(el); return out; }; // seletor nativo: só a opção escolhida (marcos "8+" da Betcoin)
  const ehLinhaDeTabela = (F) => F.length === 4 && NOME.test(F[0]) && LINHA.test(F[1]) && PRECO.test(F[2]) && PRECO.test(F[3]);
  const MARCO = /^(\d{1,2})\+$/;
  // linha de tabela → [jogador, linha, Mais, Menos] (Menos null = marco "8+", só o Mais) ou null
  //   4 textos: jogador | linha | Mais | Menos (CampeonBet/99play/VelvetSpin)
  //   5 textos: jogador | linha | Mais | linha | Menos (Betcoin: a linha se repete em cada botão)
  //   3 textos: jogador | "8+" | odd (Betcoin, marcos)
  const linhaTabela = (F) => {
    if (ehLinhaDeTabela(F)) return [F[0], num(F[1]), num(F[2]), num(F[3])];
    if (F.length === 5 && NOME.test(F[0]) && LINHA.test(F[1]) && F[3] === F[1] && PRECO.test(F[2]) && PRECO.test(F[4]) && /^\d{1,3}[.,]\d{2,3}$/.test(F[2]) && /^\d{1,3}[.,]\d{2,3}$/.test(F[4])) return [F[0], num(F[1]), num(F[2]), num(F[4])];
    if (F.length === 3 && NOME.test(F[0]) && MARCO.test(F[1]) && PRECO.test(F[2])) return [F[0], +F[1].match(MARCO)[1] - 0.5, num(F[2]), null];
    return null;
  };
  const num = (t) => parseFloat(t.replace(",", "."));
  // título de quadro de mercado (os rótulos das abas, "Pontos", "Assistências"…, são curtos e ficam de fora)
  const ehTitulo = (t) => /mais de\s*\/\s*menos de|incluindo prorroga|incl\.?\s*prorroga|incl\.?\s*overtime|over\s*\/\s*under|individual total/i.test(t) || (t.length >= 14 && /conseguid|tentad|tentativ|arremess|pontos|rebotes|assist|bloqueio|roubo|3pt|triplo/i.test(t) && !/^mostrar/i.test(t));
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
    const linhas = els.filter((el) => linhaTabela(F(el)));
    const minimas = linhas.filter((el) => !linhas.some((o) => o !== el && el.contains(o)));
    const pares = [];
    for (const el of minimas) {
      const [jogador, linha, mais, menos] = linhaTabela(F(el));
      // título do quadro: subindo, o 1º texto que é de mercado
      let titulo = "", up = el.parentElement || el.getRootNode()?.host;
      for (let k = 0; k < 14 && up && !titulo; k++) {
        titulo = F(up).find(ehTitulo) || "";
        up = up.parentElement || up.getRootNode()?.host;
      }
      if (!titulo) continue;
      // marco (só o Mais): título próprio para não sobrescrever a linha Mais/Menos do mesmo jogador
      pares.push([menos == null ? `${titulo} · marco` : titulo, jogador, linha, mais, menos]);
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

  // Betcoin v1.20 (Diagnóstico do usuário em 12/11: a linha do jogador não tem só [jogador, L, Mais, L, Menos] — 5 sombras,
  // botões "8.5 | 1.83" aninhados em 3 níveis, o nome não aparece junto). Leitor que parte dos BOTÕES: botão = menor
  // elemento com os textos exatos [linha, odd]; a linha da tabela = o 1º ancestral com 2+ botões; se forem exatamente 2 com a
  // mesma linha, o 1º é o Mais e o 2º o Menos, e o jogador é o 1º texto de nome nesse bloco (textos a mais são ignorados).
  // Marcos ("8+" | odd): menor elemento com um "N+" e uma odd; o jogador é o 1º nome subindo.
  const BOT = (f) => f.length === 2 && /^\d{1,3}[.,]\d$/.test(f[0]) && /^\d{1,3}[.,]\d{2,3}$/.test(f[1]);
  const ehNomeJog = (x) => NOME.test(x) && x.length <= 40 && !/^(mais|menos|linha|odds?|over|under)\b/i.test(x) && !/prorroga|jogador|total|\+/i.test(x);
  // títulos de quadro (sem as frases das "Dicas de Especialista" e sem as pernas das múltiplas "Tyrese Maxey pontos: 25+")
  const tituloBetby = (t) => ehTitulo(t) && !/média|temporada|dicas/i.test(t) && !/:\s*\d|\d\+|&/.test(t);
  // v1.21 (2º Diagnóstico, 12/11): a tabela é uma GRADE PLANA — as células do quadro são irmãs, sem bloco por jogador:
  //   [título, time, "Linha", "Odds", "Tyrese Maxey", "36+", "1.90", "Jaylen Brown", "36+", "1.93", …]
  //   [título, time, "Mais De", "Menos De", jogador, "35.5", "1.87", "35.5", "1.83", …]
  // → lê a página como uma sequência de textos: título vale até o próximo; jogador + L + Mais + L + Menos, ou jogador + N+ + odd
  function capturarSequencia() {
    const S = folhas(document.body || document.documentElement);
    const L1 = (x) => /^\d{1,3}[.,]\d$/.test(x || ""), P2 = (x) => /^\d{1,3}[.,]\d{2,3}$/.test(x || "");
    const pares = [];
    let tit = "";
    for (let i = 0; i < S.length; i++) {
      const x = S[i];
      if (tituloBetby(x)) { tit = x; continue; }
      if (!tit || !ehNomeJog(x) || /dupl|tripl|m[uú]ltipl/i.test(tit)) continue;
      const [a, b, c, d] = S.slice(i + 1, i + 5);
      if (L1(a) && a === c && P2(b) && P2(d)) { pares.push([tit, x, num(a), num(b), num(d)]); i += 4; continue; }
      if (MARCO.test(a || "") && P2(b)) { pares.push([`${tit} · marco`, x, +a.match(MARCO)[1] - 0.5, num(b), null]); i += 2; }
    }
    return pares;
  }
  function capturarBetby(els, F) {
    const up = (x) => x.parentElement || x.getRootNode?.()?.host || null;
    const ordem = new Map(els.map((el, i) => [el, i]));
    const tituloDe = (x) => { for (let k = 0; k < 16 && x; k++, x = up(x)) { const tt = F(x).find(tituloBetby); if (tt) return tt; } return ""; };
    const minimos = (cand) => { const s = new Set(cand); for (const c of cand) for (let x = up(c); x; x = up(x)) s.delete(x); return [...s]; };
    const pares = [];
    // tabela Mais/Menos
    const bots = minimos(els.filter((el) => BOT(F(el))));
    const porAnc = new Map();
    for (const b of bots) for (let x = up(b); x; x = up(x)) (porAnc.get(x) || porAnc.set(x, []).get(x)).push(b);
    const feitas = new Set();
    for (const b of bots) {
      let row = up(b);
      while (row && (porAnc.get(row) || []).length < 2) row = up(row);
      // os 2 botões podem estar num bloco só deles: sobe enquanto o bloco tiver os mesmos 2 botões, até aparecer o nome
      while (row && (porAnc.get(row) || []).length === 2 && !F(row).find(ehNomeJog) && up(row) && (porAnc.get(up(row)) || []).length === 2) row = up(row);
      if (!row || feitas.has(row)) continue;
      feitas.add(row);
      const bs = porAnc.get(row);
      if (bs.length !== 2) continue;
      const [b1, b2] = [...bs].sort((a, c) => (ordem.get(a) ?? 0) - (ordem.get(c) ?? 0));
      const [L1, o1] = F(b1), [L2, o2] = F(b2);
      if (L1 !== L2) continue;
      const nomeJ = F(row).find(ehNomeJog);
      const titulo = tituloDe(row);
      if (!nomeJ || !titulo) continue;
      pares.push([titulo, nomeJ, num(L1), num(o1), num(o2)]);
    }
    // marcos "8+" | odd (só o Mais)
    const marcos = minimos(els.filter((el) => { const f = F(el); return f.filter((x) => MARCO.test(x)).length === 1 && f.some((x) => /^\d{1,3}[.,]\d{2,3}$/.test(x)) && f.length <= 12; }));
    for (const m of marcos) {
      let row = m, nomeJ = "";
      for (let k = 0; k < 4 && row && !nomeJ; k++, row = up(row)) nomeJ = F(row).find(ehNomeJog) || "";
      const f = F(m), titulo = tituloDe(m);
      if (!nomeJ || !titulo) continue;
      pares.push([`${titulo} · marco`, nomeJ, +f.find((x) => MARCO.test(x)).match(MARCO)[1] - 0.5, num(f.find((x) => /^\d{1,3}[.,]\d{2,3}$/.test(x))), null]);
    }
    return pares;
  }
  // estrutura em volta dos botões (Diagnóstico): para os primeiros botões, cada ancestral com tag, classe e textos
  function estruturaBotoes(els, F) {
    const up = (x) => x.parentElement || x.getRootNode?.()?.host || null;
    const cand = els.filter((el) => BOT(F(el)) || F(el).some((x) => MARCO.test(x)));
    const s = new Set(cand); for (const c of cand) for (let x = up(c); x; x = up(x)) s.delete(x);
    return [...s].slice(0, 8).map((b) => { const out = []; for (let x = b, k = 0; x && k < 9; x = up(x), k++) out.push({ tag: x.tagName, cls: String(x.className?.baseVal ?? x.className ?? "").slice(0, 60), sombra: !x.parentElement, n: F(x).length, textos: F(x).slice(0, 14) }); return out; });
  }

  // DonBet v1.22: lê a página como sequência de textos (como a v1.21 da Betcoin). Título = texto com "(incl. overtime)";
  // jogador = nome (pode ser "Sobrenome, Nome" → vira "Nome Sobrenome"), seguido de "Over (L)" odd "Under (L)" odd
  // ("Over" e "(L)" podem vir em textos separados) ou de marcos "N+" odd (um ou vários: só o Mais, na linha N − 0,5)
  function capturarDonbet() {
    const S = folhas(document.body || document.documentElement);
    const P2 = /^\d{1,3}[.,]\d{2,3}$/;
    const tituloDon = (x) => /incl\.?\s*overtime/i.test(x) && x.length <= 80;
    const nomeDon = (x) => NOME.test(x) && x.length <= 40 && !/^(over|under|all|player|points|assists|rebounds|blocks|other|result|totals|handicap)$/i.test(x) && !/^(over|under)\b/i.test(x) && !/overtime|\+|quarter|half/i.test(x);
    const virar = (x) => (/^[^,]+,\s*[^,]+$/.test(x) ? x.replace(/^([^,]+),\s*(.+)$/, "$2 $1") : x);
    const pares = [];
    let tit = "";
    for (let i = 0; i < S.length; i++) {
      const x = S[i];
      if (tituloDon(x)) { tit = x; continue; }
      if (!tit || !nomeDon(x) || /double|triple|combo/i.test(tit)) continue;
      const jog = virar(x);
      const prox = S.slice(i + 1, i + 9).join(" ");
      const m = prox.match(/^over\s*\(?\s*(\d{1,3}[.,]\d)\s*\)?\s+(\d{1,3}[.,]\d{2,3})\s+under\s*\(?\s*(\d{1,3}[.,]\d)\s*\)?\s+(\d{1,3}[.,]\d{2,3})(\s|$)/i);
      if (m && m[1] === m[3]) { pares.push([tit, jog, num(m[1]), num(m[2]), num(m[4])]); continue; }
      // marcos: jogador | "10+" | odd | "15+" | odd …
      for (let k = i + 1; k + 1 < S.length && MARCO.test(S[k]) && P2.test(S[k + 1]); k += 2)
        pares.push([`${tit} · marco`, jog, +S[k].match(MARCO)[1] - 0.5, num(S[k + 1]), null]);
    }
    return pares;
  }

  // leitura DESTE documento (página de fora ou quadro)
  function capturarAqui() {
    const els = todos(document.documentElement).filter((el) => !fora(el));
    const cache = new Map(), F = (el) => cache.get(el) || cache.set(el, folhas(el)).get(el);
    if (CASA === "donbet") return { nome: nomeDoJogo(els, F), pares: capturarDonbet() };
    if (CASA === "betcoin") {
      // os dois leitores; o de botões vale por cima (mesma chave título|jogador|linha)
      const m = new Map();
      for (const p of [...capturarCampeon(els, F), ...capturarBetby(els, F), ...capturarSequencia()]) m.set(`${p[0]}|${p[1]}|${p[2]}`, p);
      return { nome: nomeDoJogo(els, F), pares: [...m.values()] };
    }
    return { nome: nomeDoJogo(els, F), pares: CASA === "jogabrasil" ? capturarJogaBrasil(els, F) : capturarCampeon(els, F) };
  }
  function diagnosticoAqui() {
    // textos dos elementos com preço (o suficiente para ajustar o leitor); nada da conta (saldo, nome) e nada da caixa
    const els = todos(document.documentElement).filter((el) => !fora(el));
    const amostra = els.map(folhas).filter((f) => f.length >= 2 && f.length <= 8 && f.some((t) => PRECO.test(t)) && !f.some((t) => /R\$|B\$|saldo/i.test(t))).slice(0, 400);
    const titulos = [...new Set(els.flatMap((el) => [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue.trim())).filter(CASA === "jogabrasil" ? ehTituloJB : ehTitulo))].slice(0, 200);
    const quadros = [...document.querySelectorAll("iframe")].map((f) => { try { return new URL(f.src || "about:blank").origin; } catch { return "?"; } });
    const cache = new Map(), F = (el) => cache.get(el) || cache.set(el, folhas(el)).get(el);
    return { url: location.origin + location.pathname, elementos: els.length, sombras: els.filter((el) => raiz(el)).length, quadros, titulos, capturado: capturarAqui().pares, estrutura: estruturaBotoes(els, F), amostra: [...new Set(amostra.map((f) => JSON.stringify(f)))].map((x) => JSON.parse(x)) };
  }

  // atalho (v1.13, pedido do usuário): tecla D = "Capturar esta tela"; não vale digitando num campo nem com Ctrl/Alt/⌘
  // (v1.14: E = expandir quadros, T = trocar time, só na CampeonBet/99play)
  const ehTecla = (e, letra) => {
    if (e.key?.toLowerCase() !== letra || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
    const alvo = e.composedPath?.()[0] || e.target;
    return !(alvo && (alvo.isContentEditable || /^(input|textarea|select)$/i.test(alvo.tagName || "")));
  };
  const ehTeclaD = (e) => ehTecla(e, "d");

  // ---------- dentro de um quadro: responde à página de fora ----------
  if (!TOPO) {
    // com o foco dentro do quadro (JogaBrasil) a tecla cai aqui: avisa a página de fora
    addEventListener("keydown", (e) => { if (ehTeclaD(e)) top.postMessage({ tp: "tp-tecla" }, "*"); }, true);
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
    // Betcoin/Betby: "?bt-path=/basketball/usa/nba/washington-wizards-detroit-pistons-2732496039935365120"
    const bt = (new URLSearchParams(location.search).get("bt-path") || "").split("/").filter(Boolean).pop() || "";
    const mb = bt.match(/^(.+?)-(\d{6,})$/);
    const nomeBt = mb ? `${mb[1].replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())} · ${mb[2]}` : "";
    const nome = nomeBt || aqui.nome || deles.map((r) => r?.nome).find(Boolean) || `${document.title || CASA} · evento ${(location.href.match(/event(?:Id=|\/)(\d+)/) || [, location.pathname.split("/").filter(Boolean).pop() || "?"])[1]}`;
    return { nome, pares, quadros: deles.length };
  }

  // ---------- ações (caixa e menu do Tampermonkey) ----------
  const resumo = () => {
    const jogos = Object.values(ler()), n = jogos.reduce((t, j) => t + Object.keys(j.pares || {}).length, 0);
    const velhos = jogos.filter((j) => Date.now() - j.em > 30 * 60e3).length;
    return `📊 Trader Poly · ${jogos.length} jogo(s), ${n} linhas capturadas${velhos ? ` (${velhos} jogo(s) com mais de 30 min)` : ""}`;
  };
  const COMO = CASA === "donbet"
    ? "Abra o jogo › aba \"Player\" (ou Points, Assists, Rebounds, Other), abra os quadros \"Total … (incl. overtime)\" e aperte D (ou \"Capturar esta tela\") em cada aba. As capturas se somam; no fim, \"Abrir a comparação\"."
    : CASA === "betcoin"
    ? "Abra o jogo › \"Adereços de jogador\" e aperte D (ou \"Capturar esta tela\") em cada aba: Principal, Pontos, Assistências, Rebotes, 3 pontos, Extras (role até o fim de cada uma). As capturas se somam; no fim, \"Abrir a comparação\"."
    : CASA === "velvet"
    ? "Abra o jogo › aba \"Total de jogadores\" (quadros \"individual total\") e aperte D ou \"Capturar esta tela\"; role e capture de novo se houver mais quadros; no fim, \"Abrir a comparação\"."
    : CASA === "jogabrasil"
    ? "Abra o jogo › \"Mercado de Jogadores\" e clique em \"Capturar esta tela\" (ou aperte D). Se a lista carrega aos poucos, role até o fim e capture de novo (as capturas se somam); no fim, \"Abrir a comparação\"."
    : "Abra um jogo › \"Especiais de Jogadores\" e clique em \"Capturar esta tela\" (ou aperte D). Troque de time e de aba (Pontos, 3 Pontos, Rebotes, Assistências, Combos) capturando cada uma; no fim, \"Abrir a comparação\".";
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
  async function acaoAbrir(peloMenu, destino) {
    // formato compacto que a aba lê: mercado = "título | jogador" (na JogaBrasil o jogador já está no título), odds = Mais de L / Menos de L
    const eventos = Object.values(ler()).map((j) => ({ id: j.nome, nome: j.nome, inicio: null, em: j.em,
      mercados: Object.values(j.pares).map(([titulo, jogador, L, O, U]) => [jogador ? `${titulo} | ${jogador}` : titulo, L, [[`Mais de ${L}`, O, L], [`Menos de ${L}`, U, L]]]) }));
    if (!eventos.length) { avisa(`Nada capturado ainda. ${COMO}`, peloMenu); return; }
    const aba = typeof GM_openInTab === "function" ? null : window.open("about:blank", "_blank"); // sem GM: a janela abre JÁ no clique
    const txt = JSON.stringify({ v: 2, casa: CASA, em: Math.min(...eventos.map((e) => e.em)), fonte: "tela", eventos, erros: 0 });
    const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const url = `${SITE}/${destino === "dk" ? "props.html?aba=campeon" : "padroes.html?aba=casa"}#campeon=${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
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

  // ---------- CampeonBet/99play (Altenar): expandir quadros e trocar o time (v1.14, pedido do usuário) ----------
  // Cliques no próprio navegador, só quando o usuário manda, com pausa entre eles (como uma pessoa faria).
  const ALTENAR = CASA === "campeon" || CASA === "play99";
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * 150));
  // v1.15: sem "view: window" (com @grant o window do Tampermonkey pode ser um invólucro e o MouseEvent dava erro → nada clicava);
  // o clique final é o click() nativo do elemento
  const clicar = (el) => {
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try { el.dispatchEvent(new (tipo.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent)(tipo, { bubbles: true, cancelable: true, composed: true })); } catch { /* segue */ }
    }
    el.click();
  };
  // a CampeonBet monta a página em shadow DOM (11 no diagnóstico de 26/10): subir e conter atravessando as sombras
  const pai = (el) => el.parentElement || el.getRootNode?.()?.host || null;
  const contem = (a, b) => { for (let x = b; x; x = pai(x)) if (x === a) return true; return false; };
  // conteúdo de um cartão que pode ser ele mesmo um hospedeiro de shadow (folhas/todos só entram nas sombras dos filhos)
  const folhasDe = (el) => (raiz(el) ? [...folhas(el), ...folhas(raiz(el))] : folhas(el));
  const todosDe = (el) => (raiz(el) ? [...todos(el), ...todos(raiz(el))] : todos(el));
  // cartões de mercado: o elemento do título "… Mais de/Menos de …" e o maior ancestral que só contém esse título
  function cartoes() {
    const els = todos(document.documentElement).filter((el) => !fora(el));
    const tits = els.filter((el) => [...el.childNodes].some((c) => c.nodeType === 3 && /mais de\s*\/\s*menos de/i.test(c.nodeValue)));
    return tits.map((t) => {
      let card = t;
      for (let up = pai(t), k = 0; up && up !== document.documentElement && k < 10; up = pai(up), k++) { if (tits.some((x) => x !== t && contem(up, x))) break; card = up; }
      const F = folhasDe(card);
      return { t, card, aberto: F.some((x) => /^linha$/i.test(x)) };
    });
  }
  // os dois times de um cartão aberto: os textos entre o título e "Linha" (sem selos como "BB", "CA", "Pa")
  function timesDe(card, t) {
    const F = folhasDe(card), i0 = F.findIndex((x) => t.textContent.includes(x)), i1 = F.findIndex((x) => /^linha$/i.test(x));
    const nomes = F.slice(i0 + 1, i1).filter((x) => NOME.test(x) && x.length >= 5 && !/^[—–\-+]$/.test(x));
    return nomes.slice(0, 2).map((n) => {
      const cand = todosDe(card).filter((el) => folhas(el).join(" ") === n);
      return cand.find((el) => !cand.some((o) => o !== el && contem(el, o))) || null; // o menor
    });
  }
  async function acaoExpandir(peloMenu) {
    let abertos = 0, mais = 0;
    for (const c of cartoes().filter((c) => !c.aberto)) { clicar(c.t); abertos++; await pausa(350); }
    if (abertos) await pausa(600);
    for (const c of cartoes().filter((c) => c.aberto)) {
      const b = todosDe(c.card).find((el) => /^mostrar mais jogadores$/i.test(folhas(el).join(" ").trim()) && ![...el.children].some((f) => /^mostrar mais/i.test(f.textContent.trim())));
      if (b) { clicar(b); mais++; await pausa(250); }
    }
    avisa(`Expandidos ${abertos} quadros${mais ? ` e ${mais} "Mostrar mais jogadores"` : ""} (${cartoes().filter((c) => c.aberto).length} abertos). Agora capture (D).`, peloMenu);
  }
  let timeAlvo = 0; // 0 = 1º time das abas, 1 = 2º
  async function acaoTrocar(peloMenu, para) {
    timeAlvo = para ?? 1 - timeAlvo;
    let n = 0, nome = "";
    for (const c of cartoes().filter((c) => c.aberto)) {
      const alvo = timesDe(c.card, c.t)[timeAlvo];
      if (alvo) { clicar(alvo); n++; nome ||= alvo.textContent.trim(); await pausa(250); }
    }
    avisa(n ? `Time trocado para ${nome} em ${n} quadros. Agora capture (D).` : "Nenhum quadro aberto com os dois times: use \"Expandir quadros\" (E) primeiro.", peloMenu);
  }
  // erro numa ação aparece na caixa (antes falhava calado)
  const seguro = (fn) => async (m, ...r) => { try { return await fn(m, ...r); } catch (err) { avisa(`Erro (${fn.name}): ${err?.message || err}. Mande o Diagnóstico.`, m); } };
  async function acaoTudo(peloMenu) {
    // o time antes do "Mostrar mais jogadores" (trocar de time pode recolher a lista)
    await acaoExpandir(false); await pausa(500);
    await acaoTrocar(false, 0); await pausa(800);
    await acaoExpandir(false); await pausa(400);
    await acaoCapturar(false);
    await acaoTrocar(false, 1); await pausa(800);
    await acaoExpandir(false); await pausa(400); // "Mostrar mais jogadores" do outro time
    await acaoCapturar(false);
    await acaoTrocar(false, 0);
    avisa(`Pronto: os dois times de ${cartoes().filter((c) => c.aberto).length} quadros capturados. Troque de aba (Pontos, 3 Pontos, Rebotes…) e use "Tudo" de novo; no fim, "Abrir a comparação".`, peloMenu);
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
    botao("Capturar esta tela (D)", acaoCapturar);
    if (ALTENAR) { botao("Expandir quadros (E)", seguro(acaoExpandir)); botao("Trocar time (T)", seguro((m) => acaoTrocar(m))); botao("Tudo: 2 times", seguro(acaoTudo)); }
    botao("Abrir a comparação", acaoAbrir); // 1.18 (usuário, 11/11): vai para a aba Casa × Painel
    botao("Casas × DK", (m) => acaoAbrir(m, "dk"));
    botao("Limpar", acaoLimpar);
    botao("Diagnóstico", acaoDiagnostico);
    mostrar(COMO);
    const prende = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
    prende();
    new MutationObserver(prende).observe(document.documentElement, { childList: true });
    setInterval(prende, 1000);
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", montarCaixa, { once: true }); else montarCaixa();
  // tecla D: captura; se a caixa estiver escondida pelo site, o resultado vem num aviso
  let ultimaTecla = 0;
  const visivel = () => { if (!host?.isConnected) return false; const r = host.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(host).visibility !== "hidden"; };
  const pelaTecla = () => { if (Date.now() - ultimaTecla < 800) return; ultimaTecla = Date.now(); acaoCapturar(!visivel()); };
  addEventListener("keydown", (e) => { if (ehTeclaD(e)) { e.preventDefault(); pelaTecla(); } }, true);
  if (ALTENAR) addEventListener("keydown", (e) => {
    const qual = ehTecla(e, "e") ? seguro(acaoExpandir) : ehTecla(e, "t") ? seguro((m) => acaoTrocar(m)) : null;
    if (!qual || Date.now() - ultimaTecla < 800) return;
    e.preventDefault(); ultimaTecla = Date.now(); qual(!visivel());
  }, true);
  addEventListener("message", (e) => { if (e.data?.tp === "tp-tecla" && quadrosDe(window).includes(e.source)) pelaTecla(); });
  // menu do Tampermonkey (ícone da extensão): funciona mesmo se o site esconder a caixa
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("📊 Capturar esta tela (tecla D)", () => acaoCapturar(true));
    if (ALTENAR) {
      GM_registerMenuCommand("Expandir quadros (tecla E)", () => seguro(acaoExpandir)(true));
      GM_registerMenuCommand("Trocar time (tecla T)", () => seguro((m) => acaoTrocar(m))(true));
      GM_registerMenuCommand("Tudo: expandir e capturar os 2 times", () => seguro(acaoTudo)(true));
    }
    GM_registerMenuCommand("Abrir a comparação (Casa × Painel)", () => acaoAbrir(true));
    GM_registerMenuCommand("Casas × DK (pré-jogo)", () => acaoAbrir(true, "dk"));
    GM_registerMenuCommand("Limpar capturas", () => acaoLimpar(true));
    GM_registerMenuCommand("Diagnóstico", () => acaoDiagnostico());
  }
})();
