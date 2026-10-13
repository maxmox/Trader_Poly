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

## Alertas no Telegram (e tempo real no site)

Um Cloudflare Worker (grátis) faz duas coisas:
- **Relay:** o site passa a buscar os dados por ele, contornando o bloqueio de DNS. Com isso, o site fica em tempo real e a aba Ao vivo funciona.
- **Alertas:** a cada minuto ele procura entradas ao vivo novas e verifica o pré-jogo de um trader, em rodízio (cada um a cada ~8 min). Cada sinal vai **uma vez** para o seu Telegram, com a odd mínima, o prazo da janela e o link. O plano grátis permite 50 consultas por execução; o Worker usa no máximo ~20.

### 1. Criar o bot no Telegram

1. No Telegram, fale com **@BotFather** → `/newbot` → escolha um nome. Ele devolve o **token** (`123456:ABC...`).
2. Abra o seu bot novo e mande qualquer mensagem (ex.: `oi`).
3. No navegador, abra `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` e copie o número em `"chat":{"id": ...}`. Esse é o **chat id**.

### 2. Publicar o Worker

1. https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker** → Deploy.
2. **Edit code** → apague tudo → cole o conteúdo de `relay/cloudflare-worker.js` → **Deploy**.
3. **Settings → Variables and Secrets**, adicione:
   - `TELEGRAM_TOKEN` (Secret): o token do bot
   - `TELEGRAM_CHAT_ID` (Secret): o chat id
   - `BANCA` e `PCT` (Text, opcional): ex. `1000` e `1.5`, para a mensagem sugerir o valor da aposta
4. **Storage & Databases → KV → Create** um namespace (ex.: `trader-poly`). No Worker: **Settings → Bindings → Add → KV namespace**, nome da variável **`ENVIADOS`**. É isso que impede mensagens repetidas.
5. **Settings → Triggers → Cron Triggers → Add**: `* * * * *` (a cada minuto).
6. Teste: abra `https://SEU-WORKER.workers.dev/teste`. Deve chegar "Trader Poly conectado" no Telegram. Em `/verificar`, você vê o que ele encontrou agora; `/verificar?pre=mde4life1986` verifica o pré-jogo de um trader específico.

### 3. Ligar o site ao Worker

Coloque a URL do Worker em `data/config.json` (`{"relay": "https://SEU-WORKER.workers.dev"}`) e faça commit. Todos os aparelhos passam a usar o relay. Para um aparelho só, cole a URL em **Ajustes → Relay**.

Depois de mudar `core.js` ou `relay/worker.src.js`, rode `node scripts/build-worker.mjs` e cole de novo o `relay/cloudflare-worker.js` no painel.

## Publicar no GitHub Pages (uma vez)

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Abra **Actions → Atualizar e publicar → Run workflow**.
4. O site fica em `https://maxmox.github.io/Trader_Poly/`.

Se o Source ficar em "Deploy from a branch", o site mostra sempre o `data/snapshot.json` do repositório, um retrato parado. A Action até gera o retrato novo, mas ele não vai ao ar.

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
| `relay/cloudflare-worker.js` | Worker da Cloudflare: relay + alertas no Telegram (gerado, não edite) |
| `relay/worker.src.js` | Código do Worker (sem o core) |
| `scripts/build-worker.mjs` | Gera `relay/cloudflare-worker.js` |
| `data/config.json` | Relay padrão do site |

## Trocar os traders

A lista pré-jogo vem de `polymarket_traders/` (`analisar_traders.py`, `backtest_copia.py` → `gerar_traders_site.py`, que grava `data/traders.json`). A lista ao vivo vem de `live_analise.py` / `live_ampliar.py` → `gerar_traders_live.py`, que grava `data/traders_live.json`. Depois faça commit e push.

Rodar o retrato localmente: `node scripts/snapshot.mjs` (Node 18 ou mais novo). Com o DNS bloqueado, use `RELAY=https://seu-relay.workers.dev node scripts/snapshot.mjs`.

Isto não é recomendação financeira. Confira as regras de acesso ao Polymarket no seu país.
