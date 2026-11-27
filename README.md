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
Valida um arquivo regulatório XML (hoje o CADOC 3040) contra os data quality checks do Dicionário.
- **O XML não sai do navegador:** é lido em partes de 4 MB (`File.slice`), então arquivos grandes não travam a tela. Ao servidor vão só as regras e o resumo do resultado.
- **Regra executável de cada check, nesta ordem:** 1) coluna `regraExec` de `DD_Quality_Checks` (salva na base); 2) regra gerada pelo **Gemini Nano do Chrome** (Prompt API, guardada no navegador até alguém salvá-la na base); 3) regra **automática** deduzida do texto do check (domínios, datas, dígitos, casas decimais, unicidade...). Checks que dependem de dados externos (UNICAD, COSIF, PTAX...) aparecem como "não executáveis".
- **Formato da regra (JSON):** `{"tipo":"dominio","elemento":"Cli","atributo":"TpCtrl","valores":["01","02"]}`. Tipos: `obrigatorio`, `dominio`, `regex`, `data`, `numero`, `tamanho`, `digitos`, `unico`, `manual`. Opcionais: `obrigatorio`, `lista` (códigos separados por `;`) e `quando` (`{"atributo":"Tp","valores":["1"]}`, ou `"Cli.Tp"` para um elemento pai). Uma lista `[...]` exige que todas passem.
- **Estrutura:** confere a codificação, o elemento raiz, a abertura e o fechamento das tags, o `TotalCli` contra a quantidade de `<Cli>` e a data-base.
- **Exemplos de erro** (até 5 por check) aparecem com CPF/CNPJ mascarados, na tela e no PDF.
- **Registrar validação** gera um PDF no Drive, na pasta "DD - Validações de Arquivos Regulatórios" (criada no 1º uso, ID em `DD_VAL_PASTA_ID` nas Script Properties), e grava uma linha na aba `DD_Validacoes` da planilha do Dicionário.
- **Endpoints** (`src/ValidacaoArquivo.gs`): `apiDDSalvarRegraCheck` e `apiDDSalvarRegrasEmLote` (Gestor/Admin), `apiDDListarValidacoes` e `apiDDRegistrarValidacao` (qualquer membro).
- **Permissão nova:** o projeto passa a usar o Drive (`DriveApp`). Na 1ª execução depois da atualização, o Apps Script pede para autorizar o acesso ao Drive.

## Como Subir para o Google Apps Script via VS Code
1. Instale as dependências: `npm install`
2. Faça login no Google Clasp: `npx clasp login`
3. Configure o arquivo `.clasp.json` com o seu `scriptId` apontando para `"rootDir": "./src"`
4. Envie os arquivos: `npm run push`
