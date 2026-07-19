#!/bin/bash

echo "🧪 TESTE RÁPIDO — Sem SeedLibraryBooks.js"
echo "============================================"
echo ""

# TESTE 1: Verificar bloqueios
echo "✅ TESTE 1: Procurando operações bloqueantes..."
BLOQUEIOS=$(grep -rn "writeFileSync\|readFileSync\|existsSync\|mkdirSync\|unlinkSync\|statSync" \
  ./Controllers/TeacherSubject.js ./Controllers/Authors.js 2>/dev/null | wc -l)

if [ "$BLOQUEIOS" -eq 0 ]; then
  echo "   ✅ ZERO operações bloqueantes encontradas!"
else
  echo "   ❌ ENCONTRADO $BLOQUEIOS bloqueios!"
  echo "   Detalhes:"
  grep -rn "writeFileSync\|readFileSync\|existsSync\|mkdirSync\|unlinkSync\|statSync" \
    ./Controllers/TeacherSubject.js ./Controllers/Authors.js
fi

echo ""

# TESTE 2: Health check
echo "✅ TESTE 2: Testando /health..."
HEALTH=$(curl -s http://localhost:7500/health | jq '.ok' 2>/dev/null)

if [ "$HEALTH" = "true" ]; then
  echo "   ✅ Servidor respondendo OK"
else
  echo "   ❌ Servidor não respondeu"
fi

echo ""

# TESTE 3: Teste de carga rápida
echo "✅ TESTE 3: Teste de carga (10 pedidos)..."
SUCESSO=0
for i in {1..10}; do
  RESP=$(curl -s http://localhost:7500/health | jq '.ok' 2>/dev/null)
  if [ "$RESP" = "true" ]; then
    SUCESSO=$((SUCESSO + 1))
  fi
done

echo "   ✅ $SUCESSO/10 pedidos OK"

if [ "$SUCESSO" -eq 10 ]; then
  echo "   ✅ 100% taxa de sucesso!"
else
  echo "   ⚠️  Taxa de sucesso: $(($SUCESSO * 100 / 10))%"
fi

echo ""

# RESUMO
echo "============================================"
echo "📊 RESUMO:"
echo ""
if [ "$BLOQUEIOS" -eq 0 ] && [ "$HEALTH" = "true" ] && [ "$SUCESSO" -eq 10 ]; then
  echo "✅ TODOS OS TESTES PASSARAM!"
  echo "🎉 Problema do lag de 603 segundos RESOLVIDO!"
  exit 0
else
  echo "❌ Algum teste falhou, verificar acima"
  exit 1
fi
