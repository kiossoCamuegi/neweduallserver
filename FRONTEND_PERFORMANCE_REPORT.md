# Frontend — por que está lento em internet fraca (3 Mbps)

## Medição em produção (leitura)

| Item | Tamanho |
|---|---|
| `main.cc14106b.js` (bundle principal) | **21,65 MB** |
| Mesmo bundle com **gzip** (o que o nginx envia hoje) | **5,53 MB** |
| `main.css` | ver `deploy/` (aplicar Brotli) |

A 3 Mbps (≈0,375 MB/s), só o JS principal leva **~15 segundos** no primeiro
carregamento (5,53 MB ÷ 0,375). Com cache de 7 dias, as visitas seguintes são
rápidas; o problema é a primeira visita, limpeza de cache e novos clientes.

Com **Brotli** o mesmo bundle fica em ~**3,0 MB** (medição local), reduzindo
para ~8 s. Ainda é muito: o corte real vem de **code splitting**.

## O que pesa no bundle (análise do source map local)

> Tamanhos de código-fonte; servem para priorizar, não são o tamanho final.

| Pacote | Tamanho aproximado |
|---|---|
| `react-icons` | **31,72 MB** |
| `(app)` | 5,07 MB |
| `react-ionicons` | 3,30 MB |
| `exceljs` | 1,88 MB |
| `ag-grid-community` | 1,81 MB |
| `fabric` | 1,03 MB |
| `dhtmlx-scheduler` | 0,95 MB |
| `jspdf` | 0,92 MB |
| `react-country-flags-select` | 0,91 MB |
| `xlsx` | 0,85 MB |
| `@mui/material` | 0,84 MB |
| `pdf-lib` | 0,66 MB |
| `@react-pdf/pdfkit` | 0,63 MB |
| `apexcharts` | 0,51 MB |
| `@fullcalendar/core` | 0,50 MB |
| `draft-js` | 0,49 MB |
| `fontkit` | 0,44 MB |
| `quill` | 0,42 MB |
| `@editorjs/editorjs` | 0,37 MB |
| `framer-motion` | 0,37 MB |

## Ações recomendadas (frontend)

1. **`react-icons` — maior vitória isolada**
   - Evitar `import { FaX } from "react-icons"` (arrasta todos os ícones).
   - Usar imports por pack e só os ícones usados:
     `import { FaUser } from "react-icons/fa6";`
   - O mesmo para `react-ionicons`.

2. **Lazy-load por rota / por biblioteca pesada**
   - `React.lazy` + `Suspense` para: biblioteca, RH, relatórios, gráficos,
     agenda, editor de imagens, vídeo, exportações.
   - Carregar `exceljs`/`xlsx` **só** ao exportar/importar.
   - Carregar `ag-grid`, `dhtmlx-scheduler`, `fabric`, `jspdf`, `pdf-lib`,
     `@react-pdf`, `apexcharts`, `fullcalendar`, `draft-js`, `quill`,
     `editorjs`, `vidstack`, `framer-motion` apenas nas páginas que os usam.

3. **Remover duplicados**
   - `xlsx` + `exceljs` (escolher um).
   - `jspdf` + `pdf-lib` + `@react-pdf` (escolher um por caso de uso).
   - `react-icons` + `react-ionicons` (escolher um).

4. **Compressão e cache no servidor do frontend**
   - Aplicar `deploy/nginx-performance.conf` (Brotli + gzip + cache).
   - Ou `deploy/apache-performance.htaccess` se for Apache/cPanel.
   - Gerar `.br`/`.gz` com `scripts/precompress-static.sh static`.
   - Manter `index.html`, `config.json` e `asset-manifest.json` sem cache.

5. **Source maps**
   - Não publicar `*.map` em produção (o local tem 87 MB) ou restringir por IP.
   - Não afeta o utilizador normal, mas reduz disco e exposição de código.

6. **Fontes/imagens**
   - `font-display: swap`, formats `woff2`, imagens `webp/avif`, `loading="lazy"`.
   - Considerar CDN com Brotli/HTTP2 para o frontend.

## APIs (o lado do servidor já está preparado)

Medição em produção com gzip nos endpoints de lista:

| Endpoint | gzip |
|---|---:|
| auditoria | 59 KB |
| matrículas | 40 KB |
| confirmações | 27 KB |
| disciplinas de professores | 14 KB |
| contas de alunos | 13 KB |
| restantes | < 10 KB |

Ou seja, **as APIs não são o maior problema** em 3 Mbps; o bundle JS é.
A lista de alunos foi preparada localmente com `get-lite` (~131 KB gzip para
2.386 alunos) e o dashboard com `class-gender` (~2 KB gzip).

## Impacto esperado

- **Brotli**: 5,53 MB → ~3,0 MB (−45%).
- **Imports de ícones + code splitting**: potencial para o bundle inicial
  descer para **< 1 MB gzip**, desde que as bibliotecas pesadas sejam
  carregadas só nas rotas que as usam.
- Com 1 MB gzip a 3 Mbps: **~3 segundos** em vez de ~15 s.
