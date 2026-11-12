#!/usr/bin/env bash
# Gera versões .br e .gz dos assets estáticos do frontend.
# Usar no servidor, dentro da pasta que serve o frontend:
#   ./scripts/precompress-static.sh static
#
# Com nginx:
#   brotli_static on; gzip_static on;
# Com Apache + mod_brotli/mod_deflate, os .br/.gz também podem ser servidos
# (consoante a configuração do módulo).
set -euo pipefail

ROOT="${1:-static}"

if [ ! -d "$ROOT" ]; then
  echo "Pasta não encontrada: $ROOT" >&2
  exit 1
fi

have_brotli=0
command -v brotli >/dev/null 2>&1 && have_brotli=1
have_gzip=0
command -v gzip >/dev/null 2>&1 && have_gzip=1

if [ "$have_brotli" -eq 0 ] && [ "$have_gzip" -eq 0 ]; then
  echo "Nem brotli nem gzip disponíveis." >&2
  exit 1
fi

count=0
while IFS= read -r -d '' f; do
  case "$f" in
    *.br|*.gz) continue ;;
  esac
  if [ "$have_brotli" -eq 1 ]; then
    brotli -q 11 -f -k "$f"
  fi
  if [ "$have_gzip" -eq 1 ]; then
    gzip -9 -f -k "$f"
  fi
  count=$((count + 1))
done < <(find "$ROOT" -type f \
  \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' -o -name '*.html' \) -print0)

echo "Pré-comprimidos $count ficheiro(s) em $ROOT."
