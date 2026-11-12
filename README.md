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

## Como Subir para o Google Apps Script via VS Code
1. Instale as dependências: `npm install`
2. Faça login no Google Clasp: `npx clasp login`
3. Configure o arquivo `.clasp.json` com o seu `scriptId` apontando para `"rootDir": "./src"`
4. Envie os arquivos: `npm run push`
