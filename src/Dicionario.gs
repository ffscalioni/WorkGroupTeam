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
    DD_Regulatorios: ['cod', 'nome', 'regulador', 'escopo', 'area', 'periodicidade', 'prazo', 'estado', 'condicao', 'sistemaFonte', 'formaEnvio', 'manualidade', 'ownerDado', 'reportOwner', 'respLegal', 'diretor', 'nDados', 'nCde', 'dimensoes', 'auditoria', 'armAtual', 'armAlvo', 'link'],
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

/** Carga inicial: DD_SEED_DADOS_ é gerada pelo build.js a partir do bloco DD_SEED de Dicionario.html. */
function ddLerSeed_() {
  if (typeof DD_SEED_DADOS_ !== 'undefined') return DD_SEED_DADOS_;
  return { regs: [], campos: [], checks: [], lineage: [] };
}

function ddInicializar_() {
  const ss = ddObterPlanilha_();
  const s = DD_CONFIG.SHEETS;
  let seed = null, carregou = false;
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
    const linhas = (seed[par[1]] || []).map(o => cab.map(c => (o[c] === undefined || o[c] === null) ? '' : String(o[c])));
    if (linhas.length) {
      // Formato texto evita que códigos como "2061" ou "DD-001" sejam convertidos pelo Sheets
      sheet.getRange(2, 1, linhas.length, cab.length).setNumberFormat('@').setValues(linhas);
      carregou = true;
    }
  });
  // A RAM pode ter guardado as abas vazias: recarrega o cache com a carga inicial
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
 * EXCLUSÃO EM ORDEM ESTRITA:
 * 1º Remove do Cache de Memória do Servidor (CacheService).
 * 2º Remove a linha na Planilha Google (Sheets), pela chave da 1ª coluna.
 */
function ddExcluir_(nomeAba, idRegistro) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const chave = DD_CONFIG.CHAVES[nomeAba];

    // PASSO 1: Cache de Memória do Servidor (RAM)
    const lista = ddLerComCache_(nomeAba).filter(item => String(item[chave]) !== String(idRegistro));
    const versao = CacheManager.salvarEntidadePaginada(nomeAba, lista, DD_CONFIG.VERSION_KEY);

    // PASSO 2: Planilha Google (Persistência Física)
    const sheet = ddInicializar_().getSheetByName(nomeAba);
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const idx = ids.indexOf(String(idRegistro));
    if (idx > -1) sheet.deleteRow(idx + 2);
    SpreadsheetApp.flush();
    return { ok: true, versaoCache: versao };
  } finally {
    lock.releaseLock();
  }
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
