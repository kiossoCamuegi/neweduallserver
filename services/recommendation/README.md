# Recomendações com Gorse

Esta integração usa **Gorse v0.5.11** com MySQL e Redis próprios. A base da aplicação
não é partilhada com a base `gorse`.

## Arranque

1. Instale Go e execute `../../scripts/install-gorse.sh`.
2. Copie os valores de `.env.gorse.example` para `server/.env`.
3. Inicie os serviços systemd do Gorse:

```bash
cd server
sudo systemctl daemon-reload
sudo systemctl enable --now eduall-gorse-master eduall-gorse-worker eduall-gorse-server
```

Dashboard do Gorse: `http://localhost:8088`  
API REST: `http://localhost:8087`

Para parar:

```bash
sudo systemctl stop eduall-gorse-server eduall-gorse-worker eduall-gorse-master
```

## Variáveis e ranking

- `GORSE_ENABLED`: ativa ou desativa a integração.
- `GORSE_SERVER_URL`: URL REST do Gorse.
- `GORSE_API_KEY`: chave enviada em `X-API-Key`.
- `GORSE_TIMEOUT_MS`: timeout de cada pedido.
- `GORSE_RETRY_BASE_MS` / `GORSE_RETRY_MAX_ATTEMPTS`: retry da fila assíncrona.
- `GORSE_BACKFILL_BATCH_SIZE`: tamanho dos lotes do backfill.
- `GORSE_MYSQL_*`, `GORSE_REDIS_*` e `GORSE_*_PORT`: infraestrutura local.
- `RECS_EXPLORATION_RATIO`: fração reservada a posts novos ou com pouca exposição (por defeito `0.15`).
- `RECS_*_WEIGHT_*`: pesos das fontes Gorse, popular, recente, follows, grupo, departamento, item-to-item, interesses e frescura.
- `RECS_MAX_SAME_AUTHOR_RUN`: máximo de posts consecutivos do mesmo autor (por defeito `2`).
- `RECS_AB_TEST_ENABLED` e `RECS_AB_TEST_SPLIT`: experiência determinística por utilizador.
- `REDIS_URL` ou `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`: memória dos sinais positivos recentes para item-to-item.

Consultar [`../../.env.example`](../../.env.example) para a lista completa.

## Sinais enviados

O Gorse recebe feedback positivo (`like`, comentário, partilha, guardar, dwell
time, conclusão de vídeo, replay, abrir comentários e visitar perfil), leitura e
sinais negativos (`hide`, denúncia, não tenho interesse, silenciar autor e scroll
rápido). O feed combina candidatos de várias fontes e faz o ranking final no
Node, com exploração, diversidade e fallback local.

## Backfill

O script é idempotente e pode ser repetido:

```bash
cd server
npm run gorse:backfill -- --dry-run
npm run gorse:backfill -- --batch-size=100
```

## Verificação

```bash
curl -H "X-API-Key: $GORSE_API_KEY" \
  http://localhost:8087/api/health/ready
```

Endpoints da aplicação:

- `GET /api/recommendations/feed?page=1&limit=10`
- `GET /api/recommendations/people?limit=10`
- `GET /api/recommendations/preferences`
- `PUT /api/recommendations/preferences` (`{ "interests": ["Tecnologia"] }`)
- `POST /api/recommendations/feedback/read/:postId`
- `POST /api/recommendations/feedback/video_completion/:postId` (`value` entre 0 e 1)
- `POST /api/recommendations/feedback/dwell_time/:postId` (`value` em segundos)
- `POST /api/recommendations/feedback/not_interested/:postId`
- `POST /api/recommendations/feedback/mute_author/:postId` (`authorId`)
- `POST /api/recommendations/analytics/session` (`durationSeconds`, `interactions`)
- `POST /api/recommendations/people/:userId/follow`

Todos exigem sessão autenticada. Se o Gorse estiver indisponível, o feed usa
automaticamente os posts locais mais populares.
