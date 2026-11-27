# Workspace Team Hub v4.0 (Enterprise Modular Edition)

Aplicativo Web Serverless para gestão visual de **Times Configuráveis, Objetivos Estratégicos, Projetos/Iniciativas, Tarefas com Dependências, Agendamento Futuro e Rotinas Recorrentes com Checklists**.

## Arquitetura do Projeto (`src/`)
- **Backend (`.gs`):**
  - `Config.gs`: Variáveis globais de sistema, nomes de abas, TTL de cache e tamanho de página.
  - `Utils.gs`: Classe utilitária com parsers bidirecionais (Planilha Amigável <-> Objetos JS).
  - `CacheManager.gs`: Motor de Cache em Memória RAM do Servidor (`CacheService`) paginado em chunks de 50 itens.
  - `SheetRepo.gs`: Repositório de leitura/escrita em lote no Google Sheets com proteção de concorrência (`LockService`).
  - `AuthService.gs`: Controle de acesso e filtro de visibilidade (`PUBLICO`, `TIME`, `RESTRITO`).
  - `NotificationService.gs`: Alertas automáticos por e-mail com trava de cota diária (`MailApp`).
  - `Controllers.gs`: Endpoints expostos para chamadas assíncronas (`google.script.run`) sem refresh.
  - `Triggers.gs`: Rotinas agendadas (Time-Driven) para aquecimento do cache e gatilho `onEdit`.
  - `Main.gs`: Ponto de entrada (`doGet`), helper `include()` e menu na planilha.
- **Frontend (`.html`):**
  - `AppShell.html`, `Styles.html`, `View_Kanban.html`, `View_Rotinas.html`, `View_Hierarquia.html`, `View_Relatorios.html`, `View_Config.html`, `Modal_Tarefa.html`, `Modal_CommandPalette.html`, `ClientCore_JS.html`.

## Dicionário de Dados — aba "🧪 Validar arquivo"
Valida um arquivo regulatório XML contra os data quality checks **dos campos CDE** do reporte escolhido. O resultado segue o formato do relatório do script `dq_cadoc3040.py`: indicadores, perímetro, conformidade por dimensão, cobertura por campo CDE, resultado por verificação (com as ocorrências) e DQs não executados com o motivo.
- **O XML não sai do navegador:** é lido em partes de 4 MB (`File.slice`), então arquivos grandes não travam a tela. Ao servidor vão só as regras e o resumo do resultado.
- **Regra executável de cada check, nesta ordem:** 1) coluna `regraExec` de `DD_Quality_Checks` (salva na base); 2) **regra padrão do reporte** (gabarito revisado no código; hoje existe para o 3040 e reproduz as verificações do `dq_cadoc3040.py` que dá para fazer só com o XML); 3) regra escrita pelo **Gemini Nano do Chrome** a partir do texto do check (Prompt API, guardada no navegador até alguém salvá-la na base); 4) regra **automática** deduzida do texto do check. Checks que dependem de outra fonte (Cadastro Central, tabelas consolidadas, data-base anterior, COSIF, PTAX, Change...) aparecem como "não executados", com a categoria e o motivo.
- **Checks com a mesma regra** viram uma verificação só, com todos os DQs cobertos (como no relatório do Python).
- **Status:** FALHA = prioridade Alta com ocorrências; ALERTA = prioridade Média/Baixa com ocorrências; N/A = nenhum registro aplicável; NÃO EXECUTADA = sem regra executável.
- **Formato da regra (JSON, versão 2):** `{"v":2,"nome":"...","escopo":"Op","filtro":"qtd('Inf') == 0","teste":"preenchido(ProvConsttd)","chave":"IPOC","encontrado":"ProvConsttd","esperado":"valor"}`. Em vez de `teste`: `unico` (valor que não pode repetir) ou `grupo: {por, conta}` com `$n` no teste. Não executável: `{"v":2,"manual":true,"categoria":"Fonte externa","motivo":"..."}`. As expressões aceitam atributos (`Tp`, `Cli.Tp`, `raiz.CNPJ`, `ContInstFinRes4966.VlrContBr`), operadores (`== != < <= > >= && || ! in [..] + - * / ? :`), variáveis (`$dtBase`, `$fimMes`, `$mesAtual`, `$hoje`, `$arquivo`) e funções (`preenchido`, `regex`, `data`, `dias`, `cpf`, `cnpj`, `zeros`, `qtd`, `valor`, `valores`, `anexo` etc.). São interpretadas por um leitor próprio, sem `eval`. A versão 1 (`{"tipo":"dominio","elemento":"Cli","atributo":"TpCtrl","valores":["01","02"]}`) continua aceita.
- **Estrutura:** confere a codificação, o elemento raiz, a abertura e o fechamento das tags, o `TotalCli` contra a quantidade de `<Cli>` (verificação INT-01) e a data-base.
- **Ocorrências** (até 50 por verificação na tela e 10 no PDF) aparecem com CPF/CNPJ mascarados.
- **Registrar validação** gera um PDF no Drive, na pasta "DD - Validações de Arquivos Regulatórios" (criada no 1º uso, ID em `DD_VAL_PASTA_ID` nas Script Properties), e grava uma linha na aba `DD_Validacoes` da planilha do Dicionário.
- **Endpoints** (`src/ValidacaoArquivo.gs`): `apiDDSalvarRegraCheck` e `apiDDSalvarRegrasEmLote` (Gestor/Admin), `apiDDListarValidacoes` e `apiDDRegistrarValidacao` (qualquer membro).
- **Permissão nova:** o projeto passa a usar o Drive (`DriveApp`). Na 1ª execução depois da atualização, o Apps Script pede para autorizar o acesso ao Drive.

## Como Subir para o Google Apps Script via VS Code
1. Instale as dependências: `npm install`
2. Faça login no Google Clasp: `npx clasp login`
3. Configure o arquivo `.clasp.json` com o seu `scriptId` apontando para `"rootDir": "./src"`
4. Envie os arquivos: `npm run push`
