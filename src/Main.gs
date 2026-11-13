/**
 * ============================================================================
 * ARQUIVO: src/Main.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Ponto de entrada do Web App (doGet), helper include() e menu
 *           administrativo na Planilha Google.
 * ============================================================================
 */

function doGet() {
  SheetRepo.inicializarBancoSeNecessario();
  return HtmlService.createTemplateFromFile('AppShell')
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('🚀 Hub Multi-Times')
      .addItem('⏰ Ativar Agendamento de Cache (A cada 5 min)', 'agendarCacheServidor5Minutos')
      .addItem('🔄 Sincronizar Planilha ➔ Cache RAM Agora', 'rotinaAgendadaAquecerCache')
      .addItem('✨ Gerar Resumo =AI() Gemini na Planilha', 'apiInserirFormulaGeminiPlanilha')
      .addToUi();
  } catch (e) {}
}