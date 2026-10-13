# Trader Poly

Painel que acompanha os traders de esporte do Polymarket que vale copiar e diz, posição por posição, se dá para copiar **agora**.

## O que a página mostra

Tudo em **odd decimal**: odd 2,00 paga $20 para uma aposta de $10 (odd = 1 ÷ preço no Polymarket). O card também mostra o preço em centavos para montar a ordem limitada no Polymarket.

### Aba Pré-jogo

- **Copiáveis agora:** posições abertas que passam nas regras, com a odd mínima, a aposta e o retorno para a sua banca e o link do mercado.
- **Traders:** as 8 carteiras escolhidas na análise (4 para copiar, 4 em observação), com todas as posições abertas e o motivo de cada veredito.

| Veredito | Quando |
|---|---|
| Copiar | O jogo não começou, é um esporte em que o trader é bom e a odd ainda está perto da dele (no máximo 2¢ de preço pior; odd 2,00 → mínima 1,92) |
| Esperar | A odd caiu um pouco além disso (até 5¢ de preço): deixe uma ordem limitada na odd mínima |
| Não copiar | O jogo começou, a odd caiu demais, o mercado está fechado ou não é a especialidade dele |

### Aba Ao vivo

Sinais de traders que entram **durante o jogo** e seguram até o fim. O site consulta a cada 15 s e mostra cada entrada nova com uma contagem regressiva: a janela do trader (1–2 min) é o tempo em que, no histórico, ainda dava lucro copiar.

Os traders ao vivo (`data/traders_live.json`) passaram por:

- **Segura até o fim:** vende menos de 15% do que compra e quase não opera os dois lados.
- **Absorve volume:** mercado mediano acima de $100 mil e compra no nível do mercado (não "pesca" preço errado em livro vazio).
- **Replicável:** nas últimas até 100 entradas ao vivo, comprar 1 min depois, pagando o preço negociado + 0,5¢, deu ≥ 5% de ROI, com ≥ 60% das entradas ainda dentro da odd mínima.

A aba ao vivo **precisa de acesso em tempo real** (DNS seguro ou relay). O retrato de 10 min não serve para ela.

## Como os dados chegam

1. **Direto do navegador:** a página consulta a API pública do Polymarket a cada 1 minuto.
2. **Retrato do servidor:** uma GitHub Action roda `scripts/snapshot.mjs` a cada ~10 minutos e publica `data/snapshot.json`. A página usa esse retrato quando não consegue acessar o Polymarket direto.
3. **Relay (opcional):** vários provedores no Brasil bloqueiam o DNS do Polymarket. Para ter tempo real mesmo assim, publique `relay/cloudflare-worker.js` como Cloudflare Worker (grátis) e cole a URL em **Ajustes**. Outra saída é ativar o DNS seguro do navegador (Chrome/Edge: Configurações → Privacidade e segurança → Usar DNS seguro → Cloudflare).

## Publicar no GitHub Pages (uma vez)

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Abra **Actions → Atualizar e publicar → Run workflow**.
4. O site fica em `https://maxmox.github.io/Trader_Poly/`.

Se o repositório ficar 60 dias sem commits, o GitHub desliga a atualização agendada. Para religar, use **Run workflow** ou faça qualquer commit.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `core.js` | Busca as posições e os sinais ao vivo e decide o veredito; usado pela página e pela Action |
| `aovivo.js` | A aba Ao vivo |
| `data/traders_live.json` | Os traders ao vivo, a janela e os esportes de cada um |
| `app.js`, `index.html`, `styles.css` | A página |
| `data/traders.json` | Os traders escolhidos, os esportes de cada um e as estatísticas |
| `data/prefixos.json` | Prefixo do mercado → esporte (`nfl` → Futebol Americano, `cs2` → CS2…) |
| `data/snapshot.json` | Retrato gerado pela Action |
| `scripts/snapshot.mjs` | Gera o retrato |
| `relay/cloudflare-worker.js` | Relay opcional para quem tem o Polymarket bloqueado |

## Trocar os traders

A lista pré-jogo vem de `polymarket_traders/` (`analisar_traders.py`, `backtest_copia.py` → `gerar_traders_site.py`, que grava `data/traders.json`). A lista ao vivo vem de `live_analise.py` / `live_ampliar.py` → `gerar_traders_live.py`, que grava `data/traders_live.json`. Depois faça commit e push.

Rodar o retrato localmente: `node scripts/snapshot.mjs` (Node 18 ou mais novo). Com o DNS bloqueado, use `RELAY=https://seu-relay.workers.dev node scripts/snapshot.mjs`.

Isto não é recomendação financeira. Confira as regras de acesso ao Polymarket no seu país.
