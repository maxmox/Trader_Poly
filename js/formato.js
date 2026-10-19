// Formatação comum às páginas (texto em português, números com vírgula). Sem regra de negócio:
// odd, centavos e a descrição da aposta ficam em core.js, que também vai para o Worker.
export { odd, cents } from "./core.js";

export const $ = (s) => document.querySelector(s);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const usd = (v) => (v == null ? "–" : "$" + Math.round(v).toLocaleString("pt-BR"));

// fração -> "+12,3%" (casas = decimais)
export const pct = (v, casas = 1) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(casas).replace(".", ",")}%`);

// "há 40 s", "há 12 min", "há 3 h", "há 2 dias"
export function ha(ms) {
  if (!ms) return "–";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 90 ? `há ${Math.round(s)} s` : s < 5400 ? `há ${Math.round(s / 60)} min` : s < 172800 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86400)} dias`;
}

export const dataHora = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
export const hora = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// aposta sugerida pelos Ajustes (banca × %)
export const stakeDe = (cfg) => (cfg.banca * cfg.pct) / 100;
