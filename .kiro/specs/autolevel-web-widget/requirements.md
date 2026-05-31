# Requirements Document

## Introduction

Este documento especifica os requisitos para um widget web standalone que fornece interface gráfica para a funcionalidade de auto-nivelamento da extensão cncjs-kt-ext. O widget visa oferecer a mesma praticidade da interface nativa de auto-nivelamento do bCNC, permitindo ao operador visualizar o mapa de alturas, configurar parâmetros, iniciar a sondagem e acompanhar o progresso em tempo real — tudo via navegador web. O widget é servido pelo próprio processo da extensão como um servidor HTTP/WebSocket leve, adequado para execução em Raspberry Pi.

## Glossary

- **Widget_Web**: Servidor HTTP e WebSocket embutido no processo da extensão cncjs-kt-ext que serve a interface gráfica ao navegador
- **Interface_Cliente**: Aplicação frontend HTML/CSS/JavaScript servida pelo Widget_Web e executada no navegador do operador
- **Servidor_Widget**: Componente backend (Express + socket.io) que expõe endpoints REST e eventos WebSocket para a Interface_Cliente
- **Mapa_de_Alturas**: Representação visual (2D heatmap ou 3D) dos pontos Z sondados sobre a grade XY da superfície
- **Painel_Configuração**: Seção da Interface_Cliente onde o operador define parâmetros de sondagem (delta, height, feedrate, margin, N probes)
- **Sistema_Autolevel**: Módulo principal de auto-nivelamento existente (autolevel.js) que gerencia sondagem e compensação
- **Módulo_Probing**: Componente do Sistema_Autolevel responsável por executar a grade de sondagem
- **Grade_de_Sondagem**: Matriz de pontos XY onde a sonda mede a altura Z da superfície
- **Delta**: Espaçamento entre pontos da grade de sondagem (em milímetros)
- **Dados_de_Sondagem**: Conjunto de pontos {x, y, z} coletados durante a sondagem, armazenados em arquivo texto
- **Evento_Progresso**: Mensagem WebSocket emitida pelo Servidor_Widget informando o estado atual da sondagem em andamento
- **FluidNC**: Firmware de controle CNC compatível com Grbl, utilizado como controlador alvo

## Requirements

### Requirement 1: Servidor Web Embutido

**User Story:** Como operador CNC, eu quero acessar a interface de auto-nivelamento via navegador web na rede local, para que eu possa controlar a sondagem sem depender de comandos de macro digitados manualmente.

#### Acceptance Criteria

1. WHEN a extensão cncjs-kt-ext é iniciada, THE Servidor_Widget SHALL iniciar um servidor HTTP na porta configurável (padrão: 8190) servindo os arquivos estáticos da Interface_Cliente
2. WHEN a extensão cncjs-kt-ext é iniciada, THE Servidor_Widget SHALL iniciar um servidor WebSocket (socket.io) na mesma porta HTTP para comunicação bidirecional em tempo real com a Interface_Cliente
3. IF a porta configurada já estiver em uso, THEN THE Servidor_Widget SHALL registrar mensagem de erro no console indicando a porta em conflito e continuar a operação da extensão sem o widget web (degradação graciosa)
4. THE Servidor_Widget SHALL consumir menos de 20 MB de memória RAM adicional em estado idle (sem sondagem ativa), adequado para execução em Raspberry Pi
5. WHEN o Servidor_Widget está ativo, THE Sistema_Autolevel SHALL continuar respondendo normalmente a comandos de macro (#autolevel) via console do CNCjs sem interferência do widget

### Requirement 2: Visualização do Mapa de Alturas

**User Story:** Como operador CNC, eu quero visualizar graficamente os pontos sondados como um mapa de alturas, para que eu possa identificar rapidamente regiões com desvio Z significativo na superfície da PCB.

#### Acceptance Criteria

1. WHEN dados de sondagem estão disponíveis (carregados de arquivo ou recém-coletados), THE Interface_Cliente SHALL renderizar um mapa de alturas 2D (heatmap) mostrando todos os pontos sondados com cores representando o valor Z relativo (azul para valores negativos, verde para zero, vermelho para valores positivos)
2. WHEN o mapa de alturas é renderizado, THE Interface_Cliente SHALL exibir uma escala de cores (legenda) indicando a correspondência entre cor e valor Z em milímetros
3. WHEN o operador posiciona o cursor sobre um ponto no mapa de alturas, THE Interface_Cliente SHALL exibir um tooltip com as coordenadas X, Y e Z do ponto com precisão de 3 casas decimais
4. THE Interface_Cliente SHALL renderizar o mapa de alturas utilizando Canvas 2D ou SVG sem dependência de bibliotecas 3D pesadas (WebGL opcional como modo alternativo), garantindo carregamento em menos de 3 segundos em Raspberry Pi 4 com navegador Chromium
5. WHEN novos pontos são sondados durante uma sessão ativa, THE Interface_Cliente SHALL atualizar o mapa de alturas incrementalmente à medida que cada ponto é concluído, sem necessidade de recarregar a página

### Requirement 3: Progresso de Sondagem em Tempo Real

**User Story:** Como operador CNC, eu quero acompanhar em tempo real qual ponto está sendo sondado e o percentual de conclusão, para que eu saiba quanto tempo falta e possa identificar problemas durante o processo.

#### Acceptance Criteria

1. WHEN uma sondagem está em andamento, THE Servidor_Widget SHALL emitir um Evento_Progresso via WebSocket a cada ponto concluído contendo: índice do ponto atual, total de pontos planejados, coordenadas X Y Z do ponto recém-sondado, e timestamp
2. WHEN a Interface_Cliente recebe um Evento_Progresso, THE Interface_Cliente SHALL atualizar uma barra de progresso mostrando percentual concluído (pontos_sondados / total_pontos × 100) e o número do ponto atual
3. WHEN uma sondagem está em andamento, THE Interface_Cliente SHALL destacar visualmente no mapa de alturas (ou na grade) o ponto que está sendo sondado no momento, diferenciando-o dos pontos já concluídos e dos pontos pendentes
4. WHEN uma sondagem é concluída, THE Servidor_Widget SHALL emitir um evento de conclusão via WebSocket contendo as estatísticas finais (min Z, max Z, média Z, número total de pontos) e o status de sucesso ou falha
5. IF a conexão WebSocket entre Interface_Cliente e Servidor_Widget é perdida durante a sondagem, THEN THE Interface_Cliente SHALL exibir indicador visual de desconexão e tentar reconectar automaticamente a cada 3 segundos, restaurando o estado atual ao reconectar

### Requirement 4: Painel de Configuração de Parâmetros

**User Story:** Como operador CNC, eu quero configurar os parâmetros de sondagem (delta, altura, feedrate, margem, número de probes) via interface gráfica, para que eu não precise memorizar a sintaxe do comando de macro.

#### Acceptance Criteria

1. THE Interface_Cliente SHALL exibir um formulário com campos editáveis para os seguintes parâmetros: Delta (mm, padrão: 10), Height (mm, padrão: 2), Feedrate (mm/min, padrão: 50), Margin (mm, padrão: delta/4), e N probes por ponto (1-10, padrão: 1)
2. WHEN o operador altera um valor no Painel_Configuração, THE Interface_Cliente SHALL validar o valor em tempo real: Delta deve ser maior que 0, Height deve ser maior que 0, Feedrate deve ser maior que 0, Margin deve ser maior ou igual a 0, N probes deve ser inteiro entre 1 e 10
3. IF um valor inválido é inserido, THEN THE Interface_Cliente SHALL destacar o campo com borda vermelha e exibir mensagem de erro descritiva ao lado do campo, sem permitir o início da sondagem
4. THE Interface_Cliente SHALL exibir campos opcionais para dimensões manuais da área de sondagem (X size, Y size em mm), que quando preenchidos substituem os limites extraídos do G-code carregado
5. WHEN a Interface_Cliente é carregada, THE Servidor_Widget SHALL enviar os valores atuais dos parâmetros (últimos utilizados ou padrões) para preencher o formulário automaticamente

### Requirement 5: Início de Sondagem via Interface

**User Story:** Como operador CNC, eu quero iniciar a sondagem com um clique, para que o processo seja equivalente a digitar o comando de macro mas sem risco de erro de sintaxe.

#### Acceptance Criteria

1. THE Interface_Cliente SHALL exibir um botão "Iniciar Sondagem" que, quando clicado, envia os parâmetros configurados ao Servidor_Widget para iniciar o processo de auto-nivelamento
2. WHEN o botão "Iniciar Sondagem" é clicado, THE Servidor_Widget SHALL construir o comando equivalente ao macro #autolevel com os parâmetros recebidos (D, H, F, M, N, X, Y) e executá-lo através do Sistema_Autolevel existente
3. WHILE uma sondagem está em andamento, THE Interface_Cliente SHALL desabilitar o botão "Iniciar Sondagem" e exibir um botão "Parar" que permite ao operador abortar a operação
4. WHEN o botão "Parar" é clicado durante uma sondagem, THE Servidor_Widget SHALL enviar comando de parada (feed hold ou reset) ao controlador CNC via CNCjs e abortar a sequência de sondagem
5. IF nenhum G-code está carregado no CNCjs e o modo "Probe Only" não está ativado, THEN THE Interface_Cliente SHALL desabilitar o botão "Iniciar Sondagem" e exibir mensagem informando que é necessário carregar um G-code ou ativar o modo "Probe Only"
6. THE Interface_Cliente SHALL exibir um checkbox "Probe Only" que, quando marcado, permite iniciar a sondagem sem G-code carregado (equivalente ao parâmetro P1 do macro)

### Requirement 6: Estatísticas de Sondagem

**User Story:** Como operador CNC, eu quero ver estatísticas dos dados sondados (desvio mínimo, máximo e médio em Z), para que eu possa avaliar a qualidade da superfície e decidir se a compensação é necessária.

#### Acceptance Criteria

1. WHEN dados de sondagem estão disponíveis, THE Interface_Cliente SHALL exibir um painel de estatísticas contendo: Z mínimo, Z máximo, Z médio, desvio padrão, e número total de pontos sondados, todos com precisão de 3 casas decimais em milímetros
2. WHEN novos pontos são sondados durante uma sessão ativa, THE Interface_Cliente SHALL atualizar as estatísticas incrementalmente após cada ponto concluído
3. THE Interface_Cliente SHALL exibir indicação visual da amplitude total (max - min) com código de cores: verde se amplitude menor que 0.1 mm, amarelo se entre 0.1 mm e 0.3 mm, vermelho se maior que 0.3 mm

### Requirement 7: Gerenciamento de Arquivos de Sondagem

**User Story:** Como operador CNC, eu quero salvar, carregar e visualizar arquivos de dados de sondagem pela interface web, para que eu possa reutilizar medições anteriores ou comparar diferentes sessões.

#### Acceptance Criteria

1. THE Interface_Cliente SHALL exibir um botão "Salvar" que solicita ao Servidor_Widget salvar os dados de sondagem atuais em arquivo com nome especificado pelo operador
2. WHEN o botão "Salvar" é clicado com nome de arquivo válido, THE Servidor_Widget SHALL salvar os dados de sondagem no formato texto (uma linha por ponto: X Y Z separados por espaço) no diretório de trabalho da extensão
3. THE Interface_Cliente SHALL exibir um botão "Carregar" que apresenta lista dos arquivos de sondagem disponíveis no diretório de trabalho (extensão .txt ou .probe)
4. WHEN um arquivo de sondagem é selecionado para carregamento, THE Servidor_Widget SHALL ler o arquivo, validar os dados (mínimo 3 pontos não-colineares com coordenadas finitas), carregar os pontos no Sistema_Autolevel, e notificar a Interface_Cliente com os novos dados para atualização do mapa
5. IF o arquivo selecionado contém dados inválidos, THEN THE Servidor_Widget SHALL rejeitar o carregamento e enviar mensagem de erro à Interface_Cliente descrevendo o problema (número insuficiente de pontos, pontos colineares, ou valores não-numéricos)
6. THE Interface_Cliente SHALL exibir um botão "Re-aplicar" que solicita ao Servidor_Widget aplicar a compensação Z ao G-code carregado usando os dados de sondagem atuais (equivalente ao comando #autolevel_reapply)

### Requirement 8: Visualização da Grade sobre Limites do G-code

**User Story:** Como operador CNC, eu quero ver a grade de sondagem planejada sobreposta aos limites do G-code carregado, para que eu possa verificar se a cobertura da sondagem é adequada antes de iniciar.

#### Acceptance Criteria

1. WHEN um G-code está carregado no CNCjs, THE Servidor_Widget SHALL calcular e enviar à Interface_Cliente os limites do G-code (Xmin, Xmax, Ymin, Ymax) extraídos do contexto da conexão com o CNCjs
2. WHEN os limites do G-code e os parâmetros de sondagem estão disponíveis, THE Interface_Cliente SHALL renderizar uma visualização 2D mostrando: o retângulo dos limites do G-code (contorno), a margem interna aplicada (contorno tracejado), e os pontos da grade de sondagem planejada (marcadores circulares)
3. WHEN o operador altera parâmetros no Painel_Configuração (delta, margin, ou dimensões manuais), THE Interface_Cliente SHALL recalcular e re-renderizar a grade de sondagem planejada em tempo real sem necessidade de comunicação com o servidor
4. THE Interface_Cliente SHALL exibir o número total de pontos da grade planejada e o tempo estimado de sondagem baseado nos parâmetros atuais (feedrate, height, número de probes por ponto)

### Requirement 9: Integração Não-Intrusiva com a Extensão Existente

**User Story:** Como desenvolvedor, eu quero que o widget web seja adicionado à extensão existente sem modificar o fluxo de operação atual via macros, para que usuários que preferem a interface de linha de comando continuem usando-a normalmente.

#### Acceptance Criteria

1. THE Servidor_Widget SHALL ser inicializado como módulo opcional dentro do processo da extensão cncjs-kt-ext, ativado por flag de linha de comando (--web-widget ou -w) com porta configurável (--widget-port)
2. WHERE a flag --web-widget não é especificada na linha de comando, THE Sistema_Autolevel SHALL operar exatamente como na versão atual sem carregar o código do Servidor_Widget
3. WHEN o Servidor_Widget está ativo, THE Sistema_Autolevel SHALL emitir eventos internos (EventEmitter) para cada mudança de estado relevante (início de sondagem, ponto concluído, sondagem finalizada, erro) que o Servidor_Widget escuta e retransmite à Interface_Cliente
4. THE Servidor_Widget SHALL acessar o Sistema_Autolevel através de interface pública bem definida (métodos e propriedades existentes) sem modificar a lógica interna de sondagem ou compensação
5. WHEN uma sondagem é iniciada via Interface_Cliente, THE Servidor_Widget SHALL invocar o mesmo fluxo de execução que o comando de macro #autolevel utiliza, garantindo comportamento idêntico independente da origem do comando

### Requirement 10: Desempenho e Compatibilidade com Raspberry Pi

**User Story:** Como operador CNC usando Raspberry Pi, eu quero que o widget web seja leve e responsivo, para que não impacte o desempenho da sondagem nem sobrecarregue o hardware limitado.

#### Acceptance Criteria

1. THE Interface_Cliente SHALL ter tamanho total de assets (HTML + CSS + JavaScript) inferior a 500 KB sem compressão, utilizando vanilla JavaScript ou bibliotecas mínimas sem frameworks pesados (React, Angular, Vue)
2. THE Interface_Cliente SHALL ser compatível com Chromium versão 90 ou superior sem necessidade de transpilação ou polyfills
3. WHEN o mapa de alturas é renderizado com até 400 pontos (grade 20×20), THE Interface_Cliente SHALL completar a renderização em menos de 1 segundo em Raspberry Pi 4 com Chromium
4. THE Servidor_Widget SHALL utilizar compressão gzip para servir os assets estáticos, reduzindo o tempo de carregamento inicial na rede local
5. WHILE uma sondagem está em andamento, THE Servidor_Widget SHALL limitar a taxa de emissão de eventos WebSocket a no máximo 10 mensagens por segundo para não sobrecarregar a Interface_Cliente ou a rede

