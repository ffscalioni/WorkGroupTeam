/**
 * ============================================================================
 * ARQUIVO: Controllers.gs
 * OBJETIVO: Funções globais chamadas pelo navegador via google.script.run
 *           sem recarregar a página (Zero-Refresh).
 * ============================================================================
 */

/**
 * Carrega o pacote inicial completo a partir do Cache em Memória RAM do Servidor.
 */
function apiObterEstadoCompleto() {
  SheetRepo.inicializarBancoSeNecessario();
  const s = APP_CONFIG.SHEETS;

  const times = SheetRepo.obterEntidadeComCache(s.TIMES);
  const membros = SheetRepo.obterEntidadeComCache(s.MEMBROS);
  const objetivos = SheetRepo.obterEntidadeComCache(s.OBJETIVOS);
  const projetos = SheetRepo.obterEntidadeComCache(s.PROJETOS);
  const tarefas = SheetRepo.obterEntidadeComCache(s.TAREFAS);
  const rotinasBrutas = SheetRepo.obterEntidadeComCache(s.ROTINAS);
  const historicoRotinas = SheetRepo.obterEntidadeComCache(s.HISTORICO_ROTINAS);

  // Converte a coluna Checklist_Amigavel ("[x] Passo 1 | [ ] Passo 2") em array para a UI
  const rotinas = rotinasBrutas.map(r => {
    const copia = Object.assign({}, r);
    copia.checklist = Utils.parseChecklistFromSheet(r.Checklist_Amigavel);
    return copia;
  });

  return {
    versaoCache: CacheManager.obterVersaoAtual(),
    usuarioEmail: AuthService.obterEmailUsuarioAtivo(),
    cotaEmail: NotificationService.obterCotaRestante(),
    times,
    membros,
    objetivos,
    projetos,
    tarefas,
    rotinas,
    historicoRotinas
  };
}

/**
 * Endpoint ultraleve (Polling de 30s) que verifica apenas se o timestamp do cache mudou.
 */
function apiVerificarVersaoCache() {
  return {
    versaoCache: CacheManager.obterVersaoAtual()
  };
}

/**
 * Cria uma nova tarefa na aba DB_Tarefas e atualiza o Cache Paginado.
 */
function apiCriarTarefa(payload) {
  const hoje = Utils.hojeISO();
  const novaLinha = {
    ID_Tarefa: Utils.gerarId('ATV'),
    Titulo_Tarefa: payload.titulo,
    ID_Projeto: payload.idProjeto,
    ID_Objetivo: payload.idObjetivo,
    ID_Time: payload.idTime,
    Tipo_Demanda: payload.tipoDemanda || 'Entrega de Projeto',
    Responsavel: payload.responsavel || 'Não atribuído',
    Status: payload.status || 'A Fazer',
    Prioridade: payload.prioridade || 'Média',
    Data_Inicio: payload.dataInicio || hoje,
    Data_Prazo: payload.dataPrazo || hoje,
    ID_Tarefa_Predecessora: payload.dependeDe || '',
    Tipo_Visibilidade: payload.tipoVisibilidade || 'PUBLICO',
    Usuarios_Permitidos: Utils.formatListaCsv(payload.usuariosPermitidos),
    Atualizado_Em: new Date().toISOString()
  };

  SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TAREFAS, novaLinha);
  return apiObterEstadoCompleto();
}

/**
 * Atualiza o status de uma tarefa via Patch Parcial, validando dependências e disparando alerta.
 */
function apiAtualizarStatusTarefa(idTarefa, novoStatus) {
  const todasTarefas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.TAREFAS);
  const tarefaAlvo = todasTarefas.find(t => String(t.ID_Tarefa) === String(idTarefa));

  if (tarefaAlvo && novoStatus === 'Concluído' && tarefaAlvo.ID_Tarefa_Predecessora) {
    const pred = todasTarefas.find(p => String(p.ID_Tarefa) === String(tarefaAlvo.ID_Tarefa_Predecessora));
    if (pred && pred.Status !== 'Concluído') {
      throw new Error(`DEPENDÊNCIA BLOQUEADA: Conclua primeiro [${pred.ID_Tarefa}] "${pred.Titulo_Tarefa}".`);
    }
  }

  SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.TAREFAS, 'ID_Tarefa', idTarefa, {
    Status: novoStatus,
    Atualizado_Em: new Date().toISOString()
  });

  if (novoStatus === 'Concluído') {
    const membros = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.MEMBROS);
    NotificationService.notificarDesbloqueioDeDependencias(idTarefa, todasTarefas, membros);
  }

  return apiObterEstadoCompleto();
}

/**
 * Registra a conclusão de um ciclo de rotina com descrição obrigatória e avança a data.
 */
function apiRegistrarCicloRotina(idRotina, checklistAtualizado, descricaoExecucao) {
  const rotinas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.ROTINAS);
  const rot = rotinas.find(r => String(r.ID_Rotina) === String(idRotina));
  if (!rot) throw new Error('Rotina não encontrada.');

  const checklistFinal = (checklistAtualizado || []).map(i => ({ texto: i.texto, feito: true }));
  const textoAmigavel = Utils.formatChecklistToSheet(checklistFinal);
  const proximaData = Utils.calcularProximaDataRotina(rot.Proxima_Execucao, rot.Frequencia);
  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');

  SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', idRotina, {
    Status_Ciclo: 'Feito no Ciclo',
    Proxima_Execucao: proximaData,
    Checklist_Amigavel: textoAmigavel,
    Ultima_Descricao: descricaoExecucao,
    Ultima_Execucao: agora
  });

  SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.HISTORICO_ROTINAS, {
    ID_Log: Utils.gerarId('LOG'),
    ID_Rotina: rot.ID_Rotina,
    Titulo_Rotina: rot.Titulo_Rotina,
    Responsavel: rot.Responsavel,
    Data_Hora_Registro: agora,
    Descricao_Informada: descricaoExecucao,
    Resumo_Checklist: `${checklistFinal.length}/${checklistFinal.length} itens concluídos`
  });

  return apiObterEstadoCompleto();
}

/**
 * Cria uma nova rotina recorrente com checklist amigável na planilha.
 */
function apiCriarRotina(payload) {
  const checklistLista = (payload.passos || []).map(texto => ({ texto, feito: false }));
  SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.ROTINAS, {
    ID_Rotina: Utils.gerarId('ROT'),
    Titulo_Rotina: payload.titulo,
    ID_Time: payload.idTime,
    Responsavel: payload.responsavel,
    Frequencia: payload.frequencia || 'Semanal',
    Proxima_Execucao: payload.proximaData || Utils.hojeISO(),
    Status_Ciclo: 'Pendente no Ciclo',
    Checklist_Amigavel: Utils.formatChecklistToSheet(checklistLista),
    Ultima_Descricao: 'Rotina cadastrada.',
    Ultima_Execucao: '-',
    Tipo_Visibilidade: 'PUBLICO',
    Usuarios_Permitidos: ''
  });
  return apiObterEstadoCompleto();
}

/**
 * Cria novo Time, Objetivo ou Projeto na configuração multi-times.
 */
function apiCriarItemEstrutura(tipo, payload) {
  if (tipo === 'TIME') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TIMES, {
      ID_Time: Utils.gerarId('TM'),
      Nome_Time: payload.nome,
      Sigla: payload.sigla,
      Cor_Hex: payload.cor || '#2563eb',
      Ativo: 'SIM'
    });
  } else if (tipo === 'OBJETIVO') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.OBJETIVOS, {
      ID_Objetivo: Utils.gerarId('OBJ'),
      ID_Time: payload.idTime,
      Titulo_Objetivo: payload.titulo,
      Meta_Indicador: payload.meta,
      Tipo_Visibilidade: 'PUBLICO',
      Usuarios_Permitidos: ''
    });
  } else if (tipo === 'PROJETO') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.PROJETOS, {
      ID_Projeto: Utils.gerarId('PRJ'),
      Nome_Projeto: payload.nome,
      ID_Objetivo: payload.idObjetivo,
      ID_Time: payload.idTime,
      Lider: payload.lider,
      Tipo_Visibilidade: 'PUBLICO',
      Usuarios_Permitidos: ''
    });
  }
  return apiObterEstadoCompleto();
}

/**
 * Força a sincronização imediata da Planilha para o Cache em Memória RAM.
 */
function apiForcarRecargaCache() {
  CacheManager.aquecerTodoOCache();
  return apiObterEstadoCompleto();
}
