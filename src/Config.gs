/**
 * ============================================================================
 * ARQUIVO: Config.gs
 * OBJETIVO: Centralizar todas as variáveis de configuração, constantes de
 *           sistema, limites de paginação de cache e nomes das abas do Sheets.
 * ============================================================================
 */
const APP_CONFIG = Object.freeze({
  APP_NAME: 'Workspace Team Hub — Gestão Multi-Times',
  VERSION: '4.0.0',
  TIMEZONE: 'America/Sao_Paulo',

  // Configurações do Motor de Cache em Memória RAM (CacheService)
  CACHE: Object.freeze({
    TTL_SECONDS: 21600,        // 6 horas (máximo permitido pelo Google Apps Script)
    PAGE_SIZE_ITEMS: 50,       // Quantidade de registros por página (Chunk) para ficar abaixo de 100KB
    PREFIX: 'HUB_V4_',         // Prefixo para evitar colisão de chaves em memória
    VERSION_KEY: 'HUB_V4_VER'  // Chave que guarda o timestamp da última atualização
  }),

  // Configurações de Segurança e Cotas de E-mail
  EMAIL: Object.freeze({
    ENABLED: true,
    MIN_QUOTA_RESERVE: 15      // Reserva mínima da cota diária do MailApp para não travar a conta
  }),

  // Nomes das Abas no Google Sheets (Banco de Dados Amigável para Humanos)
  SHEETS: Object.freeze({
    TIMES: 'DB_Times',
    MEMBROS: 'DB_Membros',
    OBJETIVOS: 'DB_Objetivos',
    PROJETOS: 'DB_Projetos',
    TAREFAS: 'DB_Tarefas',
    ROTINAS: 'DB_Rotinas',
    HISTORICO_ROTINAS: 'DB_Historico_Rotinas'
  }),

  // Cabeçalhos Amigáveis das Abas
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
