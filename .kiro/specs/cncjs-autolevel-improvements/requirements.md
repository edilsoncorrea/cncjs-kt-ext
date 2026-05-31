# Requirements Document

## Introduction

Este documento especifica os requisitos para melhorias na extensão cncjs-kt-ext de auto-nivelamento para CNCjs. O objetivo é tornar a extensão robusta, moderna e com funcionalidade equivalente ao auto-nivelamento nativo do bCNC, focando em compatibilidade com FluidNC (Grbl-compatível). As melhorias abrangem correção de bugs críticos, suporte a comandos G-code adicionais, modernização de dependências, e otimizações de desempenho e usabilidade.

## Glossary

- **Sistema_Autolevel**: Módulo principal de auto-nivelamento que gerencia a sondagem da superfície e compensação de coordenadas Z no G-code
- **Módulo_Probing**: Componente responsável por executar a grade de sondagem e coletar pontos de altura da superfície
- **Módulo_Compensação**: Componente que aplica a interpolação de altura aos comandos G-code carregados
- **Parser_GCode**: Componente que interpreta e processa linhas de G-code, incluindo movimentos lineares e arcos
- **Módulo_Conexão**: Componente que gerencia a conexão WebSocket com o CNCjs
- **FluidNC**: Firmware de controle CNC compatível com Grbl, utilizado como controlador alvo
- **Grade_de_Sondagem**: Matriz de pontos XY onde a sonda mede a altura Z da superfície da PCB
- **Delta**: Espaçamento entre pontos da grade de sondagem (em milímetros)
- **WCO**: Work Coordinate Offset — diferença entre coordenadas de máquina e coordenadas de trabalho
- **Compensação_Z**: Ajuste aplicado à coordenada Z de cada ponto do G-code com base na interpolação dos pontos sondados

## Requirements

### Requirement 1: Correção da Divisão por Zero na Grade de Sondagem

**User Story:** Como operador CNC, eu quero que a extensão calcule a grade de sondagem corretamente mesmo quando a área de probe é menor que o delta configurado, para que não sejam geradas coordenadas NaN que corrompem o G-code.

#### Acceptance Criteria

1. WHEN a área de sondagem em X é menor ou igual ao delta configurado, THE Módulo_Probing SHALL utilizar um único ponto de sondagem no ponto médio do intervalo daquele eixo (xmin + xmax) / 2, em vez de calcular a divisão que resultaria em zero no denominador
2. WHEN a área de sondagem em Y é menor ou igual ao delta configurado, THE Módulo_Probing SHALL utilizar um único ponto de sondagem no ponto médio do intervalo daquele eixo (ymin + ymax) / 2, em vez de calcular a divisão que resultaria em zero no denominador
3. IF o cálculo de dx ou dy resulta em valor não-finito (NaN ou Infinity), THEN THE Módulo_Probing SHALL rejeitar a operação sem enviar nenhum comando G-code ao controlador e SHALL enviar mensagem de erro ao console do CNCjs indicando qual eixo (X ou Y) possui o valor inválido
4. THE Módulo_Probing SHALL gerar coordenadas de sondagem que são números finitos válidos para todas as combinações onde a área de sondagem em cada eixo é maior que zero e o delta configurado é maior que zero

### Requirement 2: Proteção contra Colisão na Sondagem

**User Story:** Como operador CNC, eu quero que a extensão valide a posição Z antes de iniciar a sondagem, para que a ferramenta não colida com a peça caso esteja em posição insegura.

#### Acceptance Criteria

1. WHEN o comando de auto-nivelamento é recebido, THE Módulo_Probing SHALL comparar a posição Z atual em coordenadas de trabalho (work coordinates) com a altura de deslocamento (travel height) configurada pelo parâmetro H do comando (valor padrão: 2 mm)
2. IF a posição Z atual em coordenadas de trabalho é menor que a altura de deslocamento configurada, THEN THE Módulo_Probing SHALL cancelar a operação sem emitir nenhum comando de movimento (G-code) e enviar uma mensagem ao console do CNCjs indicando a posição Z atual e a altura mínima necessária
3. WHEN a sondagem é iniciada com posição Z válida, THE Módulo_Probing SHALL comandar um movimento G0 no eixo Z até a altura de deslocamento antes de emitir qualquer comando de movimento nos eixos X ou Y
4. IF a posição Z atual não puder ser obtida do contexto da conexão serial (contexto indefinido ou sem dados de posição), THEN THE Módulo_Probing SHALL abortar a operação e enviar mensagem ao console indicando que a posição Z não pôde ser verificada

### Requirement 3: Suporte a Comandos de Arco G2/G3

**User Story:** Como operador CNC, eu quero que arcos (G2/G3) no G-code sejam compensados corretamente, para que PCBs com trilhas curvas sejam fresadas com precisão.

#### Acceptance Criteria

1. WHEN uma linha G-code contém comando G2 ou G3 com parâmetros I, J ou R no plano XY (G17), THE Parser_GCode SHALL linearizar o arco em segmentos de reta G1 com comprimento máximo igual a metade do delta, preservando a continuidade entre o ponto inicial e o ponto final do arco
2. WHEN um arco é linearizado, THE Módulo_Compensação SHALL aplicar compensação Z individualmente a cada ponto de segmento resultante, interpolando a correção Z com base nas coordenadas XY de cada ponto
3. WHEN um arco é linearizado, THE Parser_GCode SHALL preservar o feedrate original do comando de arco em todos os segmentos G1 gerados
4. WHEN uma linha G-code contém comando G2 ou G3 com parâmetros I e J, THE Parser_GCode SHALL interpretar I e J como offsets incrementais do ponto atual até o centro do arco e gerar os segmentos linearizados; WHEN uma linha G-code contém comando G2 ou G3 com parâmetro R, THE Parser_GCode SHALL calcular o centro do arco a partir do raio e dos pontos inicial e final e gerar os segmentos linearizados
5. IF um comando G2/G3 contém parâmetros onde a distância entre o centro calculado e o ponto inicial difere da distância entre o centro e o ponto final em mais de 0.001 mm, THEN THE Parser_GCode SHALL copiar a linha original sem modificação e registrar aviso no log indicando a inconsistência dos parâmetros do arco
6. IF um comando G2/G3 define um arco completo (ponto final igual ao ponto inicial com tolerância de 0.001 mm), THEN THE Parser_GCode SHALL linearizar o arco completo (360°) em segmentos de reta G1 com comprimento máximo igual a metade do delta

### Requirement 4: Modernização de Dependências

**User Story:** Como desenvolvedor, eu quero que a extensão utilize versões atuais das dependências, para que funcione com Node.js moderno e versões recentes do CNCjs.

#### Acceptance Criteria

1. THE Módulo_Conexão SHALL utilizar socket.io-client versão 4.x para comunicação WebSocket com o CNCjs
2. THE Sistema_Autolevel SHALL utilizar commander versão 12.x para parsing de argumentos de linha de comando
3. WHEN o Sistema_Autolevel é iniciado com Node.js versão 18 ou superior, THE Sistema_Autolevel SHALL realizar parsing dos argumentos de linha de comando, estabelecer conexão WebSocket com o servidor CNCjs, e responder a eventos de serialport sem erros de runtime
4. WHEN a conexão WebSocket é estabelecida com socket.io v4, THE Módulo_Conexão SHALL autenticar-se enviando o token JWT como parâmetro de query na URL de conexão e receber o evento "connect" confirmando sessão autenticada com o CNCjs
5. IF o servidor CNCjs não aceitar a conexão socket.io v4 dentro de 10 segundos, THEN THE Módulo_Conexão SHALL emitir um erro no console indicando falha de conexão e encerrar o processo com código de saída diferente de zero

### Requirement 5: Sondagem com Múltiplas Medições por Ponto

**User Story:** Como operador CNC com máquina de menor precisão, eu quero sondar cada ponto múltiplas vezes e usar a média, para obter medições mais confiáveis da superfície.

#### Acceptance Criteria

1. WHEN o parâmetro de número de probes por ponto (N) é especificado no comando com valor entre 2 e 10, THE Módulo_Probing SHALL sondar cada ponto N vezes e calcular a média aritmética das medições Z válidas
2. WHERE o parâmetro N não é especificado ou é igual a 1, THE Módulo_Probing SHALL sondar cada ponto uma única vez (comportamento padrão atual)
3. WHEN múltiplas medições são realizadas em um ponto e N >= 4, THE Módulo_Probing SHALL descartar medições que desviam mais de 2 desvios-padrão da média (outlier rejection)
4. IF todas as medições de um ponto são descartadas como outliers, THEN THE Módulo_Probing SHALL utilizar a mediana das medições originais como valor do ponto
5. WHEN múltiplas medições são realizadas, THE Módulo_Probing SHALL elevar a ferramenta à altura de deslocamento entre cada medição individual do mesmo ponto

### Requirement 6: Eficiência de Memória para Arquivos G-code Grandes

**User Story:** Como operador CNC usando Raspberry Pi, eu quero que a extensão processe arquivos G-code grandes (>300k linhas) sem esgotar a memória, para que não ocorram crashes durante a compensação.

#### Acceptance Criteria

1. THE Módulo_Compensação SHALL processar o G-code linha a linha utilizando streaming, mantendo no máximo uma linha de entrada e uma linha de saída em buffer simultaneamente, em vez de carregar o arquivo inteiro em memória
2. WHEN um arquivo G-code com mais de 100.000 linhas é processado, THE Módulo_Compensação SHALL manter consumo de memória heap adicional inferior a 50 MB acima da linha de base medida antes do início do processamento, independentemente do tamanho do arquivo de entrada
3. WHEN a compensação é aplicada via streaming, THE Módulo_Compensação SHALL produzir saída numericamente idêntica à do processamento em memória, com diferença máxima de ±0.0005 mm por coordenada em relação ao resultado do algoritmo em memória
4. THE Módulo_Compensação SHALL reportar progresso a cada 5.000 linhas processadas via mensagem no console do CNCjs contendo o número da linha atual e o total de linhas do arquivo
5. IF ocorrer um erro de leitura do arquivo de entrada ou de escrita no arquivo de saída durante o streaming, THEN THE Módulo_Compensação SHALL interromper o processamento, descartar qualquer saída parcial gerada, e enviar mensagem ao console do CNCjs indicando o tipo de erro e a linha em que ocorreu a falha

### Requirement 7: Tratamento de Erros e Feedback ao Usuário

**User Story:** Como operador CNC, eu quero receber mensagens claras sobre o estado da operação e erros, para que eu possa diagnosticar problemas rapidamente.

#### Acceptance Criteria

1. WHEN a conexão WebSocket é perdida durante a sondagem, THE Módulo_Conexão SHALL tentar reconectar automaticamente até 3 vezes com intervalo de 5 segundos entre cada tentativa
2. IF a reconexão falha após 3 tentativas, THEN THE Módulo_Conexão SHALL registrar no log o timestamp, endereço do servidor, número de tentativas realizadas e último código de erro recebido, preservar os dados de sondagem já coletados em arquivo, e encerrar a operação enviando comando de parada ao controlador CNC
3. WHEN um probe falha (G38.2 não encontra contato dentro do curso especificado), THE Módulo_Probing SHALL retrair o eixo Z até a altura de deslocamento (travelling height), abortar a sequência de sondagem, e enviar ao console do CNCjs mensagem de erro indicando o número sequencial do ponto que falhou e suas coordenadas XY planejadas
4. WHEN a sondagem é iniciada, THE Módulo_Probing SHALL enviar ao console do CNCjs um resumo com: número total de pontos planejados, limites da área de sondagem (Xmin, Xmax, Ymin, Ymax), delta em mm, feedrate em mm/min, e tempo estimado calculado como (número_de_pontos × (curso_Z / feedrate + tempo_de_deslocamento))
5. IF um erro de parsing ocorre em uma linha G-code durante compensação, THEN THE Módulo_Compensação SHALL copiar a linha original sem modificação para a saída, registrar no log um aviso contendo o número da linha e o conteúdo original da linha com erro, e continuar o processamento das linhas subsequentes

### Requirement 8: Persistência e Reutilização de Dados de Sondagem

**User Story:** Como operador CNC, eu quero que os dados de sondagem sejam salvos de forma confiável e possam ser reutilizados entre sessões, para não precisar re-sondar a superfície após reiniciar o sistema.

#### Acceptance Criteria

1. WHEN a sondagem é concluída com sucesso, THE Sistema_Autolevel SHALL salvar os pontos sondados em arquivo texto com uma linha por ponto, cada linha contendo no mínimo as coordenadas X Y Z separadas por espaço, com precisão de pelo menos 3 casas decimais
2. WHEN o sistema é iniciado e o arquivo de sondagem padrão existe, THE Sistema_Autolevel SHALL carregar automaticamente os pontos do arquivo e disponibilizá-los para compensação sem necessidade de nova sondagem
3. IF o arquivo de sondagem não existe ou não pode ser lido ao iniciar, THEN THE Sistema_Autolevel SHALL iniciar sem pontos de sondagem carregados e registrar mensagem informativa no console
4. THE Sistema_Autolevel SHALL validar a integridade dos dados carregados verificando que cada linha contém pelo menos 3 valores numéricos finitos (não NaN, não Infinity) e que o conjunto total contém no mínimo 3 pontos não-colineares
5. IF a validação dos dados carregados falhar, THEN THE Sistema_Autolevel SHALL descartar todos os pontos do arquivo inválido e iniciar sem dados de sondagem, registrando mensagem de erro no console
6. WHEN dados de sondagem válidos são salvos e posteriormente carregados do mesmo arquivo, THE Sistema_Autolevel SHALL produzir coordenadas X Y Z com diferença máxima de 0.001 mm em relação aos valores originais (propriedade round-trip)
