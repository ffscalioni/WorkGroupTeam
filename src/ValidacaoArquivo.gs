/**
 * ============================================================================
 * ARQUIVO: src/ValidacaoArquivo.gs (ARQUIVO COMPLETO)
 * MÓDULO: Dicionário de Dados Regulatórios — aba "🧪 Validar arquivo"
 * OBJETIVO: Backend da validação de arquivos regulatórios (ex.: CADOC 3040).
 *
 *   - O XML é lido e validado SÓ NO NAVEGADOR (em partes): o arquivo nunca
 *     sobe para o servidor. Aqui chegam apenas as regras e o resumo do resultado.
 *   - Regras executáveis: coluna regraExec de DD_Quality_Checks (JSON).
 *   - Cada validação registrada gera um PDF no Drive, na pasta
 *     "DD - Validações de Arquivos Regulatórios", e uma linha na aba DD_Validacoes
 *     da planilha do Dicionário.
 *
 * Mesmo padrão de gravação do restante do Dicionário:
 *   1º Cache de Memória do Servidor (CacheService)  2º Planilha Google (Sheets)
 * e mesma chave de versão de cache (DD_CONFIG.VERSION_KEY).
 * ============================================================================
 */
const VAL_CONFIG = Object.freeze({
  SHEET: 'DD_Validacoes',
  PASTA_NOME: 'DD - Validações de Arquivos Regulatórios',
  PROP_PASTA: 'DD_VAL_PASTA_ID',
  HEADERS: ['id', 'dataHora', 'usuario', 'codReporte', 'arquivo', 'tamanhoBytes', 'dtBase', 'totalRegistros',
    'regrasExecutadas', 'regrasComErro', 'regrasNaoExecutadas', 'totalOcorrencias', 'status', 'pdfUrl', 'pdfId'],
  // Tipos de regra executável aceitos (o motor fica em Dicionario.html)
  TIPOS: Object.freeze(['obrigatorio', 'dominio', 'regex', 'data', 'numero', 'tamanho', 'digitos', 'unico', 'manual']),
  MAX_REGRAS_RESUMO: 600,
  MAX_EXEMPLOS: 5
});

/* ============================ REGRAS EXECUTÁVEIS ============================ */

/**
 * Valida e normaliza uma regra executável (objeto ou lista de objetos; todas precisam passar).
 * Retorna o JSON normalizado (texto) ou '' para limpar a regra.
 */
function valNormalizarRegra_(regra) {
  if (regra === '' || regra === null || regra === undefined) return '';
  if (typeof regra === 'string') {
    try { regra = JSON.parse(regra); } catch (e) { throw new Error('Regra executável não é um JSON válido.'); }
  }
  const lista = Array.isArray(regra) ? regra : [regra];
  if (!lista.length || lista.length > 10) throw new Error('A regra deve ter de 1 a 10 condições.');
  const nomeOk = v => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(String(v || ''));
  const limpa = lista.map(r => {
    if (!r || typeof r !== 'object') throw new Error('Regra executável inválida.');
    const tipo = String(r.tipo || '');
    if (VAL_CONFIG.TIPOS.indexOf(tipo) === -1) throw new Error('Tipo de regra desconhecido: ' + tipo);
    if (tipo === 'manual') return { tipo, motivo: texto_(r.motivo, 300) };
    if (!nomeOk(r.elemento)) throw new Error('Elemento do XML inválido na regra.');
    if (!nomeOk(r.atributo)) throw new Error('Atributo do XML inválido na regra.');
    const o = { tipo, elemento: String(r.elemento), atributo: String(r.atributo) };
    if (r.obrigatorio === true) o.obrigatorio = true;
    if (r.lista === true) o.lista = true;
    if (tipo === 'dominio' || tipo === 'digitos') {
      if (!Array.isArray(r.valores) || !r.valores.length || r.valores.length > 300) throw new Error('Informe os valores da regra ' + tipo + '.');
      o.valores = r.valores.map(v => texto_(v, 40));
      if (tipo === 'digitos' && o.valores.some(v => !/^\d{1,3}$/.test(v))) throw new Error('Quantidade de dígitos inválida.');
    }
    if (tipo === 'regex') {
      o.padrao = texto_(r.padrao, 300);
      try { new RegExp(o.padrao); } catch (e) { throw new Error('Expressão regular inválida: ' + o.padrao); }
    }
    if (tipo === 'data') o.formato = enum_(r.formato, ['AAAA-MM-DD', 'AAAA-MM'], 'AAAA-MM-DD');
    ['min', 'max', 'decimaisMin', 'decimaisMax'].forEach(k => {
      if (r[k] === undefined || r[k] === null || r[k] === '') return;
      const n = Number(r[k]);
      if (!isFinite(n)) throw new Error('Valor numérico inválido em ' + k + '.');
      o[k] = n;
    });
    if (r.quando) {
      if (!nomeOk(String(r.quando.atributo || '').replace(/^[A-Za-z0-9_]+\./, ''))) throw new Error('Condição "quando" inválida.');
      o.quando = { atributo: texto_(r.quando.atributo, 80) };
      if (Array.isArray(r.quando.valores)) o.quando.valores = r.quando.valores.map(v => texto_(v, 40));
    }
    return o;
  });
  const json = JSON.stringify(limpa.length === 1 ? limpa[0] : limpa);
  if (json.length > 2000) throw new Error('Regra executável muito longa (máx. 2000 caracteres).');
  return json;
}

/**
 * Grava a coluna regraExec de vários checks de uma vez, em ordem estrita:
 * 1º RAM do servidor, 2º planilha (só a coluna regraExec das linhas alteradas).
 */
function valGravarRegras_(itens) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = DD_CONFIG.SHEETS;
    const ss = ddInicializar_();
    const novos = {};
    itens.forEach(it => { novos[String(it.id)] = it.regraExec; });

    // PASSO 1: Cache de Memória do Servidor (RAM)
    const lista = ddLerComCache_(s.CHECKS);
    const achados = {};
    lista.forEach(k => {
      if (novos[String(k.id)] === undefined) return;
      k.regraExec = novos[String(k.id)];
      achados[String(k.id)] = true;
    });
    const faltando = Object.keys(novos).filter(id => !achados[id]);
    if (faltando.length) throw new Error('Data quality check não encontrado: ' + faltando.slice(0, 5).join(', '));
    const versao = CacheManager.salvarEntidadePaginada(s.CHECKS, lista, DD_CONFIG.VERSION_KEY);

    // PASSO 2: Planilha Google (Persistência Física)
    const sheet = ss.getSheetByName(s.CHECKS);
    const valores = sheet.getDataRange().getValues();
    const cab = valores[0].map(String);
    const iId = cab.indexOf('id'), iRegra = cab.indexOf('regraExec');
    if (iRegra === -1) throw new Error('A aba ' + s.CHECKS + ' está sem a coluna regraExec.');
    const coluna = valores.slice(1).map(l => [novos[String(l[iId])] !== undefined ? novos[String(l[iId])] : l[iRegra]]);
    if (coluna.length) sheet.getRange(2, iRegra + 1, coluna.length, 1).setNumberFormat('@').setValues(coluna);
    SpreadsheetApp.flush();
    return { ok: true, versaoCache: versao, gravadas: itens.length };
  } finally {
    lock.releaseLock();
  }
}

/** Salva (ou limpa, com regraExec vazio) a regra executável de um data quality check. Somente Gestor ou Admin. */
function apiDDSalvarRegraCheck(idCheck, regraExec) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  const id = String(idCheck || '');
  if (!/^DQ-[A-Za-z0-9-]{1,20}$/.test(id)) throw new Error('Identificador do check inválido.');
  return valGravarRegras_([{ id, regraExec: valNormalizarRegra_(regraExec) }]);
}

/**
 * Salva de uma vez as regras geradas (Gemini Nano ou automáticas) para vários checks.
 * @param {Array<{id: string, regraExec: (string|Object)}>} lista
 */
function apiDDSalvarRegrasEmLote(lista) {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN', 'GESTOR']);
  if (!Array.isArray(lista) || !lista.length) throw new Error('Nenhuma regra para salvar.');
  if (lista.length > 1000) throw new Error('Máximo de 1000 regras por envio.');
  const itens = lista.map(it => {
    const id = String((it || {}).id || '');
    if (!/^DQ-[A-Za-z0-9-]{1,20}$/.test(id)) throw new Error('Identificador do check inválido: ' + id);
    return { id, regraExec: valNormalizarRegra_(it.regraExec) };
  });
  return valGravarRegras_(itens);
}

/* ========================== HISTÓRICO DE VALIDAÇÕES ========================== */

function valObterAba_(ss) {
  let sheet = ss.getSheetByName(VAL_CONFIG.SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VAL_CONFIG.SHEET);
    sheet.getRange(1, 1, 1, VAL_CONFIG.HEADERS.length).setValues([VAL_CONFIG.HEADERS])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Recarrega o histórico na RAM. Chamado por ddAquecerCache_ (agendamento) e pelo onEdit do Dicionário. */
function valAquecerCache_(ss) {
  if (!ss.getSheetByName(VAL_CONFIG.SHEET)) return 0;
  return CacheManager.salvarEntidadePaginada(VAL_CONFIG.SHEET, ddLerAba_(ss, VAL_CONFIG.SHEET), DD_CONFIG.VERSION_KEY);
}

function valLerComCache_() {
  let dados = CacheManager.lerEntidadePaginada(VAL_CONFIG.SHEET);
  if (!dados) {
    dados = ddLerAba_(ddObterPlanilha_(), VAL_CONFIG.SHEET);
    CacheManager.salvarEntidadePaginada(VAL_CONFIG.SHEET, dados, DD_CONFIG.VERSION_KEY);
  }
  return dados;
}

/** Histórico das validações registradas (mais recentes primeiro). Qualquer membro cadastrado. */
function apiDDListarValidacoes() {
  AuthService.exigirMembro(AuthService.obterContexto());
  const lista = valLerComCache_().slice().sort((a, b) => String(b.dataHora).localeCompare(String(a.dataHora)));
  return { validacoes: lista, versaoCache: CacheManager.obterVersaoAtual(DD_CONFIG.VERSION_KEY) };
}

/* ============================ REGISTRO + PDF ============================ */

/**
 * Mascara CPF (11), CNPJ (14), radical de CNPJ (8) e sequências longas de dígitos (ex.: dentro do IPOC)
 * antes de gravar ou imprimir. Mesma regra de mascarar() em Dicionario.html.
 */
function valMascarar_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/\d{2,3}\.\d{3}\.\d{3}[\/-]\d{2,4}(-\d{2})?/g, m => m.slice(0, 3) + m.slice(3, -2).replace(/\d/g, '*') + m.slice(-2))
    .replace(/\d+/g, m => (m.length === 8 || m.length === 11 || m.length === 14 || m.length >= 15) ? m.slice(0, 3) + '*'.repeat(m.length - 5) + m.slice(-2) : m);
}

function valEscHtml_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function valObterPasta_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(VAL_CONFIG.PROP_PASTA);
  if (id) {
    try {
      const pasta = DriveApp.getFolderById(id);
      if (!pasta.isTrashed()) return pasta;
    } catch (e) { console.warn('Recriando a pasta de validações...'); }
  }
  const existentes = DriveApp.getFoldersByName(VAL_CONFIG.PASTA_NOME);
  const pasta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(VAL_CONFIG.PASTA_NOME);
  props.setProperty(VAL_CONFIG.PROP_PASTA, pasta.getId());
  return pasta;
}

/** Normaliza o resumo vindo do navegador: limita tamanhos e volta a mascarar os exemplos. */
function valNormalizarResumo_(r) {
  r = r || {};
  const num = v => Math.max(0, Math.floor(Number(v) || 0));
  const regras = (Array.isArray(r.regras) ? r.regras : []).slice(0, VAL_CONFIG.MAX_REGRAS_RESUMO).map(x => ({
    id: texto_(x.id, 30), idCampo: texto_(x.idCampo, 30), dado: texto_(x.dado, 200), atributo: texto_(x.atributo, 80),
    descricao: texto_(x.descricao, 500), origemRegra: texto_(x.origemRegra, 30),
    regra: texto_(x.regra, 300), executada: x.executada === true,
    avaliados: num(x.avaliados), erros: num(x.erros),
    exemplos: (Array.isArray(x.exemplos) ? x.exemplos : []).slice(0, VAL_CONFIG.MAX_EXEMPLOS).map(e => ({
      contexto: valMascarar_(texto_((e || {}).contexto, 300)), valor: valMascarar_(texto_((e || {}).valor, 120)), motivo: texto_((e || {}).motivo, 200)
    }))
  }));
  const estrutura = (Array.isArray(r.estrutura) ? r.estrutura : []).slice(0, 50).map(e => ({
    item: texto_((e || {}).item, 200), ok: (e || {}).ok === true, detalhe: valMascarar_(texto_((e || {}).detalhe, 300))
  }));
  const contagem = {};
  Object.keys(r.contagem || {}).slice(0, 50).forEach(k => { if (/^[A-Za-z0-9_]{1,40}$/.test(k)) contagem[k] = num(r.contagem[k]); });
  return {
    codReporte: texto_(r.codReporte, 20), arquivo: texto_(r.arquivo, 200), tamanhoBytes: num(r.tamanhoBytes),
    dtBase: texto_(r.dtBase, 20), totalRegistros: num(r.totalRegistros), duracaoSeg: num(r.duracaoSeg),
    contagem, estrutura, regras
  };
}

function valHtmlRelatorio_(v, meta) {
  const e = valEscHtml_;
  const exec = v.regras.filter(x => x.executada);
  const comErro = exec.filter(x => x.erros > 0);
  const naoExec = v.regras.filter(x => !x.executada);
  const estruturaOk = v.estrutura.every(x => x.ok);
  const linhasErro = comErro.sort((a, b) => b.erros - a.erros).map(x => `
    <tr><td><b>${e(x.id)}</b><br><small>${e(x.idCampo)}</small></td><td>${e(x.dado)}<br><code>${e(x.atributo)}</code></td>
      <td>${e(x.descricao)}<br><small>Regra (${e(x.origemRegra)}): ${e(x.regra)}</small></td>
      <td style="text-align:right"><b>${x.erros}</b> / ${x.avaliados}</td>
      <td>${x.exemplos.map(ex => `<div class="ex">${e(ex.contexto)} → <code>${e(ex.valor || '(vazio)')}</code> ${e(ex.motivo)}</div>`).join('')}</td></tr>`).join('');
  const linhasOk = exec.filter(x => !x.erros).map(x => `<tr><td>${e(x.id)}</td><td>${e(x.dado)} <code>${e(x.atributo)}</code></td><td>${e(x.descricao)}</td><td style="text-align:right">${x.avaliados}</td></tr>`).join('');
  const linhasNao = naoExec.map(x => `<tr><td>${e(x.id)}</td><td>${e(x.dado)} <code>${e(x.atributo)}</code></td><td>${e(x.descricao)}</td><td>${e(x.regra)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#0f172a;margin:24px}
    h1{font-size:17px;margin:0 0 4px} h2{font-size:12.5px;margin:18px 0 6px;color:#1d4ed8;border-bottom:1px solid #cbd5e1;padding-bottom:3px}
    .mut{color:#64748b} table{border-collapse:collapse;width:100%} th,td{border:1px solid #cbd5e1;padding:4px 5px;vertical-align:top;text-align:left}
    th{background:#f1f5f9;font-size:9px;text-transform:uppercase} code{background:#eef2ff;padding:0 3px}
    .kp td{font-size:11px} .ok{color:#15803d;font-weight:bold} .er{color:#b91c1c;font-weight:bold} .ex{margin-bottom:2px}
  </style></head><body>
    <h1>Validação de arquivo regulatório — ${e(v.codReporte)}</h1>
    <div class="mut">Registro ${e(meta.id)} · ${e(meta.dataHora)} · por ${e(meta.usuario)}</div>
    <h2>Resumo</h2>
    <table class="kp">
      <tr><td>Arquivo</td><td>${e(v.arquivo)} (${(v.tamanhoBytes / 1048576).toFixed(2)} MB)</td><td>Data-base</td><td>${e(v.dtBase || '-')}</td></tr>
      <tr><td>Registros lidos</td><td>${v.totalRegistros}</td><td>Resultado</td><td class="${meta.status === 'Aprovado' ? 'ok' : 'er'}">${e(meta.status)}</td></tr>
      <tr><td>Regras executadas</td><td>${exec.length}</td><td>Regras com erro</td><td>${comErro.length}</td></tr>
      <tr><td>Ocorrências de erro</td><td>${meta.totalOcorrencias}</td><td>Regras não executáveis</td><td>${naoExec.length}</td></tr>
      <tr><td>Elementos</td><td colspan="3">${Object.keys(v.contagem).map(k => e(k) + ': ' + v.contagem[k]).join(' · ')}</td></tr>
    </table>
    <h2>Estrutura do arquivo ${estruturaOk ? '<span class="ok">OK</span>' : '<span class="er">com problemas</span>'}</h2>
    <table><tr><th>Verificação</th><th>Situação</th><th>Detalhe</th></tr>
      ${v.estrutura.map(x => `<tr><td>${e(x.item)}</td><td class="${x.ok ? 'ok' : 'er'}">${x.ok ? 'OK' : 'Falhou'}</td><td>${e(x.detalhe)}</td></tr>`).join('')}</table>
    <h2>Regras com erro (${comErro.length})</h2>
    ${comErro.length ? `<table><tr><th>Check</th><th>Campo</th><th>Descrição / regra</th><th>Erros / avaliados</th><th>Exemplos (CPF/CNPJ mascarados)</th></tr>${linhasErro}</table>` : '<div class="ok">Nenhuma regra executada encontrou erro.</div>'}
    <h2>Regras aprovadas (${exec.length - comErro.length})</h2>
    ${linhasOk ? `<table><tr><th>Check</th><th>Campo</th><th>Descrição</th><th>Avaliados</th></tr>${linhasOk}</table>` : '<div class="mut">—</div>'}
    <h2>Checks não executados automaticamente (${naoExec.length})</h2>
    ${linhasNao ? `<table><tr><th>Check</th><th>Campo</th><th>Descrição</th><th>Motivo</th></tr>${linhasNao}</table>` : '<div class="mut">—</div>'}
    <p class="mut" style="margin-top:18px">O arquivo foi lido apenas no navegador de quem validou; este relatório contém só o resumo e exemplos mascarados.</p>
  </body></html>`;
}

/**
 * Registra uma validação: gera o PDF no Drive e grava uma linha em DD_Validacoes.
 * Qualquer membro cadastrado. Ordem: PDF no Drive → 1º RAM → 2º planilha.
 * @param {Object} resumo resultado montado pelo navegador (sem o conteúdo do arquivo)
 */
function apiDDRegistrarValidacao(resumo) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  const v = valNormalizarResumo_(resumo);
  if (!/^[A-Za-z0-9_.-]{1,20}$/.test(v.codReporte)) throw new Error('Código do regulatório inválido.');
  if (!v.arquivo) throw new Error('Informe o nome do arquivo validado.');

  const agora = new Date();
  const exec = v.regras.filter(x => x.executada);
  const meta = {
    id: 'VAL-' + Utilities.formatDate(agora, APP_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + Math.floor(100 + Math.random() * 900),
    dataHora: Utilities.formatDate(agora, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    usuario: ctx.email,
    totalOcorrencias: exec.reduce((s, x) => s + x.erros, 0)
  };
  const estruturaOk = v.estrutura.every(x => x.ok);
  meta.status = estruturaOk && meta.totalOcorrencias === 0 ? 'Aprovado' : 'Com erros';

  // PDF no Drive (pasta própria do módulo, criada no 1º uso e guardada nas Script Properties)
  const nomeBase = `${v.codReporte} - ${v.arquivo.replace(/\.[^.]+$/, '')} - ${meta.id}`.replace(/[\\/:*?"<>|]/g, '_');
  const pdf = Utilities.newBlob(valHtmlRelatorio_(v, meta), MimeType.HTML, nomeBase + '.html').getAs(MimeType.PDF).setName(nomeBase + '.pdf');
  const arquivoPdf = valObterPasta_().createFile(pdf);

  const registro = {
    id: meta.id, dataHora: meta.dataHora, usuario: meta.usuario, codReporte: v.codReporte, arquivo: v.arquivo,
    tamanhoBytes: String(v.tamanhoBytes), dtBase: v.dtBase, totalRegistros: String(v.totalRegistros),
    regrasExecutadas: String(exec.length), regrasComErro: String(exec.filter(x => x.erros > 0).length),
    regrasNaoExecutadas: String(v.regras.length - exec.length), totalOcorrencias: String(meta.totalOcorrencias),
    status: meta.status, pdfUrl: arquivoPdf.getUrl(), pdfId: arquivoPdf.getId()
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = ddObterPlanilha_();
    const sheet = valObterAba_(ss);
    // PASSO 1: Cache de Memória do Servidor (RAM)
    const lista = valLerComCache_();
    lista.push(registro);
    const versao = CacheManager.salvarEntidadePaginada(VAL_CONFIG.SHEET, lista, DD_CONFIG.VERSION_KEY);
    // PASSO 2: Planilha Google (Persistência Física)
    const cab = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, cab.length).setNumberFormat('@')
      .setValues([cab.map(c => registro[c] === undefined ? '' : String(registro[c]))]);
    SpreadsheetApp.flush();
    return { ok: true, registro, versaoCache: versao };
  } finally {
    lock.releaseLock();
  }
}
