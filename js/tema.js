// Tema claro/escuro (09/11/2026, pedido do usuário). Carregado no <head> sem defer para não piscar:
// aplica o tema guardado antes de desenhar e depois põe o botão na barra do topo.
// "auto" segue o sistema (prefers-color-scheme, já tratado em styles.css); "escuro"/"claro" fixam.
(function () {
  var CHAVE = "traderpoly.tema";
  var ORDEM = ["auto", "escuro", "claro"];
  var ROTULO = { auto: "◐ Auto", escuro: "☾ Escuro", claro: "☀ Claro" };
  function ler() {
    try { var t = localStorage.getItem(CHAVE); return ORDEM.indexOf(t) >= 0 ? t : "auto"; } catch (e) { return "auto"; }
  }
  function aplicar(t) {
    var r = document.documentElement;
    if (t === "escuro") r.setAttribute("data-theme", "dark");
    else if (t === "claro") r.setAttribute("data-theme", "light");
    else r.removeAttribute("data-theme");
  }
  aplicar(ler());
  function botao() {
    var lugar = document.querySelector(".bar-right");
    if (!lugar || document.getElementById("tema-btn")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "tema-btn";
    b.className = "pill tema-btn";
    b.title = "Tema: automático (sistema), escuro ou claro";
    b.textContent = ROTULO[ler()];
    b.onclick = function () {
      var t = ORDEM[(ORDEM.indexOf(ler()) + 1) % ORDEM.length];
      try { localStorage.setItem(CHAVE, t); } catch (e) {}
      aplicar(t);
      b.textContent = ROTULO[t];
    };
    lugar.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", botao);
  else botao();
})();
