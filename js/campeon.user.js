// ==UserScript==
// @name         Trader Poly — coletor CampeonBet
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.2
// @downloadURL  https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @updateURL    https://maxmox.github.io/Trader_Poly/js/campeon.user.js
// @description  Botão "Coletar para o Trader Poly" na CampeonBet: lê as odds da NBA SÓ quando você clica e manda para a aba "CampeonBet × DK".
// @match        https://campeonbet.io/*
// @match        https://*.campeonbet.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Coletor da CampeonBet (25/10/2026), um arquivo só para os dois jeitos de rodar:
//   - Tampermonkey (recomendado): instalado por este endereço (.user.js); põe um botão fixo na página da CampeonBet.
//   - Favorito (bookmarklet): a aba "CampeonBet × DK" monta o link "javascript:" com este arquivo e window.__traderPolyFavorito = 1.
// Roda NO NAVEGADOR DO USUÁRIO, só quando ele clica, com a página da NBA da CampeonBet aberta: as odds vêm da API da
// Altenar (biahosted.com, atrás do Cloudflare, que bloqueia servidor/robô — não contornamos isso). O coletor usa a mesma
// API que a página já usou (descobre o endereço e os parâmetros pelos recursos carregados), 1 consulta da lista de jogos
// + 1 por jogo, com 1,5–2,5 s entre elas (como alguém abrindo jogo por jogo), e manda tudo para a aba do nosso site
// por postMessage. Nada roda sozinho.
(() => {
  async function coletar() {
    const SITE = "https://maxmox.github.io/Trader_Poly";
    if (!/campeonbet\./i.test(location.host)) { alert("Abra a página da NBA na CampeonBet (com as odds carregadas) e clique de novo no botão."); return; }
    if (window.__coletorCampeon) { alert("A coleta já está rodando nesta aba."); return; }
    window.__coletorCampeon = true;
    // v1.1 (25/10): a coleta fica NESTA aba, com o andamento à vista; no fim, "Abrir a comparação" abre a nossa aba com
    // os dados no próprio endereço (comprimidos). A v1.0 abria a nossa aba no começo e mandava por postMessage, e os
    // dados não chegavam. Reserva: "Copiar dados" aqui e "Colar dados" na nossa aba.
    document.getElementById("trader-poly-caixa")?.remove();
    const caixa = document.createElement("div");
    caixa.id = "trader-poly-caixa";
    caixa.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 14px;border-radius:8px;background:#10243e;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    const texto = document.createElement("div");
    caixa.appendChild(texto);
    document.body.appendChild(caixa);
    const status = (t) => { texto.textContent = `Trader Poly · ${t}`; };
    const botao = (rot, fn) => { const b = document.createElement("button"); b.textContent = rot; b.style.cssText = "margin:8px 8px 0 0;padding:7px 11px;border:0;border-radius:6px;background:#3d8bfd;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer"; b.addEventListener("click", fn); caixa.appendChild(b); return b; };
    const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
    // gzip + base64url (para caber no endereço)
    const comprime = async (txt) => {
      const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    };
    // um GetEventDetails da Altenar → { id, nome, inicio, mercados: [[nome, sv, [[nome da odd, preço, sv]]]] } (compacto)
    const compacta = (d, e) => {
      const ev = d?.event && typeof d.event === "object" ? { ...d, ...d.event } : d || {};
      const odds = new Map((ev.odds || []).map((o) => [o.id, o]));
      const mercados = (ev.markets || []).map((m) => {
        const ids = m.oddIds || [...(m.desktopOddIds || []), ...(m.mobileOddIds || [])].flat();
        return [String(m.name || ""), m.sv ?? null, [...new Set(ids)].map((id) => odds.get(id)).filter(Boolean).map((o) => [String(o.name || ""), +o.price, o.sv ?? null])];
      }).filter((m) => m[2].length);
      return { id: ev.id ?? e.id, nome: String(ev.name || e.name || ""), inicio: ev.startDate || e.startDate || null, mercados };
    };
    try {
      // v1.2 (25/10): a API da CampeonBet é sb2integration-altenar2.biahosted.com/api/Widget e lá "GetEvents" não existe
      // (404). Então nada de montar nomes: a LISTA de jogos é a mesma consulta que a página já fez (trocando só o idioma), e
      // o nome da função do DETALHE de um jogo é o que a página usou (se algum jogo foi aberto) ou o primeiro nome conhecido
      // da Altenar que responder com mercados. Se não achar, a caixa lista as funções que a página usa.
      const nomes = [];
      const junta = (w) => { try { nomes.push(...w.performance.getEntriesByType("resource").map((e) => e.name)); } catch { /* quadro de outro site */ } };
      junta(window);
      for (const fr of document.querySelectorAll("iframe")) junta(fr.contentWindow);
      const api = [...new Set(nomes.filter((n) => /biahosted\.com\/api\//i.test(n)))];
      const funcao = (url) => new URL(url).pathname.split("/").pop();
      const funcoes = [...new Set(api.map(funcao))];
      const vistos = () => `Funções que a página usa: ${funcoes.join(", ") || "nenhuma (a página carregou as odds?)"}`;
      const idioma = (url) => { const x = new URL(url); x.searchParams.set("culture", "en-GB"); return x.toString(); }; // nomes em inglês
      const busca = async (url) => {
        const r = await fetch(url).catch((e) => { throw new Error(`o navegador recusou ${funcao(url)} (${e.message})`); });
        if (!r.ok) throw new Error(`${funcao(url)} respondeu ${r.status}`);
        return r.json();
      };
      const eventosDe = (j) => j?.events || j?.Events || Object.values(j || {}).find((v) => Array.isArray(v) && v[0]?.id != null && v[0]?.name != null) || [];
      const mercadosDe = (d) => d?.markets || d?.event?.markets || d?.Markets || [];
      const champ = new URLSearchParams(location.search).get("championshipIds") || "2980";
      // 1) lista de jogos: as consultas que a página fez, primeiro as do campeonato
      status("lendo a lista de jogos…");
      const candLista = api.filter((n) => /events|championship/i.test(n)).sort((a, b) => (b.includes(champ) ? 1 : 0) - (a.includes(champ) ? 1 : 0));
      let lista = null, urlLista = null;
      for (const url of candLista.slice(0, 4)) {
        try { const j = await busca(idioma(url)); if (eventosDe(j).length) { lista = j; urlLista = url; break; } } catch { /* tenta a próxima */ }
        await espera(600);
      }
      if (!lista) throw new Error(`não achei a lista de jogos. ${vistos()}`);
      const eventos = eventosDe(lista).slice(0, 16);
      // 2) detalhe de cada jogo, no mesmo servidor e com os mesmos parâmetros da lista
      const u = new URL(urlLista), base = `${u.origin}${u.pathname.replace(/\/[^/]*$/, "")}`;
      const P = new URLSearchParams(u.search);
      P.set("culture", "en-GB");
      for (const k of ["eventId", "eventIds", "championshipIds", "sportId", "sportIds", "eventCount", "categoryIds", "champIds"]) P.delete(k);
      const det = (fn, id) => { const q = new URLSearchParams(P); q.set("eventId", String(id)); return busca(`${base}/${fn}?${q}`); };
      const cands = [...new Set([...funcoes.filter((f) => /detail/i.test(f)), "GetEventDetails", "GetEventDetail", "GetEvent", "GetEventMarkets", "GetMarkets"])];
      let fnDet = null, primeiro = null;
      for (const fn of cands) {
        status(`procurando o detalhe dos jogos (${fn})…`);
        try { const d = await det(fn, eventos[0].id); if (mercadosDe(d).length) { fnDet = fn; primeiro = d; break; } } catch { /* tenta o próximo nome */ }
        await espera(800);
      }
      if (!fnDet) throw new Error(`achei ${eventos.length} jogos, mas não a consulta do detalhe de um jogo (testei ${cands.join(", ")}). ${vistos()}. Tente: abra um jogo da NBA na CampeonBet, volte para a lista e clique de novo.`);
      const lidos = [];
      let erros = 0;
      const amostra = { lista: funcao(urlLista), detalhe: fnDet, funcoes, chaves: Object.keys(primeiro || {}), mercado: mercadosDe(primeiro)[0] || null, odd: (primeiro?.odds || primeiro?.event?.odds || [])[0] || null };
      for (const [i, e] of eventos.entries()) {
        status(`lendo o jogo ${i + 1} de ${eventos.length}… (fique nesta aba)`);
        try {
          const d = i === 0 ? primeiro : (await espera(1500 + Math.random() * 1000), await det(fnDet, e.id));
          lidos.push(compacta(d, e));
        } catch (err) { erros++; }
      }
      const pacote = { v: 2, em: Date.now(), champ, eventos: lidos, erros, amostra };
      const nMerc = lidos.reduce((t, e) => t + e.mercados.length, 0);
      const json = JSON.stringify(pacote), dados = await comprime(json);
      status(`pronto: ${lidos.length} jogos, ${nMerc} mercados${erros ? ` (${erros} com erro)` : ""}.`);
      botao("Abrir a comparação", () => window.open(`${SITE}/props.html?aba=campeon#campeon=${dados}`, "_blank"));
      botao("Copiar dados", async (ev) => { try { await navigator.clipboard.writeText(dados); ev.target.textContent = "copiado: cole na aba do Trader Poly"; } catch { ev.target.textContent = "não consegui copiar"; } });
      botao("Fechar", () => caixa.remove());
    } catch (e) {
      status(`não deu: ${e.message || e} — tire um print desta caixa e mande`);
      botao("Fechar", () => caixa.remove());
    } finally {
      window.__coletorCampeon = false;
    }
  }
  if (window.__traderPolyFavorito) { window.__traderPolyFavorito = 0; coletar(); return; } // rodou pelo favorito
  // Tampermonkey: botão fixo no canto (só age no clique)
  if (document.getElementById("trader-poly-coletar")) return;
  const b = document.createElement("button");
  b.id = "trader-poly-coletar";
  b.textContent = "📊 Coletar para o Trader Poly";
  b.title = "Lê as odds da NBA desta página (devagar, ~2 s por jogo) e abre a comparação com a DraftKings";
  b.style.cssText = "position:fixed;z-index:2147483646;left:16px;bottom:16px;padding:9px 13px;border:0;border-radius:8px;background:#1d5fa8;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3)";
  b.addEventListener("click", coletar);
  document.body.appendChild(b);
})();
