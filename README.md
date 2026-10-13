# Trader Poly

Painel que acompanha os traders de esporte do Polymarket que vale copiar e diz, posição por posição, se dá para copiar **agora**.

## O que a página mostra

- **Copiáveis agora:** as posições abertas que passam nas regras, com o preço máximo, o valor da aposta para a sua banca e o link do mercado.
- **Traders:** as 8 carteiras escolhidas na análise (4 para copiar, 4 em observação), com todas as posições abertas e o motivo de cada veredito.

### Regras do veredito

| Veredito | Quando |
|---|---|
| Copiar | O jogo não começou, é um esporte em que o trader é bom e a melhor oferta de venda está até o teto (preço dele + 2¢, no máximo 97¢) |
| Esperar | O preço passou do teto, mas está até 5¢ acima do dele: deixe uma ordem limitada no teto |
| Não copiar | O jogo começou, o preço fugiu, o mercado está fechado ou não é a especialidade dele |

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
| `core.js` | Busca as posições e decide o veredito; usado pela página e pela Action |
| `app.js`, `index.html`, `styles.css` | A página |
| `data/traders.json` | Os traders escolhidos, os esportes de cada um e as estatísticas |
| `data/prefixos.json` | Prefixo do mercado → esporte (`nfl` → Futebol Americano, `cs2` → CS2…) |
| `data/snapshot.json` | Retrato gerado pela Action |
| `scripts/snapshot.mjs` | Gera o retrato |
| `relay/cloudflare-worker.js` | Relay opcional para quem tem o Polymarket bloqueado |

## Trocar os traders

A lista vem da análise em `polymarket_traders/` (`analisar_traders.py` e `backtest_copia.py`). Para atualizar, refaça a análise, ajuste a lista em `gerar_traders_site.py` e rode o script: ele regrava `data/traders.json`. Depois faça commit e push.

Rodar o retrato localmente: `node scripts/snapshot.mjs` (Node 18 ou mais novo). Com o DNS bloqueado, use `RELAY=https://seu-relay.workers.dev node scripts/snapshot.mjs`.

Isto não é recomendação financeira. Confira as regras de acesso ao Polymarket no seu país.
