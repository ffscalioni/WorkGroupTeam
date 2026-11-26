/**
 * ============================================================================
 * ARQUIVO: src/Config.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Centralizar todas as variáveis de configuração, constantes de
 *           sistema, agendamento padrão de 5 minutos e abas da planilha.
 * ============================================================================
 */
const APP_CONFIG = Object.freeze({
  APP_NAME: 'Workspace Team Hub — Gestão Multi-Times',
  VERSION: '4.2.0',
  TIMEZONE: 'America/Sao_Paulo',

  /**
   * PARÂMETRO AJUSTÁVEL — ID DA PLANILHA:
   * Se deixar vazio (''), o sistema usa a planilha criada automaticamente!
   * Se quiser fixar o ID da planilha na pasta compartilhada, cole entre as aspas.
   */
  SPREADSHEET_ID: '',
  DEFAULT_DB_FILENAME: 'DB - Workspace Team Hub (Base de Dados)',

  // Configurações do Motor de Cache em Memória RAM do Servidor Google (CacheService)
  CACHE: Object.freeze({
    TTL_SECONDS: 21600,             // 6 horas na memória RAM do Google
    PAGE_SIZE_ITEMS: 50,            // 50 registros por página (Chunk) para ficar abaixo de 100KB
    PAGE_MAX_BYTES: 90000,          // Teto por página: textos longos fecham a página antes dos 50 itens
    DEFAULT_SCHEDULE_MINUTES: 5,    // Agendamento padrão: recarregar a cada 5 minutos!
    PREFIX: 'HUB_V4_',              // Prefixo das chaves em memória
    VERSION_KEY: 'HUB_V4_VER'       // Chave que guarda o timestamp da última atualização
  }),

  // Configurações de Segurança e Cotas de E-mail
  EMAIL: Object.freeze({
    ENABLED: true,
    MIN_QUOTA_RESERVE: 15
  }),

  // Valores aceitos pelo servidor (qualquer outro valor enviado pelo navegador é recusado)
  STATUS_TAREFA: Object.freeze(['A Fazer', 'Em Andamento', 'Bloqueado', 'Concluído']),
  PRIORIDADES: Object.freeze(['Alta', 'Média', 'Baixa']),
  FREQUENCIAS: Object.freeze(['Pontual', 'Diária', 'Semanal', 'Mensal']),
  PERFIS: Object.freeze(['ADMIN', 'GESTOR', 'TIME']),

  // Nomes das 7 Abas no Google Sheets
  SHEETS: Object.freeze({
    TIMES: 'DB_Times',
    MEMBROS: 'DB_Membros',
    OBJETIVOS: 'DB_Objetivos',
    PROJETOS: 'DB_Projetos',
    TAREFAS: 'DB_Tarefas',
    ROTINAS: 'DB_Rotinas',
    HISTORICO_ROTINAS: 'DB_Historico_Rotinas'
  }),

  // Cabeçalhos Amigáveis das Abas (Incluindo suporte a fórmula =AI() do Gemini)
  HEADERS: Object.freeze({
    DB_Times: ['ID_Time', 'Nome_Time', 'Sigla', 'Cor_Hex', 'Ativo'],
    DB_Membros: ['ID_Membro', 'Nome_Exibicao', 'Email_Google', 'ID_Time_Principal', 'Perfil_Acesso'],
    DB_Objetivos: ['ID_Objetivo', 'ID_Time', 'Titulo_Objetivo', 'Meta_Indicador', 'Tipo_Visibilidade', 'Usuarios_Permitidos'],
    DB_Projetos: ['ID_Projeto', 'Nome_Projeto', 'ID_Objetivo', 'ID_Time', 'Lider', 'Tipo_Visibilidade', 'Usuarios_Permitidos'],
    DB_Tarefas: ['ID_Tarefa', 'Titulo_Tarefa', 'ID_Projeto', 'ID_Objetivo', 'ID_Time', 'Tipo_Demanda', 'Responsavel', 'Status', 'Prioridade', 'Data_Inicio', 'Data_Prazo', 'ID_Tarefa_Predecessora', 'Tipo_Visibilidade', 'Usuarios_Permitidos', 'Atualizado_Em'],
    DB_Rotinas: ['ID_Rotina', 'Titulo_Rotina', 'ID_Time', 'Responsavel', 'Frequencia', 'Proxima_Execucao', 'Status_Ciclo', 'Checklist_Amigavel', 'Ultima_Descricao', 'Ultima_Execucao', 'Tipo_Visibilidade', 'Usuarios_Permitidos'],
    DB_Historico_Rotinas: ['ID_Log', 'ID_Rotina', 'Titulo_Rotina', 'Responsavel', 'Data_Hora_Registro', 'Descricao_Informada', 'Resumo_Checklist']
  })
});