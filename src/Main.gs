/**
 * ============================================================================
 * ARQUIVO: Main.gs
 * OBJETIVO: Ponto de entrada do Web App (doGet), helper de modularização HTML
 *           include() e menu administrativo na Planilha Google.
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

/**
 * Permite incluir arquivos HTML separados (Views, Modais, CSS e JS) dentro do AppShell.html
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Cria um menu amigável no topo da Planilha Google para sincronizar o cache com 1 clique.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 Hub Multi-Times')
    .addItem('🔄 Sincronizar Planilha ➔ Cache RAM Agora', 'rotinaAgendadaAquecerCache')
    .addItem('⚙️ Instalar Gatilhos de Cache Automático', 'instalarGatilhosAutomaticos')
    .addToUi();
}
