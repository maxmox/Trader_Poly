// ==UserScript==
// @name         Trader Poly — coletor CampeonBet
// @namespace    https://maxmox.github.io/Trader_Poly
// @version      1.1
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
      if (!eventos.length) throw new Error(`nenhum jogo na lista (a resposta tinha: ${Object.keys(lista || {}).join(", ")})`);
      const lidos = [];
      let erros = 0, amostra = null;
      for (const [i, e] of eventos.entries()) {
        status(`lendo o jogo ${i + 1} de ${eventos.length}… (fique nesta aba)`);
        await espera(1500 + Math.random() * 1000);
        try {
          const d = await pega("GetEventDetails", { eventId: String(e.id) });
          amostra ??= { chaves: Object.keys(d || {}), mercado: (d?.markets || d?.event?.markets || [])[0] || null, odd: (d?.odds || d?.event?.odds || [])[0] || null };
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
