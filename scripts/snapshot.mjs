// Gera data/snapshot.json com as posições abertas e o veredito de cada uma.
// Roda na GitHub Action (servidores do GitHub não sofrem o bloqueio de DNS do
// provedor), assim o site sempre tem dados recentes mesmo sem acesso direto.
// Local: RELAY=http://localhost:8787 node scripts/snapshot.mjs
import { readFile, writeFile } from "node:fs/promises";
import { criarApi, carregarTodos, vigentes } from "../js/core.js";

const raiz = new URL("../", import.meta.url);
const ler = async (p) => JSON.parse(await readFile(new URL(p, raiz), "utf8"));

// traders de teste expirados saem dos arquivos publicados (segurança extra além do site e do Worker)
for (const f of ["data/traders.json", "data/traders_live.json"]) {
  const d = await ler(f);
  const antes = d.traders.length;
  d.traders = vigentes(d.traders);
  if (d.traders.length !== antes) await writeFile(new URL(f, raiz), JSON.stringify(d, null, 1));
}
const { traders } = await ler("data/traders.json");
const prefixos = await ler("data/prefixos.json");
const api = criarApi({ relay: process.env.RELAY || "" });

const indices = await ler("data/indices.json").catch(() => null);
const snap = await carregarTodos(api, traders, { prefixos, indices });
const n = snap.traders.reduce((s, t) => s + t.posicoes.length, 0);
const copiar = snap.traders.reduce((s, t) => s + t.posicoes.filter((p) => p.status === "COPIAR").length, 0);
const erros = snap.traders.filter((t) => t.erro);
console.log(`${n} posições abertas, ${copiar} copiáveis agora`);
for (const t of erros) console.error("erro", t.carteira, t.erro);
// Polymarket recusando todos (03/11/2026: 6h40 seguidas) não pode derrubar a rodada: o resto da Action (linhas e registro
// da NBA) não depende dele. Fica o último retrato publicado; a causa aparece nas anotações da execução (públicas).
if (erros.length === traders.length) {
  const SITE = process.env.SITE_URL || "https://maxmox.github.io/Trader_Poly";
  const pub = await fetch(`${SITE}/data/snapshot.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  console.log(`::warning::Polymarket recusou todos os traders (${erros[0].erro}); ${pub?.traders ? "mantido o retrato publicado" : "sem retrato publicado"}`);
  if (pub?.traders) await writeFile(new URL("data/snapshot.json", raiz), JSON.stringify(pub));
  process.exitCode = pub?.traders ? 0 : 1;
} else {
  await writeFile(new URL("data/snapshot.json", raiz), JSON.stringify(snap));
}
