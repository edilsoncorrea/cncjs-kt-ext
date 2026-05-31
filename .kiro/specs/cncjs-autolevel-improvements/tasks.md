# Implementation Plan: Melhorias cncjs-autolevel

## Overview

Implementação incremental das melhorias na extensão cncjs-kt-ext. A ordem prioriza fundação (dependências), correções críticas (divisão por zero, colisão), novos componentes (arcos, multi-probe), refatoração (streaming), e melhorias transversais (erros, persistência). Testes baseados em propriedades com fast-check e Vitest acompanham cada componente.

## Tasks

- [ ] 1. Modernizar dependências e configurar infraestrutura de testes
  - [ ] 1.1 Atualizar package.json com dependências modernas
    - Atualizar `socket.io-client` de v2 para v4.x
    - Atualizar `commander` de v2 para v12.x
    - Adicionar `vitest` e `fast-check` como devDependencies
    - Remover dependências de eslint obsoletas e atualizar para eslint moderno
    - Configurar script `test` no package.json para usar `vitest --run`
    - Criar `vitest.config.js` com configuração básica
    - _Requisitos: 4.1, 4.2, 4.3_

  - [ ] 1.2 Refatorar index.js para socket.io v4 e commander v12
    - Substituir `require('socket.io-client')` por `const { io } = require('socket.io-client')`
    - Substituir `io.connect(url, { query: 'token=' + token })` por `io(url, { query: { token } })`
    - Substituir `socket.destroy()` por `socket.disconnect()`
    - Adicionar opções de reconexão: `reconnection: true, reconnectionAttempts: 3, reconnectionDelay: 5000, timeout: 10000`
    - Substituir `program.port` por `program.opts().port` (e demais opções)
    - Usar `new Command()` em vez do singleton global do commander
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.3 Escrever testes unitários para conexão e parsing de CLI
    - Testar que token é enviado como query parameter (objeto, não string)
    - Testar parsing correto de todos os argumentos CLI com commander v12
    - Testar timeout de conexão (encerramento após 10s)
    - Testar 3 tentativas de reconexão com intervalo de 5s
    - _Requisitos: 4.4, 4.5, 7.1, 7.2_

- [ ] 2. Corrigir divisão por zero no cálculo da grade de sondagem
  - [ ] 2.1 Implementar guard contra divisão por zero em `start()`
    - Adicionar verificação: se `(xmax - xmin) <= delta`, usar `dx = xmax - xmin` e um único ponto em `(xmin + xmax) / 2`
    - Adicionar verificação: se `(ymax - ymin) <= delta`, usar `dy = ymax - ymin` e um único ponto em `(ymin + ymax) / 2`
    - Adicionar validação: se `dx` ou `dy` resulta em NaN/Infinity, rejeitar operação com mensagem de erro indicando o eixo
    - Garantir que todas as coordenadas geradas são números finitos válidos
    - _Requisitos: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 Escrever teste de propriedade para cálculo da grade
    - **Propriedade 1: Cálculo da grade produz coordenadas finitas válidas**
    - **Valida: Requisitos 1.1, 1.2, 1.4**

- [ ] 3. Implementar proteção contra colisão na sondagem
  - [ ] 3.1 Adicionar validação de posição Z em `start()`
    - Comparar `context.posz` com `this.height` antes de emitir comandos
    - Se `context.posz < this.height`: cancelar operação, enviar mensagem com Z atual e mínimo necessário
    - Se contexto indefinido ou sem dados de posição: abortar com mensagem indicando impossibilidade de verificar Z
    - Quando posição válida: garantir que primeiro comando de movimento é `G0 Z{height}` antes de qualquer XY
    - _Requisitos: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.2 Escrever teste de propriedade para proteção contra colisão
    - **Propriedade 2: Proteção contra colisão impede movimento quando Z é inseguro**
    - **Valida: Requisitos 2.2, 2.3**

- [ ] 4. Checkpoint - Verificar testes e funcionalidade base
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 5. Implementar linearização de arcos G2/G3
  - [ ] 5.1 Criar classe ArcLinearizer
    - Implementar `calculateCenterIJ(start, i, j)` — centro = start + offset
    - Implementar `calculateCenterR(start, end, r, clockwise)` — cálculo geométrico dos dois centros possíveis
    - Implementar `validateArc(center, start, end)` — verificar |dist(center,start) - dist(center,end)| < 0.001mm
    - Implementar `generatePoints(center, radius, startAngle, endAngle, clockwise, startZ, endZ)` — pontos com espaçamento ≤ delta/2
    - Implementar `linearize(startPoint, endPoint, params, clockwise)` — orquestração completa
    - Tratar arcos completos (ponto final == ponto inicial) como 360°
    - _Requisitos: 3.1, 3.3, 3.4, 3.6_

  - [ ]* 5.2 Escrever teste de propriedade para linearização de arco
    - **Propriedade 3: Linearização de arco produz segmentos válidos**
    - **Valida: Requisitos 3.1, 3.3, 3.6**

  - [ ]* 5.3 Escrever teste de propriedade para cálculo do centro do arco
    - **Propriedade 4: Cálculo do centro do arco é geometricamente consistente**
    - **Valida: Requisitos 3.4**

  - [ ]* 5.4 Escrever teste de propriedade para arcos inválidos (pass-through)
    - **Propriedade 5: Arcos com parâmetros inconsistentes são preservados sem modificação**
    - **Valida: Requisitos 3.5**

- [ ] 6. Implementar máquina de estados multi-probe
  - [ ] 6.1 Criar classe ProbeStateMachine
    - Implementar construtor com `probesPerPoint` (1-10) e `totalPoints`
    - Implementar `addMeasurement(x, y, z)` — registra medição, retorna status
    - Implementar `calculateAverage(measurements)` — média com rejeição de outliers (2σ para N≥4)
    - Implementar fallback: se todas medições descartadas, usar mediana
    - Implementar `getRepeatProbeCommands(height, feed)` — gera G-code para re-probe
    - Implementar `reset()` para nova sessão
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.2 Integrar ProbeStateMachine no handler de eventos PRB
    - Modificar handler `serialport:read` para usar ProbeStateMachine
    - Quando N > 1: emitir comandos de elevação Z + re-probe entre medições
    - Parsear parâmetro `N` do comando `#autolevel`
    - Manter comportamento padrão (N=1) quando parâmetro não especificado
    - _Requisitos: 5.1, 5.2, 5.5_

  - [ ]* 6.3 Escrever teste de propriedade para média multi-probe
    - **Propriedade 7: Média multi-probe com rejeição de outliers**
    - **Valida: Requisitos 5.1, 5.3**

  - [ ]* 6.4 Escrever teste de propriedade para elevação Z entre medições
    - **Propriedade 8: Elevação Z entre medições do mesmo ponto**
    - **Valida: Requisitos 5.5**

- [ ] 7. Checkpoint - Verificar novos componentes
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 8. Implementar compensação G-code com streaming e suporte a arcos
  - [ ] 8.1 Criar classe GCodeCompensator com processamento streaming
    - Implementar `process(gcodeString, progressCallback)` — iteração por índice sem split
    - Implementar `processLine(line)` — processa uma linha individual
    - Implementar `countLines(str)` — conta linhas sem criar array
    - Reportar progresso a cada 5000 linhas via callback
    - Manter estado de parsing (abs/rel, units, posição atual) entre linhas
    - _Requisitos: 6.1, 6.2, 6.4_

  - [ ] 8.2 Integrar ArcLinearizer no GCodeCompensator
    - Implementar `processArc(lineStripped, currentPos, units, abs)` — detecta G2/G3 e lineariza
    - Aplicar compensação Z a cada ponto de segmento linearizado
    - Preservar feedrate original nos segmentos G1 gerados
    - Para arcos inválidos: copiar linha original sem modificação (pass-through)
    - _Requisitos: 3.1, 3.2, 3.5_

  - [ ] 8.3 Refatorar `applyCompensation()` para usar GCodeCompensator
    - Substituir implementação atual por chamada ao GCodeCompensator
    - Manter interface pública inalterada (método `applyCompensation()`)
    - Integrar com `sckw.sendGcode` para mensagens de progresso
    - Manter escrita de arquivo de saída quando `outDir` configurado
    - _Requisitos: 6.1, 6.3_

  - [ ]* 8.4 Escrever teste de propriedade para compensação Z em arcos
    - **Propriedade 6: Compensação Z é aplicada a cada ponto de arco linearizado**
    - **Valida: Requisitos 3.2**

  - [ ]* 8.5 Escrever teste de propriedade para equivalência streaming
    - **Propriedade 9: Equivalência de saída entre streaming e processamento em memória**
    - **Valida: Requisitos 6.3**

  - [ ]* 8.6 Escrever teste de propriedade para pass-through de erros de parsing
    - **Propriedade 12: Linhas G-code com erro de parsing são preservadas**
    - **Valida: Requisitos 7.5**

- [ ] 9. Melhorar tratamento de erros e feedback ao usuário
  - [ ] 9.1 Implementar resumo de sondagem no início da operação
    - Calcular e exibir: número total de pontos, Xmin/Xmax/Ymin/Ymax, delta, feedrate, tempo estimado
    - Tempo estimado = número_de_pontos × (curso_Z / feedrate + tempo_de_deslocamento)
    - Enviar resumo via `sckw.sendGcode()` como comentário G-code
    - _Requisitos: 7.4_

  - [ ] 9.2 Implementar tratamento de falha de probe e reconexão
    - Detectar probe failure (G38.2 sem contato) via resposta PRB com flag 0
    - Em caso de falha: retrair Z, abortar sequência, enviar mensagem com ponto e coordenadas
    - Implementar lógica de reconexão (3 tentativas, 5s intervalo) no handler de erro do socket
    - Se reconexão falha: salvar dados parciais, enviar stop, encerrar
    - _Requisitos: 7.1, 7.2, 7.3_

  - [ ]* 9.3 Escrever teste de propriedade para resumo de sondagem
    - **Propriedade 13: Resumo de sondagem contém todas as informações requeridas**
    - **Valida: Requisitos 7.4**

- [ ] 10. Melhorar persistência e validação de dados de sondagem
  - [ ] 10.1 Implementar validação de integridade dos dados carregados
    - Verificar que cada linha contém pelo menos 3 valores numéricos finitos
    - Verificar que o conjunto contém no mínimo 3 pontos não-colineares
    - Se validação falha: descartar todos os pontos, registrar erro no console
    - Substituir `fs.readFile` assíncrono por leitura síncrona no construtor com try/catch robusto
    - _Requisitos: 8.2, 8.3, 8.4, 8.5_

  - [ ] 10.2 Melhorar salvamento de dados de sondagem
    - Garantir precisão de pelo menos 3 casas decimais na escrita
    - Garantir round-trip: salvar e carregar produz diferença ≤ 0.001mm
    - Tratar erros de I/O na escrita com mensagem ao console
    - _Requisitos: 8.1, 8.6_

  - [ ]* 10.3 Escrever teste de propriedade para round-trip de dados
    - **Propriedade 10: Round-trip de dados de sondagem (salvar/carregar)**
    - **Valida: Requisitos 8.6, 8.1**

  - [ ]* 10.4 Escrever teste de propriedade para validação de integridade
    - **Propriedade 11: Validação de integridade dos dados de sondagem**
    - **Valida: Requisitos 8.4, 8.5**

- [ ] 11. Checkpoint final - Verificar integração completa
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de correção
- Testes unitários validam exemplos específicos e casos de borda
- Linguagem de implementação: JavaScript (Node.js) com Vitest + fast-check para testes
- A estrutura de arquivos de teste segue o padrão definido no design: `test/properties/` e `test/unit/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "6.2"] },
    { "id": 5, "tasks": ["6.3", "6.4", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1", "10.1"] },
    { "id": 7, "tasks": ["8.3", "9.2", "10.2"] },
    { "id": 8, "tasks": ["8.4", "8.5", "8.6", "9.3", "10.3", "10.4"] }
  ]
}
```
