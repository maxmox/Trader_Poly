// ==UserScript==
// @name         Trader Poly — coletor CampeonBet
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.0
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
    const SITE = "https://maxmox.github.io/Trader_Poly", ORIGEM = "https://maxmox.github.io";
    if (!/campeonbet\./i.test(location.host)) { alert("Abra a página da NBA na CampeonBet (com as odds carregadas) e clique de novo no botão."); return; }
    if (window.__coletorCampeon) { alert("A coleta já está rodando nesta aba."); return; }
    window.__coletorCampeon = true;
    // abre a aba do nosso site JÁ no clique (depois o navegador bloquearia a janela)
    const destino = window.open(`${SITE}/props.html?aba=campeon`, "traderpoly_campeon");
    const caixa = document.createElement("div");
    caixa.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:12px 14px;border-radius:8px;background:#10243e;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(caixa);
    const status = (t) => { caixa.textContent = `Trader Poly · ${t}`; };
    const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
    try {
      // endereço da API: pelos recursos já carregados (na página e nos quadros/iframes acessíveis); senão, o padrão da Altenar
      const nomes = [];
      const junta = (w) => { try { nomes.push(...w.performance.getEntriesByType("resource").map((e) => e.name)); } catch { /* quadro de outro site */ } };
      junta(window);
      for (const fr of document.querySelectorAll("iframe")) junta(fr.contentWindow);
      const recursos = nomes.filter((n) => /\/api\/widget\/Get/i.test(n));
      const modelo = recursos.find((n) => /GetEvents/i.test(n)) || recursos[0]
        || "https://sb2frontend-altenar2.biahosted.com/api/widget/GetEvents?culture=pt-PT&timezoneOffset=180&integration=campeonbet&deviceType=1&numFormat=en-GB&countryCode=BR";
      const u = new URL(modelo), base = `${u.origin}${u.pathname.replace(/\/[^/]*$/, "")}`;
      const P = new URLSearchParams(u.search);
      if (!P.get("integration")) P.set("integration", "campeonbet");
      P.set("culture", "en-GB"); // nomes dos mercados em inglês: mais fáceis de ler do nosso lado
      for (const k of ["eventId", "championshipIds", "sportId", "eventCount", "categoryIds"]) P.delete(k);
      const champ = new URLSearchParams(location.search).get("championshipIds") || "2980";
      const pega = async (fn, extra) => {
        const q = new URLSearchParams(P);
        for (const [k, v] of Object.entries(extra)) q.set(k, v);
        const r = await fetch(`${base}/${fn}?${q}`).catch((e) => { throw new Error(`${fn}: o navegador recusou a consulta (${e.message}) em ${base}`); });
        if (!r.ok) throw new Error(`${fn} respondeu ${r.status} (${base})`);
        return r.json();
      };
      status("lendo a lista de jogos…");
      const lista = await pega("GetEvents", { eventCount: "0", sportId: "0", championshipIds: champ });
      const eventos = (lista.events || []).slice(0, 16);
      if (!eventos.length) throw new Error("nenhum jogo na lista desta página");
      const detalhes = [];
      for (const [i, e] of eventos.entries()) {
        status(`lendo o jogo ${i + 1} de ${eventos.length}…`);
        await espera(1500 + Math.random() * 1000);
        detalhes.push(await pega("GetEventDetails", { eventId: String(e.id) }).catch((err) => ({ erro: String(err.message || err), id: e.id })));
      }
      const pacote = { em: Date.now(), champ, lista, detalhes };
      status("enviando para o Trader Poly…");
      let ok = false;
      addEventListener("message", (m) => { if (m.origin === ORIGEM && m.data === "campeon-ok") ok = true; });
      for (let t = 0; t < 80 && !ok; t++) { destino?.postMessage({ tipo: "campeon", pacote }, ORIGEM); await espera(500); }
      status(ok ? `pronto: ${eventos.length} jogos enviados. Veja a aba "CampeonBet × DK".` : "não consegui entregar à aba do Trader Poly (o navegador bloqueou a janela?). Libere pop-ups para este site e clique de novo.");
    } catch (e) {
      status(`não deu: ${e.message || e} — tire um print desta caixa e mande (ela some em 60 s)`);
    } finally {
      window.__coletorCampeon = false;
      setTimeout(() => caixa.remove(), 60000);
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
