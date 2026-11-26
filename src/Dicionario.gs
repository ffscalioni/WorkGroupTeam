/**
 * ============================================================================
 * ARQUIVO: src/Dicionario.gs (ARQUIVO COMPLETO)
 * MÓDULO: Dicionário de Dados Regulatórios
 * OBJETIVO: Backend do módulo de Dicionário de Dados. Usa uma PLANILHA PRÓPRIA
 *           (separada da base do Workgroup) com 3 abas:
 *             DD_Regulatorios   -> inventário de reportes regulatórios
 *             DD_Campos         -> campos por reporte, lineage, CDE e Data Owner
 *             DD_Quality_Checks -> data quality checks (texto descritivo) por campo
 *             DD_Lineage        -> passos do lineage de cada campo (sistema, tabela e
 *                                  coluna, da origem até o layout do arquivo)
 *           Também monta a página inicial de escolha de módulo (portal).
 *
 * A carga inicial vem do bloco DD_SEED embutido em Dicionario.html (gerado a
 * partir das planilhas Inventario_RC18 e Validacoes_CADOC3040).
 * ============================================================================
 */
const DD_CONFIG = Object.freeze({
  DB_FILENAME: 'DB - Dicionário de Dados Regulatórios',
  PROP_ID: 'DD_SPREADSHEET_ID',
  // Última atualização da carga inicial já aplicada numa planilha existente (ver ddAplicarAtualizacao_)
  PROP_VERSAO_CARGA: 'DD_VERSAO_CARGA',
  // Registros excluídos pela tela, por aba (DD_EXCLUIDOS_<aba>): uma nova revisão da carga inicial não os traz de volta
  PROP_EXCLUIDOS: 'DD_EXCLUIDOS_',
  // Versão própria do cache do Dicionário: gravar aqui não força recarga no Workgroup (e vice-versa)
  VERSION_KEY: 'HUB_V4_DD_VER',
  SHEETS: Object.freeze({
    REGS: 'DD_Regulatorios',
    CAMPOS: 'DD_Campos',
    CHECKS: 'DD_Quality_Checks',
    LINEAGE: 'DD_Lineage'
  }),
  CHAVES: Object.freeze({ DD_Regulatorios: 'cod', DD_Campos: 'id', DD_Quality_Checks: 'id', DD_Lineage: 'id' }),
  // Camadas do lineage, na ordem em que o dado percorre até o arquivo regulatório
  CAMADAS: Object.freeze(['ORIGEM', 'ANALITICO', 'CONSOLIDADO', 'LAYOUT']),
  HEADERS: Object.freeze({
    DD_Regulatorios: ['cod', 'nome', 'regulador', 'escopo', 'area', 'periodicidade', 'prazo', 'estado', 'condicao', 'sistemaFonte', 'formaEnvio', 'manualidade', 'ownerDado', 'reportOwner', 'responsavelEnvio', 'areaReportOwner', 'tipoReport', 'baseNormativa', 'respLegal', 'diretor', 'nDados', 'nCde', 'dimensoes', 'auditoria', 'armAtual', 'armAlvo', 'link'],
    DD_Campos: ['id', 'codReporte', 'reporte', 'bloco', 'dado', 'atributo', 'origem', 'sistemaFonte', 'campoOrigem', 'regra', 'definicao', 'cde', 'area',
      'dataOwner', 'ownerConfirmado', 'slo', 'reportOwner', 'statusAda', 'campoAda', 'origemAda', 'observacoes', 'idElemento', 'outrosRegs', 'evidencia', 'status'],
    DD_Quality_Checks: ['id', 'idCampo', 'codReporte', 'tipo', 'descricao', 'base', 'prioridade', 'origem'],
    DD_Lineage: ['id', 'idCampo', 'codReporte', 'camada', 'ordem', 'sistema', 'tabela', 'coluna', 'descricao', 'fonte']
  })
});

/* ============================ ACESSO À PLANILHA ============================ */

function ddObterPlanilha_() {
  const props = PropertiesService.getScriptProperties();
  const idSalvo = props.getProperty(DD_CONFIG.PROP_ID);
  if (idSalvo) {
    try { return SpreadsheetApp.openById(idSalvo); } catch (e) { console.warn('Recriando base do Dicionário...'); }
  }
  const nova = SpreadsheetApp.create(DD_CONFIG.DB_FILENAME);
  props.setProperty(DD_CONFIG.PROP_ID, nova.getId());
  return nova;
}

/* ===================== REGISTROS EXCLUÍDOS PELA TELA ===================== */

/** Lê, por aba, os códigos excluídos pela tela: { DD_Campos: { 'DD-201': true }, ... }. */
function ddLerExcluidos_() {
  const props = PropertiesService.getScriptProperties();
  const exc = {};
  Object.values(DD_CONFIG.SHEETS).forEach(nomeAba => {
    exc[nomeAba] = {};
    String(props.getProperty(DD_CONFIG.PROP_EXCLUIDOS + nomeAba) || '').split(',')
      .filter(Boolean).forEach(id => { exc[nomeAba][id] = true; });
  });
  return exc;
}

/**
 * Guarda os códigos excluídos de uma aba. Só os itens excluídos diretamente entram aqui:
 * os removidos em cascata (campos de um regulatório, checks e lineage de um campo) são
 * reconhecidos por ddFoiExcluido_ pelo regulatório ou pelo campo.
 */
function ddMarcarExcluidos_(nomeAba, ids) {
  const props = PropertiesService.getScriptProperties();
  const chave = DD_CONFIG.PROP_EXCLUIDOS + nomeAba;
  const atuais = String(props.getProperty(chave) || '').split(',').filter(Boolean);
  ids.map(String).forEach(id => { if (atuais.indexOf(id) === -1) atuais.push(id); });
  try {
    props.setProperty(chave, atuais.join(','));
  } catch (e) {
    // Limite de 9 KB por propriedade: a exclusão vale mesmo assim; só uma nova carga inicial poderia trazer o item de volta
    console.warn('Não foi possível registrar os excluídos de ' + nomeAba + ': ' + e.message);
  }
}

/** Um registro recriado com o mesmo código deixa de constar como excluído. */
function ddDesmarcarExcluido_(nomeAba, id) {
  const props = PropertiesService.getScriptProperties();
  const chave = DD_CONFIG.PROP_EXCLUIDOS + nomeAba;
  const atuais = String(props.getProperty(chave) || '').split(',').filter(Boolean);
  const pos = atuais.indexOf(String(id));
  if (pos === -1) return;
  atuais.splice(pos, 1);
  props.setProperty(chave, atuais.join(','));
}

/** O registro da carga inicial foi excluído pela tela (ele próprio, o seu regulatório ou o seu campo)? */
function ddFoiExcluido_(nomeAba, registro, exc) {
  const s = DD_CONFIG.SHEETS;
  if (exc[nomeAba][String(registro[DD_CONFIG.CHAVES[nomeAba]])]) return true;
  if (nomeAba !== s.REGS && registro.codReporte && exc[s.REGS][String(registro.codReporte)]) return true;
  if ((nomeAba === s.CHECKS || nomeAba === s.LINEAGE) && registro.idCampo && exc[s.CAMPOS][String(registro.idCampo)]) return true;
  return false;
}

/** Carga inicial: DD_SEED_DADOS_ é gerada pelo build.js a partir do bloco DD_SEED de Dicionario.html. */
function ddLerSeed_() {
  if (typeof DD_SEED_DADOS_ !== 'undefined') return DD_SEED_DADOS_;
  return { regs: [], campos: [], checks: [], lineage: [] };
}

/**
 * Atualiza uma vez uma planilha que já existia com a revisão mais nova da carga inicial
 * (bloco "atualizacao" do DD_SEED): cria colunas novas, atualiza só as colunas listadas
 * (o resto do que foi editado é mantido), inclui registros novos e remove os retirados.
 * @return {boolean} true se alterou a planilha.
 */
function ddAplicarAtualizacao_(ss) {
  const seed = ddLerSeed_();
  const atual = seed.atualizacao;
  if (!atual) return false;
  const props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty(DD_CONFIG.PROP_VERSAO_CARGA) || 1) >= atual.versao) return false;

  // Sem lock próprio: quem grava já segura o lock do script, e a atualização pode rodar de novo sem efeito
  {
    const s = DD_CONFIG.SHEETS;
    const listaSeed = { DD_Regulatorios: seed.regs, DD_Campos: seed.campos, DD_Quality_Checks: seed.checks, DD_Lineage: seed.lineage };
    const exc = ddLerExcluidos_();
    Object.values(s).forEach(nomeAba => {
      const sheet = ss.getSheetByName(nomeAba);
      if (!sheet) return;
      const chave = DD_CONFIG.CHAVES[nomeAba];
      const valores = sheet.getDataRange().getValues();
      // 1. Colunas novas entram no fim do cabeçalho
      const cab = valores[0].map(String);
      DD_CONFIG.HEADERS[nomeAba].forEach(c => { if (cab.indexOf(c) === -1) cab.push(c); });
      const iChave = cab.indexOf(chave);
      const remover = {};
      ((atual.remover || {})[nomeAba] || []).forEach(id => { remover[id] = true; });
      // 2. Remove os retirados
      let linhas = valores.slice(1)
        .map(l => cab.map((_, i) => (l[i] === undefined ? '' : l[i])))
        .filter(l => String(l[iChave]) !== '' && !remover[String(l[iChave])]);
      // 3. Atualiza as colunas listadas e inclui os registros novos
      const colunas = (atual.atualizarColunas || {})[nomeAba];
      if (colunas) {
        const pos = {};
        linhas.forEach((l, i) => { pos[String(l[iChave])] = i; });
        listaSeed[nomeAba].forEach(o => {
          if (ddFoiExcluido_(nomeAba, o, exc)) return; // excluído pela tela: não volta
          const k = String(o[chave]);
          if (pos[k] !== undefined) {
            colunas.forEach(c => { linhas[pos[k]][cab.indexOf(c)] = o[c] === undefined ? '' : String(o[c]); });
          } else {
            linhas.push(cab.map(c => (o[c] === undefined || o[c] === null) ? '' : String(o[c])));
          }
        });
      }
      // 4. Regrava a aba inteira de uma vez
      sheet.getRange(1, 1, 1, cab.length).setValues([cab])
        .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
      const ultima = sheet.getLastRow();
      if (ultima > 1) sheet.getRange(2, 1, ultima - 1, sheet.getLastColumn()).clearContent();
      if (linhas.length) sheet.getRange(2, 1, linhas.length, cab.length).setNumberFormat('@').setValues(linhas);
    });
    props.setProperty(DD_CONFIG.PROP_VERSAO_CARGA, String(atual.versao));
    return true;
  }
}

function ddInicializar_() {
  const ss = ddObterPlanilha_();
  const s = DD_CONFIG.SHEETS;
  let seed = null, exc = null, carregou = false;
  [[s.REGS, 'regs'], [s.CAMPOS, 'campos'], [s.CHECKS, 'checks'], [s.LINEAGE, 'lineage']].forEach(par => {
    const nomeAba = par[0];
    const cab = DD_CONFIG.HEADERS[nomeAba];
    let sheet = ss.getSheetByName(nomeAba);
    // Aba já com dados é a fonte da verdade: nunca é sobrescrita
    if (sheet && sheet.getLastRow() > 1) return;
    if (!sheet) {
      sheet = ss.insertSheet(nomeAba);
      sheet.getRange(1, 1, 1, cab.length).setValues([cab])
        .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    seed = seed || ddLerSeed_();
    exc = exc || ddLerExcluidos_();
    const linhas = (seed[par[1]] || []).filter(o => !ddFoiExcluido_(nomeAba, o, exc))
      .map(o => cab.map(c => (o[c] === undefined || o[c] === null) ? '' : String(o[c])));
    if (linhas.length) {
      // Formato texto evita que códigos como "2061" ou "DD-001" sejam convertidos pelo Sheets
      sheet.getRange(2, 1, linhas.length, cab.length).setNumberFormat('@').setValues(linhas);
      carregou = true;
    }
  });
  if (ddAplicarAtualizacao_(ss)) carregou = true;
  // A RAM pode ter guardado as abas vazias ou desatualizadas: recarrega o cache
  if (carregou) {
    Object.values(s).forEach(nomeAba => CacheManager.salvarEntidadePaginada(nomeAba, ddLerAba_(ss, nomeAba), DD_CONFIG.VERSION_KEY));
  }
  return ss;
}

function ddLerAba_(ss, nomeAba) {
  const sheet = ss.getSheetByName(nomeAba);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const valores = sheet.getDataRange().getValues();
  const cab = valores[0];
  return valores.slice(1).filter(l => String(l[0]) !== '').map(l => {
    const o = {};
    cab.forEach((c, i) => { o[c] = l[i] instanceof Date ? Utilities.formatDate(l[i], APP_CONFIG.TIMEZONE, 'yyyy-MM-dd') : String(l[i]); });
    return o;
  });
}

/* ===================== CACHE EM MEMÓRIA DO SERVIDOR (RAM) ===================== */

/** Leitura com cache: RAM do servidor primeiro; se expirou, lê a planilha e recarrega a RAM. */
function ddLerComCache_(nomeAba) {
  let dados = CacheManager.lerEntidadePaginada(nomeAba);
  // Lista vazia também vai à planilha: ddInicializar_ preenche abas que ficaram sem a carga inicial
  if (!dados || !dados.length) {
    dados = ddLerAba_(ddInicializar_(), nomeAba);
    CacheManager.salvarEntidadePaginada(nomeAba, dados, DD_CONFIG.VERSION_KEY);
  }
  return dados;
}

/** Recarrega as 4 abas do Dicionário na RAM. Chamado pelo agendamento de 5 minutos. */
function ddAquecerCache_() {
  const ss = ddInicializar_();
  let versao = 0;
  Object.values(DD_CONFIG.SHEETS).forEach(nomeAba => {
    versao = CacheManager.salvarEntidadePaginada(nomeAba, ddLerAba_(ss, nomeAba), DD_CONFIG.VERSION_KEY);
  });
  return versao;
}

/**
 * Gatilho onEdit da planilha do Dicionário (instalado por instalarGatilhosAutomaticos):
 * edição manual numa aba DD_ recarrega só aquela aba na RAM.
 */
function aoEditarDicionarioManualmente(e) {
  if (!e || !e.range) return;
  const nomeAba = e.range.getSheet().getName();
  if (Object.values(DD_CONFIG.SHEETS).indexOf(nomeAba) === -1) return;
  CacheManager.salvarEntidadePaginada(nomeAba, ddLerAba_(e.source, nomeAba), DD_CONFIG.VERSION_KEY);
}

/**
 * INSERÇÃO/EDIÇÃO EM ORDEM ESTRITA (mesma regra do SheetRepo):
 * 1º Atualiza o Cache de Memória do Servidor (CacheService).
 * 2º Grava a linha na Planilha Google (Sheets).
 * Só grava colunas conhecidas. Na edição, coluna que não veio no registro mantém o valor atual.
 */
function ddGravar_(nomeAba, registro) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = ddInicializar_();
    const sheet = ss.getSheetByName(nomeAba);
    const cab = DD_CONFIG.HEADERS[nomeAba];
    const chave = DD_CONFIG.CHAVES[nomeAba];
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const idx = ids.indexOf(String(registro[chave]));
    const numLinha = idx > -1 ? idx + 2 : sheet.getLastRow() + 1;
    const atual = idx > -1 ? sheet.getRange(numLinha, 1, 1, cab.length).getValues()[0] : [];
    const linha = cab.map((c, i) => registro[c] === undefined && idx > -1 ? String(atual[i]) : texto_(registro[c], 2000));
    const salvo = {};
    cab.forEach((c, i) => { salvo[c] = linha[i]; });
    if (idx === -1) ddDesmarcarExcluido_(nomeAba, salvo[chave]);

    // PASSO 1: Cache de Memória do Servidor (RAM)
    const lista = ddLerComCache_(nomeAba);
    const pos = lista.findIndex(item => String(item[chave]) === String(salvo[chave]));
    if (pos > -1) lista[pos] = salvo; else lista.push(salvo);
    const versao = CacheManager.salvarEntidadePaginada(nomeAba, lista, DD_CONFIG.VERSION_KEY);

    // PASSO 2: Planilha Google (Persistência Física)
    sheet.getRange(numLinha, 1, 1, cab.length).setNumberFormat('@').setValues([linha]);
    SpreadsheetApp.flush();
    return { ok: true, registro: salvo, versaoCache: versao };
  } finally {
    lock.releaseLock();
  }
}

/* ================================ ENDPOINTS ================================ */

/** Estado completo do Dicionário, servido da RAM do servidor (a planilha só é lida se o cache expirou). */
function apiDDObterEstado() {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  const s = DD_CONFIG.SHEETS;
  const estado = {
    usuarioEmail: ctx.email,
    perfil: ctx.perfil,
    podeEditar: AuthService.ehGestao(ctx),
    urlApp: ScriptApp.getService().getUrl(),
    planilhaUrl: ctx.perfil === 'ADMIN' ? ddObterPlanilha_().getUrl() : '',
    regs: ddLerComCache_(s.REGS),
    campos: ddLerComCache_(s.CAMPOS),
    checks: ddLerComCache_(s.CHECKS),
    lineage: ddLerComCache_(s.LINEAGE)
  };
  estado.versaoCache = CacheManager.obterVersaoAtual(DD_CONFIG.VERSION_KEY);
  return estado;
}

/** Polling leve do navegador: só a versão do cache do Dicionário (mesmo padrão de apiVerificarVersaoCache). */
function apiDDVerificarVersaoCache() {
  return { versaoCache: CacheManager.obterVersaoAtual(DD_CONFIG.VERSION_KEY) };
}

/**
 * EXCLUSÃO EM ORDEM ESTRITA, de um ou vários registros em uma ou mais abas:
 * 1º Remove do Cache de Memória do Servidor (CacheService).
 * 2º Remove as linhas na Planilha Google (Sheets).
 * @param {Object} filtros { nomeAba: função(registro) -> true se deve sair }
 * @param {Object} diretos { nomeAba: [códigos] } excluídos diretamente, para a carga inicial não trazê-los de volta
 * @return {{ok: boolean, versaoCache: number, removidos: Object}} removidos = quantidade por aba
 */
function ddExcluirVarios_(filtros, diretos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = ddInicializar_();
    Object.keys(diretos || {}).forEach(nomeAba => ddMarcarExcluidos_(nomeAba, diretos[nomeAba]));

    // PASSO 1: Cache de Memória do Servidor (RAM)
    const removidos = {};
    const codigos = {};
    let versao = CacheManager.obterVersaoAtual(DD_CONFIG.VERSION_KEY);
    Object.keys(filtros).forEach(nomeAba => {
      const chave = DD_CONFIG.CHAVES[nomeAba];
      const lista = ddLerComCache_(nomeAba);
      const sai = lista.filter(filtros[nomeAba]);
      removidos[nomeAba] = sai.length;
      if (!sai.length) return;
      codigos[nomeAba] = {};
      sai.forEach(item => { codigos[nomeAba][String(item[chave])] = true; });
      versao = CacheManager.salvarEntidadePaginada(nomeAba, lista.filter(item => !codigos[nomeAba][String(item[chave])]), DD_CONFIG.VERSION_KEY);
    });

    // PASSO 2: Planilha Google (Persistência Física)
    // Regrava a aba de uma vez: apagar centenas de linhas uma a uma (cascata de um regulatório) seria lento demais
    Object.keys(codigos).forEach(nomeAba => {
      const sheet = ss.getSheetByName(nomeAba);
      if (!sheet || sheet.getLastRow() <= 1) return;
      const valores = sheet.getDataRange().getValues();
      const iChave = valores[0].map(String).indexOf(DD_CONFIG.CHAVES[nomeAba]);
      const manter = valores.slice(1).filter(l => String(l[0]) !== '' && !codigos[nomeAba][String(l[iChave])]);
      if (manter.length === valores.length - 1) return;
      sheet.getRange(2, 1, valores.length - 1, valores[0].length).clearContent();
      if (manter.length) sheet.getRange(2, 1, manter.length, valores[0].length).setNumberFormat('@').setValues(manter);
    });
    SpreadsheetApp.flush();
    return { ok: true, versaoCache: versao, removidos };
  } finally {
    lock.releaseLock();
  }
}

/** Exclusão de um único registro pelo código (data quality check ou passo de lineage). */
function ddExcluir_(nomeAba, idRegistro) {
  const chave = DD_CONFIG.CHAVES[nomeAba];
  const filtros = {};
  filtros[nomeAba] = item => String(item[chave]) === String(idRegistro);
  const diretos = {};
  diretos[nomeAba] = [String(idRegistro)];
  return ddExcluirVarios_(filtros, diretos);
}

/** Cadastro/edição de regulatório (inventário). Somente Gestor ou Admin. */
function apiDDSalvarRegulatorio(reg) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  reg = reg || {};
  if (!/^[A-Za-z0-9_.-]{1,20}$/.test(String(reg.cod || ''))) throw new Error('Código do regulatório inválido.');
  if (!texto_(reg.nome, 300)) throw new Error('Informe o nome do reporte.');
  reg.estado = enum_(reg.estado, ['Reportando', 'Em andamento', 'Condicional', 'Não aplicável'], 'Reportando');
  return ddGravar_(DD_CONFIG.SHEETS.REGS, reg);
}

/** Cadastro/edição de campo (lineage, CDE, Data Owner). Somente Gestor ou Admin. */
function apiDDSalvarCampo(campo) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  campo = campo || {};
  if (!/^DD-[A-Za-z0-9-]{1,20}$/.test(String(campo.id || ''))) throw new Error('Identificador do campo inválido.');
  if (!texto_(campo.dado, 300)) throw new Error('Informe o nome do dado.');
  campo.cde = campo.cde === 'Sim' ? 'Sim' : 'Não';
  return ddGravar_(DD_CONFIG.SHEETS.CAMPOS, campo);
}

/**
 * Exclui um campo junto com os seus data quality checks e o seu lineage. Somente Gestor ou Admin.
 */
function apiDDExcluirCampo(idCampo) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  const id = String(idCampo || '');
  if (!/^DD-[A-Za-z0-9-]{1,20}$/.test(id)) throw new Error('Identificador do campo inválido.');
  const s = DD_CONFIG.SHEETS;
  if (!ddLerComCache_(s.CAMPOS).some(c => String(c.id) === id)) throw new Error('Campo não encontrado: ' + id);
  const filtros = {};
  filtros[s.CAMPOS] = c => String(c.id) === id;
  filtros[s.CHECKS] = k => String(k.idCampo) === id;
  filtros[s.LINEAGE] = l => String(l.idCampo) === id;
  const diretos = {};
  diretos[s.CAMPOS] = [id];
  return ddExcluirVarios_(filtros, diretos);
}

/**
 * Exclui um regulatório junto com todos os seus campos e, deles, os data quality checks e o lineage.
 * Somente Gestor ou Admin.
 */
function apiDDExcluirRegulatorio(codReporte) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  const cod = String(codReporte || '');
  if (!/^[A-Za-z0-9_.-]{1,20}$/.test(cod)) throw new Error('Código do regulatório inválido.');
  const s = DD_CONFIG.SHEETS;
  if (!ddLerComCache_(s.REGS).some(r => String(r.cod) === cod)) throw new Error('Regulatório não encontrado: ' + cod);
  const idsCampos = {};
  ddLerComCache_(s.CAMPOS).forEach(c => { if (String(c.codReporte) === cod) idsCampos[String(c.id)] = true; });
  const doReporte = item => String(item.codReporte) === cod || !!idsCampos[String(item.idCampo)];
  const filtros = {};
  filtros[s.REGS] = r => String(r.cod) === cod;
  filtros[s.CAMPOS] = c => !!idsCampos[String(c.id)];
  filtros[s.CHECKS] = doReporte;
  filtros[s.LINEAGE] = doReporte;
  const diretos = {};
  diretos[s.REGS] = [cod];
  return ddExcluirVarios_(filtros, diretos);
}

/** Data quality check (texto descritivo) de um campo. Qualquer membro cadastrado. */
function apiDDSalvarCheck(check) {
  AuthService.exigirMembro(AuthService.obterContexto());
  check = check || {};
  if (!/^DQ-[A-Za-z0-9-]{1,20}$/.test(String(check.id || ''))) throw new Error('Identificador do check inválido.');
  if (!texto_(check.descricao, 2000)) throw new Error('Descreva o data quality check.');
  return ddGravar_(DD_CONFIG.SHEETS.CHECKS, check);
}

function apiDDExcluirCheck(idCheck) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  return ddExcluir_(DD_CONFIG.SHEETS.CHECKS, idCheck);
}

/** Passo do lineage de um campo (sistema, tabela e coluna). Somente Gestor ou Admin. */
function apiDDSalvarLineage(passo) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  passo = passo || {};
  if (!/^LN-[A-Za-z0-9-]{1,20}$/.test(String(passo.id || ''))) throw new Error('Identificador do passo de lineage inválido.');
  if (!/^DD-[A-Za-z0-9-]{1,20}$/.test(String(passo.idCampo || ''))) throw new Error('Campo do lineage inválido.');
  if (!texto_(passo.sistema, 200)) throw new Error('Informe o sistema deste passo do lineage.');
  passo.camada = enum_(passo.camada, DD_CONFIG.CAMADAS, 'ORIGEM');
  passo.ordem = String(DD_CONFIG.CAMADAS.indexOf(passo.camada) + 1);
  return ddGravar_(DD_CONFIG.SHEETS.LINEAGE, passo);
}

function apiDDExcluirLineage(idPasso) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  return ddExcluir_(DD_CONFIG.SHEETS.LINEAGE, idPasso);
}

/* ===================== PÁGINA INICIAL: ESCOLHA DE MÓDULO ===================== */

function ddPaginaPortal_() {
  const url = ScriptApp.getService().getUrl();
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Hub — Escolha o módulo</title>
<style>
  *{box-sizing:border-box;font-family:'Inter','Segoe UI',Roboto,Helvetica,sans-serif}
  body{margin:0;min-height:100vh;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;padding:24px}
  .wrap{max-width:860px;width:100%}
  h1{font-size:26px;margin:0 0 6px}
  p.sub{color:#94a3b8;margin:0 0 28px;font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
  a.card{display:block;text-decoration:none;color:inherit;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:26px;transition:.15s}
  a.card:hover{border-color:#38bdf8;transform:translateY(-2px)}
  .ico{font-size:34px;margin-bottom:12px}
  .tit{font-size:18px;font-weight:700;margin-bottom:6px;color:#fff}
  .desc{font-size:13px;color:#94a3b8;line-height:1.5}
</style></head><body><div class="wrap">
  <h1>Hub de Gestão</h1>
  <p class="sub">Escolha o módulo que deseja acessar.</p>
  <div class="grid">
    <a class="card" target="_top" href="${url}?modulo=workgroup">
      <div class="ico">⚡</div><div class="tit">Workgroup</div>
      <div class="desc">Times, objetivos, projetos, quadro de tarefas com dependências e rotinas recorrentes.</div>
    </a>
    <a class="card" target="_top" href="${url}?modulo=dicionario">
      <div class="ico">📚</div><div class="tit">Dicionário de Dados</div>
      <div class="desc">Inventário de regulatórios, campos por reporte com lineage, CDEs, Data Owners e data quality checks.</div>
    </a>
  </div>
</div></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .setTitle('Hub — Escolha o módulo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
