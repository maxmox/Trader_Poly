// Carimba a versão nos arquivos .js e .css (?v=...) antes de publicar, para o navegador
// não continuar usando a versão antiga guardada em cache (o GitHub Pages manda guardar
// por 10 min e o navegador reaproveita os módulos JavaScript já carregados).
// Uso (na Action): node scripts/versionar.mjs <versão>
import { readFile, writeFile } from "node:fs/promises";

const v = (process.argv[2] || Date.now().toString(36)).slice(0, 12);
const raiz = new URL("../", import.meta.url);
const arquivos = ["index.html", "app.js", "aovivo.js", "nota.js", "placar.js"];
for (const f of arquivos) {
  const u = new URL(f, raiz);
  let s = await readFile(u, "utf8");
  // import ... from "./x.js"  |  src="app.js"  |  href="styles.css"
  s = s.replace(/(from\s+["']\.\/[\w-]+\.js)(["'])/g, `$1?v=${v}$2`)
       .replace(/((?:src|href)=["'][\w-]+\.(?:js|css))(["'])/g, `$1?v=${v}$2`);
  await writeFile(u, s);
}
console.log("versão", v, "carimbada em", arquivos.join(", "));
