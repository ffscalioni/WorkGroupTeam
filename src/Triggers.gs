/**
 * ============================================================================
 * ARQUIVO: Triggers.gs
 * OBJETIVO: Gerenciar rotinas agendadas (Time-Driven) para manter o JSON
 *           paginado sempre carregado na memória RAM do Google e sincronizar
 *           edições feitas manualmente na planilha.
 * ============================================================================
 */

/**
 * Execute esta função UMA VEZ no editor do Apps Script para instalar os gatilhos automáticos.
 */
function instalarGatilhosAutomaticos() {
  const triggersAtuais = ScriptApp.getProjectTriggers();
  triggersAtuais.forEach(t => ScriptApp.deleteTrigger(t));

  // 1. Agendamento a cada 10 minutos para manter o Cache em Memória sempre aquecido
  ScriptApp.newTrigger('rotinaAgendadaAquecerCache')
    .timeBased()
    .everyMinutes(10)
    .create();

  // 2. Gatilho instalável ao editar a planilha manualmente
  ScriptApp.newTrigger('aoEditarPlanilhaManualmente')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
}

/**
 * Chamada automaticamente a cada 10 minutos pelo servidor do Google.
 */
function rotinaAgendadaAquecerCache() {
  CacheManager.aquecerTodoOCache();
}

/**
 * Chamada automaticamente quando alguém edita uma célula diretamente no Google Sheets.
 */
function aoEditarPlanilhaManualmente(e) {
  if (!e || !e.range) return;
  const abaEditada = e.range.getSheet().getName();
  const abasMonitoradas = Object.values(APP_CONFIG.SHEETS);
  if (abasMonitoradas.includes(abaEditada)) {
    const dadosAtualizados = SheetRepo.lerAbaBruta(abaEditada);
    CacheManager.salvarEntidadePaginada(abaEditada, dadosAtualizados);
  }
}
