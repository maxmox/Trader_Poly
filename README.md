# Trader Poly

Painel e alertas no Telegram para apostas esportivas no Polymarket. Ele acompanha traders de esporte que vale copiar e algumas regras de mercado em teste, e diz, entrada por entrada, se ainda dá para entrar **agora**.

Site: https://maxmox.github.io/Trader_Poly · Página de CS2: [`cs2.html`](https://maxmox.github.io/Trader_Poly/cs2.html)

Tudo está em **odd decimal** (odd = 1 ÷ preço no Polymarket): odd 2,00 paga $20 numa aposta de $10. O card também mostra o preço em centavos, para montar a ordem limitada.

## O que a página mostra

1. **Sinais agora:** um quadro único com:
   - **Ao vivo:** o trader acabou de entrar com o jogo rolando. O card tem uma contagem regressiva: a janela dele (1–2 min) é o tempo em que, no histórico, copiar ainda dava lucro.
   - **Pré-jogo:** posição aberta de um trader, com o jogo ainda por começar e a odd perto da dele.
   - **Futebol: Under** (em observação): Under 0,5 do 1º tempo ou Under 1,5 a 0,25–0,40, comprado 10–30 min antes do jogo. Também Under 0,5 do 1º tempo quando está 0x0 aos 30 min (placar da ESPN).
   - **Basquete: seguir** (em observação): fora da NBA/WNBA, o time que disparou até os 20–30 min de jogo.
2. **Traders:** a ficha de cada um, com:
   - especialidade, estatísticas e placar dos últimos 30 dias;
   - as posições abertas, com o veredito, a nota da entrada e o selo do mercado (no nicho dele / fora do nicho, lucra / perde).
3. **Entradas recentes:** todas as entradas dos traders no nicho deles, boas ou ruins, com filtros.
4. **Placar:** o resultado dos últimos 30 dias, como se cada entrada tivesse virado sinal, e o dos sinais reais enviados ao Telegram. Inclui a tabela "A nota está acertando?".

| Veredito | Quando |
|---|---|
| Copiar | Esporte/nicho em que o trader é bom e a odd ainda está perto da dele: no máximo 2¢ de preço pior (odd 2,00 → mínima 1,92), ou 10% do preço em azarões. Ao vivo: só dentro da janela. Pré-jogo: só antes do início. |
| Esperar | Pré-jogo com a odd um pouco abaixo da mínima: deixe uma ordem limitada na odd mínima. |
| Não copiar | A odd andou demais (para pior, ou mais de 10¢ para melhor, sinal de que o cenário mudou); a janela passou; o jogo começou; não é a especialidade dele; ou é uma aposta simbólica (< $20 ou < 10% da aposta típica dele). |

Todos os custos incluem a taxa de taker do Polymarket: 5% × p × (1 − p) por cota.

## Como os dados chegam

- **Relay (padrão):** muitos provedores no Brasil bloqueiam o DNS do Polymarket. O site busca os dados pelo Cloudflare Worker (`data/config.json`), que repassa a API pública.
- **Direto:** se o navegador alcança o Polymarket (por exemplo, com o DNS seguro ligado), o relay não é necessário.
- **Retrato do servidor:** uma GitHub Action roda a cada ~10 min, gera `data/snapshot.json` (posições abertas) e `data/desempenho.json` (placar) e publica o site. Sem acesso em tempo real, a página mostra esse retrato. O ao vivo não funciona com o retrato.

Com a aba em segundo plano, a página para de consultar e retoma ao voltar.

## Alertas no Telegram

O Worker (`relay/`) roda a cada minuto. Ele manda, uma vez cada:
- entradas ao vivo e de pré-jogo dos traders;
- alerta **SAIR** quando um trader que vende antes do fim vende;
- sinais de Under e de basquete.

Cada sinal fica registrado por 90 dias para o placar.

### Montar o bot e o Worker

1. **Bot:** no Telegram, fale com **@BotFather** → `/newbot`.
   - Ele devolve o **token**.
   - Mande qualquer mensagem ao bot novo e abra `https://api.telegram.org/bot<TOKEN>/getUpdates`. O número em `"chat":{"id": ...}` é o **chat id**.
2. **Worker:** em https://dash.cloudflare.com → **Workers & Pages → Create Worker**. Em **Edit code**, cole o conteúdo de `relay/cloudflare-worker.js` → **Deploy**.
3. **Settings → Variables and Secrets:**
   - `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` (Secret);
   - opcionais: `BANCA` e `PCT` (valor sugerido da aposta), `PLANO=gratis` (plano grátis: 50 consultas por execução), `UNDER=0` / `BKT=0` (desligar uma regra).
4. **KV:** **Storage & Databases → KV → Create**. No Worker, em **Bindings**, ligue o KV com o nome **`ENVIADOS`**.
5. **Settings → Triggers → Cron Triggers:** `* * * * *`.
6. **Testes:**
   - `/teste`: mensagem de teste no Telegram;
   - `/verificar`: roda agora e devolve o resumo (`?pre=NOME` só para um trader);
   - `/status`: últimas execuções;
   - `/registro`: sinais enviados;
   - `/teste-saida`: mostra o alerta SAIR, sem enviar.

O token fica **só** nos Secrets da Cloudflare, nunca no repositório.

**Depois de mudar `js/core.js` ou `relay/worker.src.js`:** rode `node scripts/build-worker.mjs` e cole de novo o `relay/cloudflare-worker.js` no painel.

## Arquivos

| Caminho | Para que serve |
|---|---|
| `index.html`, `cs2.html`, `styles.css` | As páginas |
| `js/core.js` | Núcleo comum ao site, à Action e ao Worker: regras de cópia, veredito, nota da entrada, tamanho da aposta, regras Under e basquete, descrição da aposta. Não toca no DOM. |
| `js/formato.js` | Formatação comum das páginas (`esc`, `usd`, `pct`, `ha`…) |
| `js/app.js` | Página principal: quadro, fichas de pré-jogo, ajustes |
| `js/aovivo.js` | Cards e fichas dos traders ao vivo |
| `js/under.js`, `js/bkt.js` | Cards do futebol Under e do basquete seguir |
| `js/nota.js` | Blocos da nota, do tamanho da aposta, de "como ele sai" e do selo do mercado |
| `js/placar.js`, `js/entradas.js` | Placar e entradas recentes |
| `js/cs2.js` | Página de CS2: odd justa de quem vai para o intervalo perdendo |
| `data/traders.json`, `data/traders_live.json` | Traders de pré-jogo e ao vivo (especialidade, nível, janela, estatísticas) |
| `data/indices.json` | Modelo da nota da entrada e aposta típica de cada trader |
| `data/mercados_trader.json` | Resultado de cada trader por esporte × tipo de mercado × momento (selo e nota fora do nicho) |
| `data/prefixos.json` | Prefixo do mercado → esporte (`nfl` → Futebol Americano…) |
| `data/cs2_intervalo.json`, `data/cs2_times.json` | Dados da página de CS2 |
| `data/snapshot.json`, `data/desempenho.json` | Gerados pela Action (o válido é o do site publicado) |
| `data/config.json` | Relay padrão do site |
| `scripts/snapshot.mjs`, `scripts/desempenho.mjs` | Rodam na Action (`.github/workflows/pages.yml`) |
| `scripts/build-worker.mjs` | Gera `relay/cloudflare-worker.js` |
| `relay/worker.src.js` | Código do Worker (sem o core) |
| `relay/cloudflare-worker.js` | Worker pronto para colar (gerado; não edite) |

As listas de traders e os dados das regras vêm das análises em Python (pasta `polymarket_traders`, fora deste repositório).

Para rodar os scripts localmente com o DNS bloqueado: `RELAY=https://SEU-WORKER.workers.dev node scripts/desempenho.mjs`. Exige Node 18 ou mais novo; o placar leva mais de 10 min.

## Publicar

O GitHub Pages é publicado pela Action (**Settings → Pages → Source: GitHub Actions**). Ela roda a cada push e a cada ~10 min. Se o repositório ficar 60 dias sem commits, o GitHub desliga o agendamento: use **Actions → Run workflow** ou faça um commit.

Isto não é recomendação financeira. Confira as regras de acesso ao Polymarket no seu país.
