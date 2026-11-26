/**
 * ============================================================================
 * ARQUIVO: src/Triggers.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Cadastrar no servidor do Google o agendamento automático a cada
 *           5 minutos para carregar o JSON paginado no CacheService (RAM).
 * ============================================================================
 */

/**
 * FUNÇÃO PRINCIPAL DE AGENDAMENTO (A CADA 5 MINUTOS):
 * Você pode executar esta função diretamente no topo do editor script.google.com
 * OU clicar no botão verde dentro da aba "Config & Cache Server" do site!
 */
function agendarCacheServidor5Minutos() {
  return instalarGatilhosAutomaticos(5);
}

/**
 * Instala ou atualiza os gatilhos automáticos do servidor Google.
 * @param {number} intervaloMinutos Padrão: 5 minutos (aceita 1, 5, 10, 15 ou 30).
 */
function instalarGatilhosAutomaticos(intervaloMinutos) {
  // Funções globais podem ser chamadas pelo navegador: só Admin (ou o dono, pelo editor) instala gatilhos
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN']);

  const minutosValidos = [1, 5, 10, 15, 30];
  const min = minutosValidos.includes(Number(intervaloMinutos))
    ? Number(intervaloMinutos)
    : APP_CONFIG.CACHE.DEFAULT_SCHEDULE_MINUTES;

  // 1. Garante que a planilha exista e carrega todo o JSON paginado na memória RAM agora
  SheetRepo.inicializarBancoSeNecessario();
  const planilhaBanco = SheetRepo.obterPlanilha();
  const planilhaDicionario = ddInicializar_();
  CacheManager.aquecerTodoOCache();
  ddAquecerCache_();

  // 2. Apaga somente os gatilhos deste módulo, para não duplicar nem remover gatilhos de terceiros
  const funcoesDesteModulo = ['rotinaAgendadaAquecerCache', 'aoEditarPlanilhaManualmente', 'aoEditarDicionarioManualmente'];
  ScriptApp.getProjectTriggers()
    .filter(t => funcoesDesteModulo.indexOf(t.getHandlerFunction()) > -1)
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 3. CRIA O AGENDAMENTO NO SERVIDOR GOOGLE (Roda sozinho a cada 5 minutos!)
  ScriptApp.newTrigger('rotinaAgendadaAquecerCache')
    .timeBased()
    .everyMinutes(min)
    .create();

  // 4. Cria o gatilho que atualiza o cache quando alguém edita a planilha manualmente
  ScriptApp.newTrigger('aoEditarPlanilhaManualmente')
    .forSpreadsheet(planilhaBanco)
    .onEdit()
    .create();

  // 5. Mesmo gatilho para a planilha própria do Dicionário de Dados
  ScriptApp.newTrigger('aoEditarDicionarioManualmente')
    .forSpreadsheet(planilhaDicionario)
    .onEdit()
    .create();

  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('CACHE_SCHEDULE_MINUTES', String(min));
  PropertiesService.getScriptProperties().setProperty('CACHE_LAST_WARMUP', agora);

  console.log(`✅ AGENDAMENTO ATIVO: O Cache do Servidor Google será recarregado a cada ${min} minutos!`);
  console.log(`🔗 Planilha Base: ${planilhaBanco.getUrl()}`);

  return {
    ativo: true,
    intervaloMinutos: min,
    ultimoAquecimento: agora,
    totalGatilhos: ScriptApp.getProjectTriggers().length
  };
}

/**
 * Consulta se o agendamento de 5 minutos já está ativo nos servidores do Google.
 */
function obterStatusAgendamentoCache() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const temTimer = triggers.some(t => t.getHandlerFunction() === 'rotinaAgendadaAquecerCache');
    const props = PropertiesService.getScriptProperties();
    return {
      ativo: temTimer,
      intervaloMinutos: Number(props.getProperty('CACHE_SCHEDULE_MINUTES') || 5),
      ultimoAquecimento: props.getProperty('CACHE_LAST_WARMUP') || 'Aguardando 1º ciclo',
      totalGatilhos: triggers.length
    };
  } catch (e) {
    return { ativo: false, intervaloMinutos: 5, ultimoAquecimento: '-', totalGatilhos: 0 };
  }
}

/**
 * ROTINA EXECUTADA SOZINHA PELO GOOGLE A CADA 5 MINUTOS:
 * Lê todas as abas da planilha, divide em páginas de 50 itens e salva na RAM (CacheService).
 */
function rotinaAgendadaAquecerCache() {
  CacheManager.aquecerTodoOCache();
  ddAquecerCache_(); // Dicionário de Dados: planilha própria, versão de cache própria
  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('CACHE_LAST_WARMUP', agora);
}

/**
 * Disparada automaticamente quando alguém edita uma célula diretamente no Google Sheets.
 */
function aoEditarPlanilhaManualmente(e) {
  if (!e || !e.range) return;
  const abaEditada = e.range.getSheet().getName();
  const abasMonitoradas = Object.values(APP_CONFIG.SHEETS);
  if (abasMonitoradas.includes(abaEditada)) {
    const dadosAtualizados = SheetRepo.lerAbaBruta(abaEditada);
    CacheManager.salvarEntidadePaginada(abaEditada, dadosAtualizados);
    const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
    PropertiesService.getScriptProperties().setProperty('CACHE_LAST_WARMUP', agora);
  }
}