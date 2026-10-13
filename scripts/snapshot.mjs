// Gera data/snapshot.json com as posições abertas e o veredito de cada uma.
// Roda na GitHub Action (servidores do GitHub não sofrem o bloqueio de DNS do
// provedor), assim o site sempre tem dados recentes mesmo sem acesso direto.
// Local: RELAY=http://localhost:8787 node scripts/snapshot.mjs
import { readFile, writeFile } from "node:fs/promises";
import { criarApi, carregarTodos } from "../core.js";

const raiz = new URL("../", import.meta.url);
const ler = async (p) => JSON.parse(await readFile(new URL(p, raiz), "utf8"));

const { traders } = await ler("data/traders.json");
const prefixos = await ler("data/prefixos.json");
const api = criarApi({ relay: process.env.RELAY || "" });

const snap = await carregarTodos(api, traders, { prefixos });
await writeFile(new URL("data/snapshot.json", raiz), JSON.stringify(snap));

const n = snap.traders.reduce((s, t) => s + t.posicoes.length, 0);
const copiar = snap.traders.reduce((s, t) => s + t.posicoes.filter((p) => p.status === "COPIAR").length, 0);
const erros = snap.traders.filter((t) => t.erro);
console.log(`${n} posições abertas, ${copiar} copiáveis agora`);
for (const t of erros) console.error("erro", t.carteira, t.erro);
if (erros.length === traders.length) process.exit(1);
