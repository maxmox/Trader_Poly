// Junta core.js + relay/worker.src.js em relay/cloudflare-worker.js (um arquivo só,
// para colar no painel da Cloudflare). Rode depois de mudar core.js ou o worker:
//   node scripts/build-worker.mjs
import { readFile, writeFile } from "node:fs/promises";

const raiz = new URL("../", import.meta.url);
const core = (await readFile(new URL("core.js", raiz), "utf8")).replace(/^export (?=(const|function|async function) )/gm, "");
const worker = await readFile(new URL("relay/worker.src.js", raiz), "utf8");
const topo = `// relay/cloudflare-worker.js — GERADO por scripts/build-worker.mjs. Não edite à mão:
// edite core.js ou relay/worker.src.js e rode o build de novo.
// Como publicar: veja "Alertas no Telegram" no README.
`;
await writeFile(new URL("relay/cloudflare-worker.js", raiz), `${topo}\n// ===== core.js =====\n${core}\n${worker}`);
console.log("relay/cloudflare-worker.js gerado");
