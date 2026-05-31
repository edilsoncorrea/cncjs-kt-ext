# Implementation Plan: Widget Web de Auto-Nivelamento

## Overview

Implementação incremental do widget web embutido na extensão cncjs-kt-ext. O servidor Express + socket.io é carregado condicionalmente via flag `--web-widget` e se comunica com o Autolevel existente via EventEmitter. O frontend é vanilla JavaScript com Canvas 2D, otimizado para Raspberry Pi 4.

## Tasks

- [ ] 1. Adicionar EventEmitter ao Autolevel (fundação para comunicação com o widget)
  - [ ] 1.1 Adicionar mixin EventEmitter ao autolevel.js
    - Importar `EventEmitter` do módulo `events`
    - Criar instância `this.events = new EventEmitter()` no constructor
    - Emitir `probe:start` no início de `start()` com `{ totalPoints, params }`
    - Emitir `probe:point` após cada `probedPoints.push()` com `{ index, total, x, y, z }`
    - Emitir `probe:complete` ao finalizar sondagem com `{ minZ, maxZ, avgZ, count, success }`
    - Emitir `probe:error` em caso de falha de probe com `{ message, pointIndex }`
    - Emitir `gcode:changed` nos handlers de `gcode:load` e `gcode:unload`
    - _Requisitos: 9.3, 9.4_

  - [ ]* 1.2 Escrever testes unitários para emissão de eventos do Autolevel
    - Verificar que `probe:point` é emitido com payload correto após cada ponto
    - Verificar que `probe:complete` é emitido ao finalizar
    - Verificar que `gcode:changed` é emitido ao carregar/descarregar G-code
    - _Requisitos: 9.3_

- [ ] 2. Criar WidgetServer (servidor Express + socket.io)
  - [ ] 2.1 Criar arquivo `widget-server.js` com classe WidgetServer
    - Inicializar Express app com compressão gzip (`compression` middleware)
    - Servir arquivos estáticos do diretório `public/`
    - Inicializar socket.io server na mesma porta HTTP
    - Implementar `start()` e `stop()` para lifecycle do servidor
    - Implementar `_bindAutolevelEvents()` para escutar eventos do Autolevel
    - Implementar `_broadcastToClients()` para retransmitir eventos aos clientes
    - Emitir `initial-state` ao conectar novo cliente WebSocket
    - Tratar eventos do cliente: `start-probe`, `stop-probe`, `reapply`, `get-state`
    - _Requisitos: 1.1, 1.2, 1.5, 3.1, 3.4, 10.4_

  - [ ] 2.2 Implementar RateLimiter para eventos WebSocket
    - Criar classe `RateLimiter` com limite de 10 msgs/segundo
    - Integrar no `_broadcastToClients()` para limitar `probe-progress`
    - Garantir que último valor é sempre enviado (sem dados obsoletos)
    - _Requisitos: 10.5_

  - [ ]* 2.3 Escrever teste de propriedade para Rate Limiting
    - **Propriedade 10: Rate Limiting Enforcement**
    - **Valida: Requisito 10.5**

  - [ ]* 2.4 Escrever testes unitários para WidgetServer
    - Testar lifecycle start/stop
    - Testar emissão de `initial-state` ao conectar
    - Testar retransmissão de eventos do Autolevel para clientes
    - Testar degradação graciosa quando porta está em uso
    - _Requisitos: 1.1, 1.2, 1.3_

- [ ] 3. Adicionar flag --web-widget ao CLI e carregamento condicional
  - [ ] 3.1 Modificar `index.js` para suportar flag `--web-widget`
    - Adicionar opções `--web-widget` (ou `-w`) e `--widget-port <port>` ao Commander
    - Carregar `widget-server.js` condicionalmente apenas quando flag está presente
    - Instanciar WidgetServer passando a instância do Autolevel
    - Chamar `widgetServer.start()` após conexão serial estabelecida
    - Garantir que sem a flag, nenhum código do widget é carregado
    - _Requisitos: 9.1, 9.2_

  - [ ]* 3.2 Escrever testes unitários para carregamento condicional
    - Verificar que sem `--web-widget` o módulo widget-server não é importado
    - Verificar que com `--web-widget` o servidor inicia na porta correta
    - _Requisitos: 9.1, 9.2_

- [ ] 4. Checkpoint - Verificar fundação backend
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 5. Criar API REST para gerenciamento de arquivos
  - [ ] 5.1 Criar arquivo `widget-api.js` com endpoints REST
    - Implementar `GET /api/probes` — listar arquivos de sondagem disponíveis
    - Implementar `GET /api/probes/:filename` — ler dados de arquivo específico com validação
    - Implementar `POST /api/probes/:filename` — salvar dados de sondagem atuais
    - Implementar `DELETE /api/probes/:filename` — remover arquivo de sondagem
    - Implementar `GET /api/state` — retornar estado atual (params, probing status, gcode info)
    - Validar formato do arquivo ao carregar (mínimo 3 pontos, não-colineares, coordenadas finitas)
    - Registrar router no Express app do WidgetServer
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 5.2 Escrever teste de propriedade para serialização de dados de sondagem
    - **Propriedade 8: Probe Data Serialization Round-Trip**
    - **Valida: Requisitos 7.2, 7.4**

  - [ ]* 5.3 Escrever testes unitários para widget-api
    - Testar listagem de arquivos
    - Testar save/load/delete de arquivos
    - Testar rejeição de arquivo inválido (poucos pontos, colineares, NaN)
    - Testar resposta de erro HTTP 422 para dados inválidos
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 6. Criar estrutura HTML e CSS do frontend
  - [ ] 6.1 Criar `public/index.html` com layout da interface
    - Estrutura single-page com seções: heatmap, painel de configuração, controles, estatísticas, gerenciamento de arquivos
    - Incluir indicador de conexão WebSocket
    - Incluir barra de progresso de sondagem
    - Incluir área de canvas para mapa de alturas
    - Incluir formulário de parâmetros com campos: delta, height, feed, margin, nProbes, xSize, ySize
    - Incluir botões: Iniciar Sondagem, Parar, Salvar, Carregar, Re-aplicar
    - Incluir checkbox "Probe Only"
    - _Requisitos: 4.1, 4.4, 5.1, 5.3, 5.5, 5.6, 6.1, 7.1, 7.3, 7.6_

  - [ ] 6.2 Criar `public/css/widget.css` com estilos responsivos
    - Layout grid/flexbox para organização dos painéis
    - Estilos para estados de validação (borda vermelha para erro)
    - Estilos para indicador de conexão (verde/vermelho)
    - Estilos para barra de progresso
    - Estilos para código de cores de amplitude (verde/amarelo/vermelho)
    - Manter tamanho total < 15 KB
    - _Requisitos: 4.3, 3.2, 3.5, 6.3, 10.1_

- [ ] 7. Implementar renderizador de heatmap (Canvas 2D)
  - [ ] 7.1 Criar `public/js/heatmap.js` com classe HeatmapRenderer
    - Implementar `render(points)` para renderizar todos os pontos
    - Implementar `addPoint(point)` para atualização incremental
    - Implementar `zToColor(z, minZ, maxZ)` com gradiente azul → verde → vermelho
    - Implementar `hitTest(canvasX, canvasY)` para tooltip no hover
    - Renderizar escala de cores (legenda) ao lado do canvas
    - Destacar ponto atual durante sondagem ativa
    - Renderizar grade planejada sobreposta aos limites do G-code
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 3.3, 8.1, 8.2_

  - [ ]* 7.2 Escrever teste de propriedade para mapeamento de cores
    - **Propriedade 1: Color Mapping Monotonicity**
    - **Valida: Requisito 2.1**

  - [ ]* 7.3 Escrever teste de propriedade para formatação de tooltip
    - **Propriedade 2: Tooltip Formatting Precision**
    - **Valida: Requisito 2.3**

- [ ] 8. Implementar calculador de grade (client-side)
  - [ ] 8.1 Criar `public/js/grid-calculator.js` com funções de cálculo
    - Implementar `calculateGrid(params)` replicando lógica do `autolevel.start()`
    - Implementar `estimateTime(pointCount, height, feed, probesPerPoint, avgSpacing)`
    - Calcular pontos dentro dos limites ajustados por margem
    - Retornar contagem de pontos e tempo estimado
    - _Requisitos: 8.2, 8.3, 8.4_

  - [ ]* 8.2 Escrever teste de propriedade para cálculo de grade
    - **Propriedade 9: Grid Calculation Correctness**
    - **Valida: Requisitos 8.2, 8.3, 8.4**

- [ ] 9. Implementar validação de parâmetros e painel de configuração
  - [ ] 9.1 Criar `public/js/validation.js` com função validateParam
    - Validar delta > 0, height > 0, feed > 0, margin ≥ 0
    - Validar nProbes como inteiro entre 1 e 10
    - Rejeitar NaN, Infinity, valores negativos onde proibido
    - Retornar `{ valid, error }` com mensagem descritiva
    - _Requisitos: 4.2, 4.3_

  - [ ]* 9.2 Escrever teste de propriedade para validação de parâmetros
    - **Propriedade 6: Parameter Validation Correctness**
    - **Valida: Requisitos 4.2, 4.3**

- [ ] 10. Checkpoint - Verificar módulos frontend isolados
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 11. Implementar cliente WebSocket e progresso em tempo real
  - [ ] 11.1 Criar `public/js/socket-client.js` com wrapper WebSocket
    - Conectar ao socket.io server do WidgetServer
    - Implementar reconexão automática a cada 3 segundos
    - Exibir indicador visual de desconexão/reconexão
    - Solicitar `get-state` ao reconectar para restaurar UI
    - Tratar eventos: `initial-state`, `probe-progress`, `probe-complete`, `probe-error`, `gcode-changed`, `state-changed`
    - _Requisitos: 3.1, 3.2, 3.4, 3.5, 4.5_

  - [ ]* 11.2 Escrever teste de propriedade para payload de evento de progresso
    - **Propriedade 3: Progress Event Payload Completeness**
    - **Valida: Requisitos 3.1, 3.4**

- [ ] 12. Implementar controles de iniciar/parar sondagem
  - [ ] 12.1 Criar `public/js/app.js` com lógica principal do frontend
    - Implementar handler do botão "Iniciar Sondagem" — enviar `start-probe` com parâmetros
    - Implementar handler do botão "Parar" — enviar `stop-probe`
    - Desabilitar "Iniciar" durante sondagem ativa, mostrar "Parar"
    - Desabilitar "Iniciar" se nenhum G-code carregado e "Probe Only" desmarcado
    - Implementar checkbox "Probe Only" para permitir sondagem sem G-code
    - Preencher formulário com valores recebidos via `initial-state`
    - Recalcular grade ao alterar parâmetros (chamar grid-calculator)
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.3_

  - [ ]* 12.2 Escrever teste de propriedade para construção de comando
    - **Propriedade 7: Command Construction Fidelity**
    - **Valida: Requisitos 5.2, 9.5**

- [ ] 13. Implementar exibição de estatísticas
  - [ ] 13.1 Criar `public/js/stats.js` com classe ProbeStats
    - Implementar `addPoint(z)` para cálculo incremental (min, max, avg, stddev, count)
    - Implementar `fromArray(zValues)` para recálculo completo
    - Implementar `getStats()` retornando estatísticas com 3 casas decimais
    - Implementar `amplitudeColor(amplitude)` — verde < 0.1, amarelo 0.1-0.3, vermelho > 0.3
    - Integrar com eventos de progresso para atualização em tempo real
    - _Requisitos: 6.1, 6.2, 6.3_

  - [ ]* 13.2 Escrever teste de propriedade para estatísticas incrementais
    - **Propriedade 4: Incremental Statistics Correctness**
    - **Valida: Requisitos 6.1, 6.2, 3.4**

  - [ ]* 13.3 Escrever teste de propriedade para classificação de amplitude
    - **Propriedade 5: Amplitude Color Classification**
    - **Valida: Requisitos 6.3**

- [ ] 14. Implementar gerenciamento de arquivos na UI
  - [ ] 14.1 Implementar interface de gerenciamento de arquivos no app.js
    - Implementar botão "Salvar" — solicitar nome e chamar `POST /api/probes/:filename`
    - Implementar botão "Carregar" — listar via `GET /api/probes`, selecionar e carregar
    - Implementar botão "Re-aplicar" — enviar evento `reapply` via WebSocket
    - Exibir lista de arquivos disponíveis com opção de deletar
    - Tratar erros de API (exibir toast/notificação com mensagem)
    - Atualizar heatmap e estatísticas após carregar arquivo
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 15. Checkpoint - Verificar integração frontend completa
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 16. Testes de integração
  - [ ]* 16.1 Escrever testes de integração para lifecycle do widget
    - Testar start/stop do WidgetServer
    - Testar comunicação completa: cliente → widget → autolevel → widget → cliente
    - Testar coexistência com macro #autolevel via console
    - Testar degradação graciosa (porta em uso)
    - _Requisitos: 1.3, 1.5, 9.1, 9.5_

- [ ] 17. Checkpoint final - Verificar sistema completo
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de corretude definidas no design
- Testes unitários validam exemplos específicos e edge cases
- O frontend usa vanilla JavaScript sem frameworks (requisito de performance para RPi4)
- Dependências adicionais necessárias: `express`, `compression`, `socket.io` (server)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1", "8.1", "9.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.2", "9.2"] },
    { "id": 7, "tasks": ["11.1", "13.1"] },
    { "id": 8, "tasks": ["11.2", "12.1", "13.2", "13.3"] },
    { "id": 9, "tasks": ["12.2", "14.1"] },
    { "id": 10, "tasks": ["16.1"] }
  ]
}
```
