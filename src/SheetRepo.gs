/**
 * ============================================================================
 * ARQUIVO: src/SheetRepo.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Garantir a atualização em ordem estrita no Backend:
 *           1º Atualiza o Cache de Memória do Servidor (CacheService Paginado)
 *           2º Persiste na Planilha Google (Google Sheets) sob LockService.
 * ============================================================================
 */
class SheetRepo {
  static obterPlanilha() {
    if (APP_CONFIG.SPREADSHEET_ID && APP_CONFIG.SPREADSHEET_ID.trim() !== '') {
      return SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID.trim());
    }

    try {
      const planilhaAtiva = SpreadsheetApp.getActiveSpreadsheet();
      if (planilhaAtiva) return planilhaAtiva;
    } catch (e) {}

    const props = PropertiesService.getScriptProperties();
    const idSalvo = props.getProperty('AUTO_CREATED_SPREADSHEET_ID');
    if (idSalvo) {
      try {
        return SpreadsheetApp.openById(idSalvo);
      } catch (err) {
        console.warn('Criando nova planilha base...');
      }
    }

    const novaPlanilha = SpreadsheetApp.create(APP_CONFIG.DEFAULT_DB_FILENAME);
    props.setProperty('AUTO_CREATED_SPREADSHEET_ID', novaPlanilha.getId());
    return novaPlanilha;
  }

  static inicializarBancoSeNecessario() {
    const ss = SheetRepo.obterPlanilha();
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

    const sheetTimes = ss.getSheetByName(abas.TIMES);
    if (sheetTimes.getLastRow() <= 1) {
      SheetRepo.popularDadosExemploIniciais(ss);
      CacheManager.aquecerTodoOCache();
    }
  }

  static popularDadosExemploIniciais(ss) {
    const hoje = Utils.hojeISO();
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-DATA', 'Data Engineering & Analytics', 'DATA', '#1d4ed8', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-AI', 'Artificial Intelligence', 'AI', '#7e22ce', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-TRANS', 'Transformation', 'TRANSF', '#15803d', 'SIM']);
    ss.getSheetByName(APP_CONFIG.SHEETS.TIMES).appendRow(['TM-PMO', 'PMO & Governance', 'PMO', '#c2410c', 'SIM']);

    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-01', 'Beatriz (Data)', 'beatriz@empresa.com', 'TM-DATA', 'TIME']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-02', 'Lucas (AI)', 'lucas@empresa.com', 'TM-AI', 'TIME']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-03', 'Camila (Transf)', 'camila@empresa.com', 'TM-TRANS', 'GESTOR']);
    ss.getSheetByName(APP_CONFIG.SHEETS.MEMBROS).appendRow(['MEM-04', 'Rafael (PMO)', 'rafael@empresa.com', 'TM-PMO', 'ADMIN']);

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
      'Diária', hoje, 'Pendente',
      'Conferir logs da madrugada, validar volumetria de linhas e atualizar status para o time.',
      'Pipelines verificados sem falhas.', hoje, 'PUBLICO', ''
    ]);
  }

  static lerAbaBruta(nomeAba) {
    const ss = SheetRepo.obterPlanilha();
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

  static obterEntidadeComCache(nomeAba) {
    let dados = CacheManager.lerEntidadePaginada(nomeAba);
    if (!dados) {
      dados = SheetRepo.lerAbaBruta(nomeAba);
      CacheManager.salvarEntidadePaginada(nomeAba, dados);
    }
    return dados;
  }

  /**
   * INSERÇÃO EM ORDEM ESTRITA:
   * 1º Atualiza imediatamente o Cache de Memória do Servidor (CacheService).
   * 2º Grava a nova linha na Planilha Google (Sheets).
   */
  static inserirRegistro(nomeAba, objetoNovo) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const cabecalhos = APP_CONFIG.HEADERS[nomeAba];
      const registroLimpo = {};
      cabecalhos.forEach(col => {
        registroLimpo[col] = objetoNovo[col] !== undefined ? objetoNovo[col] : '';
      });

      // PASSO 1: Atualiza o Cache de Memória do Servidor (RAM) imediatamente
      const listaEmMemoria = SheetRepo.obterEntidadeComCache(nomeAba);
      listaEmMemoria.push(registroLimpo);
      const novaVersao = CacheManager.salvarEntidadePaginada(nomeAba, listaEmMemoria);

      // PASSO 2: Grava na Planilha Google (Persistência Física)
      const ss = SheetRepo.obterPlanilha();
      const sheet = ss.getSheetByName(nomeAba);
      const linhaPlanilha = cabecalhos.map(col => registroLimpo[col]);
      sheet.appendRow(linhaPlanilha);
      SpreadsheetApp.flush();

      return { versao: novaVersao, lista: listaEmMemoria };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * ATUALIZAÇÃO PARCIAL (PATCH) EM ORDEM ESTRITA:
   * 1º Atualiza o item no Cache de Memória do Servidor (CacheService).
   * 2º Atualiza apenas as células alteradas na Planilha Google (Sheets).
   */
  static aplicarPatchNaLinha(nomeAba, colunaIdNome, valorId, camposParaAtualizar) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      // PASSO 1: Atualiza primeiro no Cache de Memória do Servidor (RAM)
      const listaEmMemoria = SheetRepo.obterEntidadeComCache(nomeAba);
      const itemCache = listaEmMemoria.find(item => String(item[colunaIdNome]) === String(valorId));
      if (itemCache) {
        Object.keys(camposParaAtualizar).forEach(col => {
          itemCache[col] = camposParaAtualizar[col];
        });
      }
      const novaVersao = CacheManager.salvarEntidadePaginada(nomeAba, listaEmMemoria);

      // PASSO 2: Atualiza na Planilha Google (Persistência Física)
      const ss = SheetRepo.obterPlanilha();
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
      SpreadsheetApp.flush();

      return { versao: novaVersao, lista: listaEmMemoria };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * EXCLUSÃO EM ORDEM ESTRITA:
   * 1º Remove o item do Cache de Memória do Servidor (CacheService).
   * 2º Remove a linha correspondente na Planilha Google (Sheets).
   */
  static excluirRegistroPorId(nomeAba, colunaIdNome, valorId) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      // PASSO 1: Remove primeiro do Cache de Memória do Servidor (RAM)
      const listaEmMemoria = SheetRepo.obterEntidadeComCache(nomeAba);
      const novaLista = listaEmMemoria.filter(item => String(item[colunaIdNome]) !== String(valorId));
      const novaVersao = CacheManager.salvarEntidadePaginada(nomeAba, novaLista);

      // PASSO 2: Remove a linha na Planilha Google (Persistência Física)
      const ss = SheetRepo.obterPlanilha();
      const sheet = ss.getSheetByName(nomeAba);
      const matriz = sheet.getDataRange().getValues();
      const cabecalhos = matriz[0];
      const idxId = cabecalhos.indexOf(colunaIdNome);

      for (let i = matriz.length - 1; i >= 1; i--) {
        if (String(matriz[i][idxId]) === String(valorId)) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
      SpreadsheetApp.flush();

      return { versao: novaVersao, lista: novaLista };
    } finally {
      lock.releaseLock();
    }
  }
}