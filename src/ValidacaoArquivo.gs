/**
 * ============================================================================
 * ARQUIVO: src/ValidacaoArquivo.gs (ARQUIVO COMPLETO)
 * MÓDULO: Dicionário de Dados Regulatórios — aba "🧪 Validar arquivo"
 * OBJETIVO: Backend da validação de arquivos regulatórios (ex.: CADOC 3040).
 *
 *   - O XML é lido e validado SÓ NO NAVEGADOR (em partes): o arquivo nunca
 *     sobe para o servidor. Aqui chegam apenas as regras e o resumo do resultado.
 *   - Regras executáveis: coluna regraExec de DD_Quality_Checks (JSON). Versão 2: expressões
 *     (escopo, filtro, teste/unico/grupo) avaliadas no navegador por um interpretador próprio, sem eval.
 *     A versão 1 (tipo/elemento/atributo) continua aceita.
 *   - Só os data quality checks de campos CDE entram na validação.
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
  // Tipos de regra executável da versão 1 (o motor fica em Dicionario.html)
  TIPOS: Object.freeze(['obrigatorio', 'dominio', 'regex', 'data', 'numero', 'tamanho', 'digitos', 'unico', 'manual']),
  STATUS: Object.freeze(['OK', 'FALHA', 'ALERTA', 'N/A', 'ERRO', 'NÃO EXECUTADA']),
  MAX_VERIFICACOES: 600,
  MAX_CATALOGO: 1500,
  MAX_EXEMPLOS: 10
});

/* ============================ REGRAS EXECUTÁVEIS ============================ */

/**
 * Valida e normaliza uma regra executável: objeto ou lista (até 10 partes), versão 1 (tipo/elemento/atributo)
 * ou versão 2 (expressões). As expressões só são interpretadas no navegador; aqui valida forma e tamanho.
 * Retorna o JSON normalizado (texto) ou '' para limpar a regra.
 */
function valNormalizarRegra_(regra) {
  if (regra === '' || regra === null || regra === undefined) return '';
  if (typeof regra === 'string') {
    try { regra = JSON.parse(regra); } catch (e) { throw new Error('Regra executável não é um JSON válido.'); }
  }
  const lista = Array.isArray(regra) ? regra : [regra];
  if (!lista.length || lista.length > 10) throw new Error('A regra deve ter de 1 a 10 partes.');
  const nomeOk = v => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(String(v || ''));
  const expr = (v, campo) => {
    const s = String(v);
    if (s.length > 1000) throw new Error('Expressão muito longa em ' + campo + ' (máx. 1000 caracteres).');
    return s;
  };
  const limpa = lista.map(r => {
    if (!r || typeof r !== 'object') throw new Error('Regra executável inválida.');
    if (r.manual === true || r.tipo === 'manual') {
      return Number(r.v) === 2 ? { v: 2, manual: true, categoria: texto_(r.categoria || 'Sem regra definida', 60), motivo: texto_(r.motivo, 300) }
        : { tipo: 'manual', motivo: texto_(r.motivo, 300) };
    }
    if (Number(r.v) === 2) {
      const o = { v: 2 };
      ['nome', 'entidade', 'esperado', 'nota'].forEach(k => { if (r[k] !== undefined && r[k] !== '') o[k] = texto_(r[k], k === 'nota' ? 400 : 200); });
      o.escopo = r.escopo === undefined || r.escopo === '' ? '*' : String(r.escopo);
      if (o.escopo !== '*' && !nomeOk(o.escopo)) throw new Error('Escopo inválido na regra: ' + o.escopo);
      if (r.atributo !== undefined && r.atributo !== '') {
        if (!nomeOk(r.atributo)) throw new Error('Atributo do XML inválido na regra.');
        o.atributo = String(r.atributo);
      }
      if (o.escopo === '*' && !o.atributo) throw new Error('Com escopo "*" informe o atributo.');
      ['filtro', 'teste', 'unico', 'chave', 'encontrado'].forEach(k => { if (r[k] !== undefined && r[k] !== '') o[k] = expr(r[k], k); });
      if (r.grupo) {
        if (!r.grupo.por || !r.grupo.conta) throw new Error('O grupo precisa de "por" e "conta".');
        o.grupo = { por: expr(r.grupo.por, 'grupo.por'), conta: expr(r.grupo.conta, 'grupo.conta') };
      }
      if (!o.teste && !o.unico) throw new Error('Informe "teste" ou "unico" na regra.');
      return o;
    }
    const tipo = String(r.tipo || '');
    if (VAL_CONFIG.TIPOS.indexOf(tipo) === -1) throw new Error('Tipo de regra desconhecido: ' + tipo);
    if (r.elemento !== undefined && r.elemento !== '' && !nomeOk(r.elemento)) throw new Error('Elemento do XML inválido na regra.');
    if (!nomeOk(r.atributo)) throw new Error('Atributo do XML inválido na regra.');
    const o = { tipo, elemento: String(r.elemento || ''), atributo: String(r.atributo) };
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
  if (json.length > 6000) throw new Error('Regra executável muito longa (máx. 6000 caracteres).');
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
  const st = v => VAL_CONFIG.STATUS.indexOf(String(v)) > -1 ? String(v) : 'ERRO';
  const verificacoes = (Array.isArray(r.verificacoes) ? r.verificacoes : []).slice(0, VAL_CONFIG.MAX_VERIFICACOES).map(x => ({
    ids: (Array.isArray(x.ids) ? x.ids : []).slice(0, 20).map(i => texto_(i, 30)), nome: texto_(x.nome, 300), entidade: texto_(x.entidade, 60),
    fonte: texto_(x.fonte, 30), campo: texto_(x.campo, 200), atributo: texto_(x.atributo, 80), tipo: texto_(x.tipo, 60),
    prioridade: texto_(x.prioridade, 20), descricao: texto_(x.descricao, 600), nota: texto_(x.nota, 600), origem: texto_(x.origem, 30),
    status: st(x.status), avaliados: num(x.avaliados), falhas: num(x.falhas),
    exemplos: (Array.isArray(x.exemplos) ? x.exemplos : []).slice(0, VAL_CONFIG.MAX_EXEMPLOS).map(e => ({
      chave: valMascarar_(texto_((e || {}).chave, 200)), encontrado: valMascarar_(texto_((e || {}).encontrado, 200)), esperado: valMascarar_(texto_((e || {}).esperado, 200))
    }))
  }));
  const catalogo = (Array.isArray(r.catalogo) ? r.catalogo : []).slice(0, VAL_CONFIG.MAX_CATALOGO).map(x => ({
    dq: texto_(x.dq, 30), idCampo: texto_(x.idCampo, 30), status: st(x.status), categoria: texto_(x.categoria, 60), motivo: texto_(x.motivo, 300),
    tipo: texto_(x.tipo, 60), descricao: texto_(x.descricao, 600), prioridade: texto_(x.prioridade, 20)
  }));
  const cdes = (Array.isArray(r.cdes) ? r.cdes : []).slice(0, 500).map(c => ({ id: texto_(c.id, 30), dado: texto_(c.dado, 200), atributo: texto_(c.atributo, 80), bloco: texto_(c.bloco, 80) }));
  const estrutura = (Array.isArray(r.estrutura) ? r.estrutura : []).slice(0, 50).map(e => ({
    item: texto_((e || {}).item, 200), ok: (e || {}).ok === true, detalhe: valMascarar_(texto_((e || {}).detalhe, 300))
  }));
  const perimetro = (Array.isArray(r.perimetro) ? r.perimetro : []).slice(0, 40).map(p => ({ rotulo: texto_(p.rotulo, 80), valor: texto_(p.valor, 60) }));
  const k = r.kpis || {};
  const kpis = {};
  ['totOk', 'totAv', 'nDqCde', 'nExec', 'nCampos', 'ok', 'na', 'falha', 'alerta', 'ne'].forEach(c => { kpis[c] = num(k[c]); });
  kpis.conformidade = kpis.totAv ? Math.round(kpis.totOk / kpis.totAv * 1000) / 10 : 0;
  const contagem = {};
  Object.keys(r.contagem || {}).slice(0, 50).forEach(c => { if (/^[A-Za-z0-9_]{1,40}$/.test(c)) contagem[c] = num(r.contagem[c]); });
  return {
    codReporte: texto_(r.codReporte, 20), nomeReporte: texto_(r.nomeReporte, 200), arquivo: texto_(r.arquivo, 200), remessa: texto_(r.remessa, 20),
    tamanhoBytes: num(r.tamanhoBytes), dtBase: texto_(r.dtBase, 20), totalRegistros: num(r.totalRegistros), duracaoSeg: num(r.duracaoSeg),
    contagem, estrutura, perimetro, kpis, cdes, catalogo, verificacoes
  };
}

/** PDF no mesmo formato do relatório da tela (e do relatório do script Python do 3040). */
function valHtmlRelatorio_(v, meta) {
  const e = valEscHtml_;
  const k = v.kpis;
  const n = x => Number(x || 0).toLocaleString('pt-BR');
  const cls = { 'OK': 'OK', 'FALHA': 'FALHA', 'ALERTA': 'ALERTA', 'N/A': 'NA', 'ERRO': 'ERRO', 'NÃO EXECUTADA': 'NE' };
  const pill = s => '<span class="pill ' + (cls[s] || 'NE') + '">' + e(s) + '</span>';
  const dims = {};
  v.verificacoes.filter(x => ['OK', 'FALHA', 'ALERTA'].indexOf(x.status) > -1).forEach(x => {
    const d = dims[x.tipo] = dims[x.tipo] || [0, 0];
    d[0] += x.avaliados; d[1] += x.avaliados - x.falhas;
  });
  const linhasDim = Object.keys(dims).filter(d => dims[d][0]).map(d => '<tr><td>' + e(d) + '</td><td class="num">' + (dims[d][1] / dims[d][0] * 100).toFixed(1) + '%</td></tr>').join('');
  const linhasCde = v.cdes.map(c => {
    const q = v.catalogo.filter(x => x.idCampo === c.id);
    const ex = q.filter(x => ['OK', 'FALHA', 'ALERTA', 'N/A'].indexOf(x.status) > -1).length;
    const pior = q.some(x => x.status === 'FALHA') ? 'FALHA' : q.some(x => x.status === 'ALERTA') ? 'ALERTA' : ex ? 'OK' : 'NÃO EXECUTADA';
    return '<tr><td>' + pill(pior) + '</td><td>' + e(c.id) + '</td><td><b>' + e(c.dado) + '</b><br><small>' + e(c.atributo) + '</small></td><td>' + e(c.bloco) +
      '</td><td class="num">' + q.length + '</td><td class="num">' + ex + '</td><td>' + q.map(x => '<span class="chip ' + (cls[x.status] || 'NE') + '">' + e(x.dq) + '</span>').join(' ') + '</td></tr>';
  }).join('');
  const ordem = { 'ERRO': 0, 'FALHA': 1, 'ALERTA': 2, 'OK': 3, 'N/A': 4, 'NÃO EXECUTADA': 5 };
  const linhas = v.verificacoes.slice().sort((a, b) => ordem[a.status] - ordem[b.status] || b.falhas - a.falhas).map(x => {
    const pct = x.avaliados ? (x.avaliados - x.falhas) / x.avaliados * 100 : 0;
    const ocorr = x.exemplos.length ? '<table class="inner"><tr><th>Chave</th><th>Encontrado</th><th>Esperado</th></tr>' +
      x.exemplos.map(o => '<tr><td>' + e(o.chave) + '</td><td>' + e(o.encontrado) + '</td><td>' + e(o.esperado) + '</td></tr>').join('') + '</table>' +
      (x.falhas > x.exemplos.length ? '<small>… e mais ' + n(x.falhas - x.exemplos.length) + ' registro(s).</small>' : '') : '';
    return '<tr><td>' + pill(x.status) + '</td><td>' + x.ids.map(e).join(' ') + '</td><td><b>' + e(x.nome) + '</b>' +
      (x.descricao ? '<br><small>Dicionário: ' + e(x.descricao) + '</small>' : '') + (x.nota ? '<br><small class="nota">' + e(x.nota) + '</small>' : '') + ocorr +
      '</td><td>' + e(x.entidade) + '</td><td>' + e(x.campo || '—') + '<br><small>' + e(x.atributo) + '</small></td><td>' + e(x.tipo) + '</td><td>' + e(x.prioridade) +
      '</td><td class="num">' + n(x.avaliados) + '</td><td class="num">' + n(x.falhas) + '</td><td class="num">' + pct.toFixed(1) + '%</td></tr>';
  }).join('');
  const ne = v.catalogo.filter(x => x.status === 'NÃO EXECUTADA').sort((a, b) => a.categoria.localeCompare(b.categoria) || a.dq.localeCompare(b.dq));
  const linhasNe = ne.map(x => '<tr><td>' + e(x.categoria) + '</td><td>' + e(x.dq) + '</td><td>' + e(x.idCampo) + '</td><td>' + e(x.descricao || '(sem descrição)') + '</td><td>' + e(x.motivo) + '</td></tr>').join('');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:9.5px;color:#1d2433;margin:20px}' +
    '.hd{background:#004481;color:#fff;padding:12px 14px;margin-bottom:12px} .hd h1{font-size:15px;margin:0 0 3px} .hd div{font-size:10px}' +
    'h2{font-size:12px;margin:16px 0 6px;color:#004481;border-bottom:1px solid #cbd5e1;padding-bottom:3px}' +
    'table{border-collapse:collapse;width:100%} th,td{border:1px solid #d6dbe3;padding:3px 5px;vertical-align:top;text-align:left} th{background:#f1f4f8;font-size:8.5px;text-transform:uppercase}' +
    '.num{text-align:right} small{color:#6b7385} .nota{color:#7a4f00} .kp td{font-size:10.5px} .kp b{font-size:14px}' +
    '.pill,.chip{display:inline-block;padding:1px 6px;border-radius:8px;font-size:8.5px;font-weight:bold;color:#fff}' +
    '.OK{background:#1f8a5b}.FALHA{background:#c23b3b}.ALERTA{background:#c27c0e}.NA{background:#8a93a6}.ERRO{background:#000}.NE{background:#fff;color:#5b6b8c;border:1px dashed #5b6b8c}' +
    'table.inner{margin-top:4px} table.inner td,table.inner th{font-size:8.5px}' +
    '</style></head><body>' +
    '<div class="hd"><h1>Data Quality · ' + e(v.codReporte) + (v.nomeReporte ? ' — ' + e(v.nomeReporte) : '') + '</h1>' +
    '<div>Data-base <b>' + e(v.dtBase || '-') + '</b> · XML: ' + e(v.arquivo) + (v.remessa ? ' (remessa ' + e(v.remessa) + ')' : '') +
    ' · Registro ' + e(meta.id) + ' · ' + e(meta.dataHora) + ' · por ' + e(meta.usuario) + ' · Resultado: <b>' + e(meta.status) + '</b></div></div>' +
    '<table class="kp"><tr>' +
    '<td>Conformidade das verificações<br><b>' + k.conformidade.toFixed(1) + '%</b><br><small>' + n(k.totOk) + ' de ' + n(k.totAv) + ' registros avaliados</small></td>' +
    '<td>Cobertura dos DQs de CDE<br><b>' + k.nExec + '/' + k.nDqCde + '</b><br><small>' + k.nCampos + ' campos CDE</small></td>' +
    '<td>DQs CDE OK<br><b>' + k.ok + '</b><br><small>+ ' + k.na + ' N/A</small></td>' +
    '<td>DQs CDE com falha<br><b>' + k.falha + '</b></td><td>DQs CDE em alerta<br><b>' + k.alerta + '</b></td>' +
    '<td>DQs CDE não executados<br><b>' + k.ne + '</b></td></tr></table>' +
    '<h2>Estrutura do arquivo</h2><table><tr><th>Verificação</th><th>Situação</th><th>Detalhe</th></tr>' +
    v.estrutura.map(x => '<tr><td>' + e(x.item) + '</td><td>' + pill(x.ok ? 'OK' : 'FALHA') + '</td><td>' + e(x.detalhe) + '</td></tr>').join('') + '</table>' +
    '<h2>Perímetro avaliado e conformidade por dimensão</h2><table><tr><td style="width:50%;border:none;padding:0 6px 0 0"><table>' +
    v.perimetro.map(p => '<tr><td>' + e(p.rotulo) + '</td><td class="num">' + e(p.valor) + '</td></tr>').join('') +
    '</table></td><td style="border:none;padding:0"><table><tr><th>Dimensão</th><th>% OK</th></tr>' + linhasDim + '</table></td></tr></table>' +
    '<h2>Cobertura por campo CDE</h2><table><tr><th>Status</th><th>Campo</th><th>Dado</th><th>Bloco</th><th>DQs</th><th>Executados</th><th>Regras do Dicionário</th></tr>' + linhasCde + '</table>' +
    '<h2>Resultado por verificação</h2><table><tr><th>Status</th><th>DQs</th><th>Critério</th><th>Entidade</th><th>Campo</th><th>Dimensão</th><th>Prioridade</th><th>Avaliados</th><th>Falhas</th><th>% OK</th></tr>' + linhas + '</table>' +
    '<h2>DQs não executados e motivo</h2>' + (linhasNe ? '<table><tr><th>Categoria</th><th>DQ</th><th>Campo</th><th>Regra no Dicionário</th><th>Motivo</th></tr>' + linhasNe + '</table>' : '<small>Todos os DQs de CDE foram executados.</small>') +
    '<p><small>O arquivo foi lido apenas no navegador de quem validou; este relatório contém só o resumo e até ' + VAL_CONFIG.MAX_EXEMPLOS +
    ' ocorrências por verificação, com CPF/CNPJ mascarados. Status: FALHA = prioridade Alta com ocorrências; ALERTA = prioridade Média/Baixa com ocorrências; N/A = nenhum registro aplicável.</small></p>' +
    '</body></html>';
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
  const comErro = v.verificacoes.filter(x => x.status === 'FALHA' || x.status === 'ALERTA' || x.status === 'ERRO');
  const meta = {
    id: 'VAL-' + Utilities.formatDate(agora, APP_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + Math.floor(100 + Math.random() * 900),
    dataHora: Utilities.formatDate(agora, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    usuario: ctx.email,
    totalOcorrencias: v.verificacoes.reduce((s, x) => s + x.falhas, 0)
  };
  const estruturaOk = v.estrutura.every(x => x.ok);
  meta.status = estruturaOk && !comErro.length ? 'Aprovado' : 'Com erros';

  // PDF no Drive (pasta própria do módulo, criada no 1º uso e guardada nas Script Properties)
  const nomeBase = `${v.codReporte} - ${v.arquivo.replace(/\.[^.]+$/, '')} - ${meta.id}`.replace(/[\\/:*?"<>|]/g, '_');
  const pdf = Utilities.newBlob(valHtmlRelatorio_(v, meta), MimeType.HTML, nomeBase + '.html').getAs(MimeType.PDF).setName(nomeBase + '.pdf');
  const arquivoPdf = valObterPasta_().createFile(pdf);

  const registro = {
    id: meta.id, dataHora: meta.dataHora, usuario: meta.usuario, codReporte: v.codReporte, arquivo: v.arquivo,
    tamanhoBytes: String(v.tamanhoBytes), dtBase: v.dtBase, totalRegistros: String(v.totalRegistros),
    regrasExecutadas: String(v.kpis.nExec), regrasComErro: String(comErro.length),
    regrasNaoExecutadas: String(v.kpis.ne), totalOcorrencias: String(meta.totalOcorrencias),
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
