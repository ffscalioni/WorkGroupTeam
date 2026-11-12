/**
 * ============================================================================
 * ARQUIVO: SheetRepo.gs
 * OBJETIVO: Camada de persistência no Google Sheets com formatação amigável
 *           para humanos, leitura em lote e LockService contra concorrência.
 * ============================================================================
 */
class SheetRepo {
  /**
   * Garante que todas as abas existam na Planilha Google e popula dados iniciais.
   */
  static inicializarBancoSeNecessario() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abas = APP_CONFIG.SHEETS;

    Object.keys(abas).forEach(chave => {
      const nomeAba = abas[chave];
      let sheet = ss.getSheetByName(nomeAba);
      if (!sheet) {
        sheet = ss.insertSheet(nomeAba);
        const cabecalhos = APP_CONFIG.HEADERS[nomeAba];
        sheet.appendRow(cabecalhos);
        sheet.getRange(1, 1, 1, cabecalhos.length)
          .setFontWeight('bold')
          .setBackground('#1e293b')
          .setFontColor('#ffffff');
        sheet.setFrozenRows(1);
      }
    });

    // Se a aba de Times estiver apenas com o cabeçalho, insere a carga inicial de exemplo
    const sheetTimes = ss.getSheetByName(abas.TIMES);
    if (sheetTimes.getLastRow() <= 1) {
      SheetRepo.popularDadosExemploIniciais(ss);
      CacheManager.aquecerTodoOCache();
    }
  }

  /**
   * Insere dados iniciais amigáveis nas abas para o usuário já testar o sistema.
   */
  static popularDadosExemploIniciais(ss) {
    const hoje = Utils.hojeISO();
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-DATA', 'Data Engineering & Analytics', 'DATA', '#1d4ed8', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-AI', 'Artificial Intelligence', 'AI', '#7e22ce', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-TRANS', 'Transformation', 'TRANSF', '#15803d', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-PMO', 'PMO & Governance', 'PMO', '#c2410c', 'SIM']);

    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-01', 'Beatriz (Data)', 'beatriz@empresa.com', 'TM-DATA', 'MEMBRO']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-02', 'Lucas (AI)', 'lucas@empresa.com', 'TM-AI', 'MEMBRO']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-03', 'Camila (Transf)', 'camila@empresa.com', 'TM-TRANS', 'MEMBRO']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-04', 'Rafael (PMO)', 'rafael@empresa.com', 'TM-PMO', 'GESTOR']);

    ss.getSheetByName(APP_CONFIG.SHEETS.OBJETIVOS).appendRow(['OBJ-01', 'TM-AI', 'Escalar agentes de IA nas rotinas internas', '3 agentes em produção', 'PUBLICO', '']);
    ss.getSheetByName(APP_CONFIG.SHEETS.OBJETIVOS).appendRow(['OBJ-02', 'TM-DATA', 'Unificar catálogo e qualidade de dados da área', '100% das tabelas auditadas', 'PUBLICO', '']);
    ss.getSheetByName(APP_CONFIG.SHEETS.OBJETIVOS).appendRow(['OBJ-03', 'TM-PMO', 'Garantir previsibilidade e ritos executivos', 'Zero atrasos em reports', 'PUBLICO', '']);

    ss.getSheetByName(APP_CONFIG.SHEETS.PROJETOS).appendRow(['PRJ-01', 'Assistente Interno de Leitura de Documentos', 'OBJ-01', 'TM-AI', 'Lucas (AI)', 'PUBLICO', '']);
    ss.getSheetByName(APP_CONFIG.SHEETS.PROJETOS).appendRow(['PRJ-02', 'Catálogo Único de Indicadores e Pipelines', 'OBJ-02', 'TM-DATA', 'Beatriz (Data)', 'PUBLICO', '']);
    ss.getSheetByName(APP_CONFIG.SHEETS.PROJETOS).appendRow(['PRJ-03', 'Automação do Painel Executivo da Área', 'OBJ-03', 'TM-PMO', 'Rafael (PMO)', 'PUBLICO', '']);

    ss.getSheetByName(APP_CONFIG.SHEETS.TAREFAS).appendRow([
      'ATV-101', 'Estruturar tabela base de indicadores no catálogo', 'PRJ-02', 'OBJ-02', 'TM-DATA',
      'Entrega de Projeto', 'Beatriz (Data)', 'Em Andamento', 'Alta', hoje, hoje, '', 'PUBLICO', '', new Date().toISOString()
    ]);
    ss.getSheetByName(APP_CONFIG.SHEETS.TAREFAS).appendRow([
      'ATV-102', 'Conectar Assistente IA nas tabelas homologadas', 'PRJ-01', 'OBJ-01', 'TM-AI',
      'Entrega de Projeto', 'Lucas (AI)', 'A Fazer', 'Alta', hoje, hoje, 'ATV-101', 'PUBLICO', '', new Date().toISOString()
    ]);

    ss.getSheetByName(APP_CONFIG.SHEETS.ROTINAS).appendRow([
      'ROT-01', 'Verificação Diária de Pipelines e Ingestão de Dados', 'TM-DATA', 'Beatriz (Data)',
      'Diária', hoje, 'Pendente no Ciclo',
      '[x] Checar logs de execução da madrugada | [ ] Validar volumetria de linhas | [ ] Atualizar status para o time',
      'Pipelines verificados ontem sem falhas.', hoje, 'PUBLICO', ''
    ]);
  }

  /**
   * Lê uma aba da planilha e transforma em lista de objetos JSON.
   */
  static lerAbaBruta(nomeAba) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(nomeAba);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const valores = sheet.getDataRange().getValues();
    const cabecalhos = valores[0];
    const lista = [];

    for (let i = 1; i < valores.length; i++) {
      const obj = {};
      for (let j = 0; j < cabecalhos.length; j++) {
        let val = valores[i][j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
        }
        obj[cabecalhos[j]] = val;
      }
      lista.push(obj);
    }
    return lista;
  }

  /**
   * Obtém os dados priorizando a Memória RAM (CacheService). Se não existir, lê do Sheets e popula o cache.
   */
  static obterEntidadeComCache(nomeAba) {
    let dados = CacheManager.lerEntidadePaginada(nomeAba);
    if (!dados) {
      dados = SheetRepo.lerAbaBruta(nomeAba);
      CacheManager.salvarEntidadePaginada(nomeAba, dados);
    }
    return dados;
  }

  /**
   * Adiciona um novo registro na planilha sob LockService e atualiza o Cache Paginado.
   */
  static inserirRegistro(nomeAba, objetoNovo) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(nomeAba);
      const cabecalhos = APP_CONFIG.HEADERS[nomeAba];
      const linha = cabecalhos.map(col => objetoNovo[col] !== undefined ? objetoNovo[col] : '');
      sheet.appendRow(linha);

      const listaAtualizada = SheetRepo.lerAbaBruta(nomeAba);
      const novaVersao = CacheManager.salvarEntidadePaginada(nomeAba, listaAtualizada);
      return { versao: novaVersao, lista: listaAtualizada };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Aplica uma atualização parcial (Delta Patch) apenas nas colunas modificadas de uma linha,
   * evitando que dois usuários sobrescrevam alterações simultâneas (Lost Update).
   */
  static aplicarPatchNaLinha(nomeAba, colunaIdNome, valorId, camposParaAtualizar) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(nomeAba);
      const matriz = sheet.getDataRange().getValues();
      const cabecalhos = matriz[0];
      const idxId = cabecalhos.indexOf(colunaIdNome);

      for (let i = 1; i < matriz.length; i++) {
        if (String(matriz[i][idxId]) === String(valorId)) {
          Object.keys(camposParaAtualizar).forEach(nomeCol => {
            const colIdx = cabecalhos.indexOf(nomeCol);
            if (colIdx > -1) {
              sheet.getRange(i + 1, colIdx + 1).setValue(camposParaAtualizar[nomeCol]);
            }
          });
          break;
        }
      }

      const listaAtualizada = SheetRepo.lerAbaBruta(nomeAba);
      const novaVersao = CacheManager.salvarEntidadePaginada(nomeAba, listaAtualizada);
      return { versao: novaVersao, lista: listaAtualizada };
    } finally {
      lock.releaseLock();
    }
  }
}
