/**
 * ============================================================================
 * ARQUIVO: src/Controllers.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Receber as chamadas do navegador (google.script.run), AUTORIZAR
 *           cada uma no servidor, validar os dados recebidos e só então
 *           atualizar Cache do Servidor -> Planilha.
 *
 * REGRAS DE SEGURANÇA DESTE ARQUIVO:
 *  1. Toda função "api..." começa resolvendo o contexto (AuthService.obterContexto)
 *     e exigindo o perfil necessário. O navegador não decide permissão.
 *  2. Nada que venha do payload é confiável: IDs, enums, datas e textos são
 *     validados/normalizados pelos helpers abaixo.
 *  3. Funções terminadas em "_" são privadas: o Apps Script não permite
 *     chamá-las pelo google.script.run.
 * ============================================================================
 */

/* ============================ HELPERS PRIVADOS ============================ */

function texto_(valor, tamanhoMaximo) {
  return String(valor === undefined || valor === null ? '' : valor).trim().slice(0, tamanhoMaximo || 300);
}

function enum_(valor, listaPermitida, valorPadrao) {
  return listaPermitida.indexOf(valor) > -1 ? valor : valorPadrao;
}

function dataISO_(valor, valorPadrao) {
  const v = String(valor || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : valorPadrao;
}

function corHex_(valor) {
  const v = String(valor || '');
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#2563eb';
}

/**
 * Aceita o ID gerado pelo navegador (necessário para a tela otimista) apenas se
 * tiver o formato esperado e ainda não existir; caso contrário recusa a gravação.
 */
function idNovo_(idInformado, prefixo, listaExistente, colunaId) {
  let id = texto_(idInformado, 40);
  if (!id) {
    do { id = Utils.gerarId(prefixo); }
    while (listaExistente.some(x => String(x[colunaId]) === id));
    return id;
  }
  if (!new RegExp('^' + prefixo + '-[A-Za-z0-9-]{1,30}$').test(id)) {
    throw new Error('Identificador inválido.');
  }
  if (listaExistente.some(x => String(x[colunaId]) === id)) {
    throw new Error('Já existe um registro com o código ' + id + '. Tente novamente.');
  }
  return id;
}

function buscarPorId_(nomeAba, colunaId, id) {
  const lista = SheetRepo.obterEntidadeComCache(nomeAba);
  return lista.find(x => String(x[colunaId]) === String(id)) || null;
}

/** Devolve o nome somente se for de um membro cadastrado. */
function nomeDeMembro_(nome, valorPadrao) {
  const n = texto_(nome, 120);
  const membros = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.MEMBROS);
  return membros.some(m => String(m.Nome_Exibicao) === n) ? n : valorPadrao;
}

function idDeTime_(idTime) {
  const id = texto_(idTime, 40);
  const times = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.TIMES);
  if (times.some(t => String(t.ID_Time) === id)) return id;
  return times[0] ? String(times[0].ID_Time) : '';
}

function nomeDeQuemAge_(ctx) {
  return ctx.membro && ctx.membro.Nome_Exibicao ? String(ctx.membro.Nome_Exibicao) : ctx.email;
}

/**
 * Normaliza os campos de uma tarefa vindos do navegador. Projeto e objetivo
 * precisam existir e estar visíveis para quem grava; o time é derivado deles.
 */
function camposDeTarefa_(payload, ctx, idDaPropriaTarefa) {
  const s = APP_CONFIG.SHEETS;
  const hoje = Utils.hojeISO();

  const titulo = texto_(payload.titulo, 300);
  if (!titulo) throw new Error('Informe o título da tarefa.');

  let projeto = payload.idProjeto ? buscarPorId_(s.PROJETOS, 'ID_Projeto', payload.idProjeto) : null;
  if (projeto && !AuthService.usuarioPodeVisualizar(projeto, ctx)) projeto = null;

  const idObjetivoPedido = payload.idObjetivo || (projeto ? projeto.ID_Objetivo : '');
  let objetivo = idObjetivoPedido ? buscarPorId_(s.OBJETIVOS, 'ID_Objetivo', idObjetivoPedido) : null;
  if (objetivo && !AuthService.usuarioPodeVisualizar(objetivo, ctx)) objetivo = null;

  let idPredecessora = '';
  if (payload.dependeDe && String(payload.dependeDe) !== String(idDaPropriaTarefa || '')) {
    const pred = buscarPorId_(s.TAREFAS, 'ID_Tarefa', payload.dependeDe);
    if (pred && AuthService.usuarioPodeVisualizar(pred, ctx)) idPredecessora = String(pred.ID_Tarefa);
  }

  const idTime = (projeto && projeto.ID_Time) || (objetivo && objetivo.ID_Time) || idDeTime_(payload.idTime);

  return {
    Titulo_Tarefa: titulo,
    ID_Projeto: projeto ? String(projeto.ID_Projeto) : '',
    ID_Objetivo: objetivo ? String(objetivo.ID_Objetivo) : '',
    ID_Time: idTime,
    Responsavel: nomeDeMembro_(payload.responsavel, 'Não atribuído'),
    Prioridade: enum_(payload.prioridade, APP_CONFIG.PRIORIDADES, 'Média'),
    Data_Inicio: dataISO_(payload.dataInicio, hoje),
    Data_Prazo: dataISO_(payload.dataPrazo, hoje),
    ID_Tarefa_Predecessora: idPredecessora,
    Tipo_Visibilidade: enum_(payload.tipoVisibilidade, ['PUBLICO', 'TIME', 'RESTRITO'], 'PUBLICO'),
    Usuarios_Permitidos: texto_(Utils.formatListaCsv(payload.usuariosPermitidos), 1000),
    Atualizado_Em: new Date().toISOString()
  };
}

/** Tarefa existente que o usuário pode ver; caso contrário lança erro. */
function tarefaAcessivel_(idTarefa, ctx) {
  const tarefa = buscarPorId_(APP_CONFIG.SHEETS.TAREFAS, 'ID_Tarefa', idTarefa);
  if (!tarefa || !AuthService.usuarioPodeVisualizar(tarefa, ctx)) {
    throw new Error('Tarefa não encontrada ou sem permissão de acesso.');
  }
  return tarefa;
}

/**
 * Monta o estado enviado ao navegador JÁ FILTRADO pelo perfil de quem pediu.
 * Itens que o usuário não pode ver nunca saem do servidor.
 */
function montarEstadoParaContexto_(ctx) {
  const s = APP_CONFIG.SHEETS;
  const times = SheetRepo.obterEntidadeComCache(s.TIMES);
  let membros = SheetRepo.obterEntidadeComCache(s.MEMBROS);
  let objetivos = SheetRepo.obterEntidadeComCache(s.OBJETIVOS);
  let projetos = SheetRepo.obterEntidadeComCache(s.PROJETOS);
  let tarefas = SheetRepo.obterEntidadeComCache(s.TAREFAS);
  let rotinas = SheetRepo.obterEntidadeComCache(s.ROTINAS);
  let historicoRotinas = SheetRepo.obterEntidadeComCache(s.HISTORICO_ROTINAS);

  if (ctx.perfil === 'VISITANTE') {
    membros = []; objetivos = []; projetos = []; tarefas = []; rotinas = []; historicoRotinas = [];
  } else if (!AuthService.ehGestao(ctx)) {
    const podeVer = item => AuthService.usuarioPodeVisualizar(item, ctx);
    objetivos = objetivos.filter(podeVer);
    projetos = projetos.filter(podeVer);
    tarefas = tarefas.filter(podeVer);
    rotinas = rotinas.filter(podeVer);
    const idsRotinasVisiveis = rotinas.map(r => String(r.ID_Rotina));
    historicoRotinas = historicoRotinas.filter(h => idsRotinasVisiveis.indexOf(String(h.ID_Rotina)) > -1);
    // Perfil TIME precisa dos nomes (para escolher responsáveis), mas não dos e-mails dos colegas
    membros = membros.map(m => {
      const ehEuMesmo = ctx.membro && String(m.ID_Membro) === String(ctx.membro.ID_Membro);
      return {
        ID_Membro: m.ID_Membro,
        Nome_Exibicao: m.Nome_Exibicao,
        Email_Google: ehEuMesmo ? m.Email_Google : '',
        ID_Time_Principal: m.ID_Time_Principal,
        Perfil_Acesso: m.Perfil_Acesso
      };
    });
  }

  const ehAdmin = ctx.perfil === 'ADMIN';
  let planilhaUrl = '';
  let planilhaId = '';
  if (ehAdmin) {
    const planilha = SheetRepo.obterPlanilha();
    planilhaUrl = planilha.getUrl();
    planilhaId = planilha.getId();
  }

  return {
    versaoCache: CacheManager.obterVersaoAtual(),
    usuarioEmail: ctx.email,
    membroLogado: ctx.membro,
    perfilEfetivo: ctx.perfil,
    cotaEmail: NotificationService.obterCotaRestante(),
    agendamentoCache: obterStatusAgendamentoCache(),
    planilhaUrl,
    planilhaId,
    times,
    membros,
    objetivos,
    projetos,
    tarefas,
    rotinas,
    historicoRotinas
  };
}

/* ============================ LEITURA DE ESTADO ============================ */

function apiObterEstadoCompleto() {
  SheetRepo.inicializarBancoSeNecessario();
  return montarEstadoParaContexto_(AuthService.obterContexto());
}

function apiVerificarVersaoCache() {
  return {
    versaoCache: CacheManager.obterVersaoAtual()
  };
}

/**
 * Vincula a Conta Google de quem está logado a um cadastro da equipe.
 * O e-mail vem SEMPRE da sessão Google (nunca do navegador) e o cadastro
 * criado aqui recebe perfil TIME; só o dono do app nasce como ADMIN.
 */
function apiVincularMeuEmailGoogle(nomeExibicao, idTime) {
  SheetRepo.inicializarBancoSeNecessario();
  const ctx = AuthService.obterContexto();
  if (!ctx.email) {
    throw new Error('Não foi possível identificar sua Conta Google. Acesse com a conta corporativa.');
  }
  if (ctx.membro) {
    return montarEstadoParaContexto_(ctx); // já vinculado: nada a fazer
  }

  const nome = texto_(nomeExibicao, 120);
  if (!nome) throw new Error('Informe o seu nome de exibição.');

  const membros = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.MEMBROS);
  const existente = membros.find(m =>
    String(m.Nome_Exibicao || '').trim().toLowerCase() === nome.toLowerCase()
  );

  if (existente) {
    const emailAtual = String(existente.Email_Google || '').trim();
    const perfilExistente = AuthService.normalizarPerfil(existente.Perfil_Acesso);
    if (emailAtual || (perfilExistente !== 'TIME' && !ctx.ehDono)) {
      throw new Error('O cadastro "' + nome + '" já pertence a outra conta. Peça a um Admin ou Gestor para ajustar seu e-mail.');
    }
    SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.MEMBROS, 'ID_Membro', existente.ID_Membro, {
      Email_Google: ctx.email
    });
  } else {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.MEMBROS, {
      ID_Membro: idNovo_('', 'MEM', membros, 'ID_Membro'),
      Nome_Exibicao: nome,
      Email_Google: ctx.email,
      ID_Time_Principal: idDeTime_(idTime),
      Perfil_Acesso: ctx.ehDono ? 'ADMIN' : 'TIME'
    });
  }

  return montarEstadoParaContexto_(AuthService.obterContexto());
}

/* ================================ TAREFAS ================================ */

function apiCriarTarefa(payload) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  payload = payload || {};
  const tarefas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.TAREFAS);

  const novaLinha = camposDeTarefa_(payload, ctx, '');
  novaLinha.ID_Tarefa = idNovo_(payload.idTarefa, 'ATV', tarefas, 'ID_Tarefa');
  novaLinha.Tipo_Demanda = texto_(payload.tipoDemanda, 80) || 'Entrega de Projeto';
  novaLinha.Status = enum_(payload.status, APP_CONFIG.STATUS_TAREFA, 'A Fazer');
  if (novaLinha.Status === 'Concluído' && novaLinha.ID_Tarefa_Predecessora) novaLinha.Status = 'A Fazer';

  const res = SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TAREFAS, novaLinha);
  return { ok: true, versaoCache: res.versao };
}

function apiSalvarEdicaoTarefa(payload) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  payload = payload || {};
  const tarefa = tarefaAcessivel_(payload.idTarefa, ctx);

  const campos = camposDeTarefa_(payload, ctx, tarefa.ID_Tarefa);
  const res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.TAREFAS, 'ID_Tarefa', tarefa.ID_Tarefa, campos);
  return { ok: true, versaoCache: res.versao };
}

function apiAtualizarStatusTarefa(idTarefa, novoStatus) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  if (APP_CONFIG.STATUS_TAREFA.indexOf(novoStatus) === -1) {
    throw new Error('Status inválido.');
  }
  const tarefaAlvo = tarefaAcessivel_(idTarefa, ctx);
  const todasTarefas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.TAREFAS);

  if (novoStatus === 'Concluído' && tarefaAlvo.ID_Tarefa_Predecessora) {
    const pred = todasTarefas.find(p => String(p.ID_Tarefa) === String(tarefaAlvo.ID_Tarefa_Predecessora));
    if (pred && pred.Status !== 'Concluído') {
      throw new Error(`DEPENDÊNCIA BLOQUEADA: Conclua primeiro [${pred.ID_Tarefa}] "${pred.Titulo_Tarefa}".`);
    }
  }

  const res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.TAREFAS, 'ID_Tarefa', tarefaAlvo.ID_Tarefa, {
    Status: novoStatus,
    Atualizado_Em: new Date().toISOString()
  });

  if (novoStatus === 'Concluído') {
    const membros = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.MEMBROS);
    NotificationService.notificarDesbloqueioDeDependencias(tarefaAlvo.ID_Tarefa, todasTarefas, membros);
  }

  return { ok: true, versaoCache: res.versao, cotaEmail: NotificationService.obterCotaRestante() };
}

/* ================================ EXCLUSÃO ================================ */

/**
 * Exclui TAREFA, ROTINA, MEMBRO, TIME, OBJETIVO ou PROJETO, conforme o perfil:
 *  - TAREFA / ROTINA: responsável, Gestor ou Admin
 *  - OBJETIVO / PROJETO / MEMBRO: Gestor ou Admin (Gestor não remove Admin)
 *  - TIME: somente Admin
 */
function apiExcluirItem(tipoEntidade, idItem) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  const s = APP_CONFIG.SHEETS;
  let res;

  if (tipoEntidade === 'TAREFA') {
    const tarefa = tarefaAcessivel_(idItem, ctx);
    if (!AuthService.ehGestao(ctx) && !AuthService.itemPertenceAoUsuario(tarefa, ctx.membro, ctx.email)) {
      throw new Error('ACESSO NEGADO: só o responsável, um Gestor ou Admin pode excluir esta tarefa.');
    }
    res = SheetRepo.excluirRegistroPorId(s.TAREFAS, 'ID_Tarefa', tarefa.ID_Tarefa);
  } else if (tipoEntidade === 'ROTINA') {
    const rotina = buscarPorId_(s.ROTINAS, 'ID_Rotina', idItem);
    if (!rotina || !AuthService.usuarioPodeOperarRotina(rotina, ctx)) {
      throw new Error('ACESSO NEGADO: só o responsável, um Gestor ou Admin pode excluir esta rotina.');
    }
    res = SheetRepo.excluirRegistroPorId(s.ROTINAS, 'ID_Rotina', rotina.ID_Rotina);
  } else if (tipoEntidade === 'MEMBRO') {
    AuthService.exigirPerfil(ctx, ['ADMIN', 'GESTOR']);
    const alvo = buscarPorId_(s.MEMBROS, 'ID_Membro', idItem);
    if (!alvo) throw new Error('Usuário não encontrado.');
    if (ctx.membro && String(alvo.ID_Membro) === String(ctx.membro.ID_Membro)) {
      throw new Error('Você não pode excluir o seu próprio usuário.');
    }
    if (AuthService.normalizarPerfil(alvo.Perfil_Acesso) === 'ADMIN' && ctx.perfil !== 'ADMIN') {
      throw new Error('ACESSO NEGADO: somente um Admin pode excluir outro Admin.');
    }
    res = SheetRepo.excluirRegistroPorId(s.MEMBROS, 'ID_Membro', alvo.ID_Membro);
  } else if (tipoEntidade === 'TIME') {
    AuthService.exigirPerfil(ctx, ['ADMIN']);
    res = SheetRepo.excluirRegistroPorId(s.TIMES, 'ID_Time', idItem);
  } else if (tipoEntidade === 'OBJETIVO') {
    AuthService.exigirPerfil(ctx, ['ADMIN', 'GESTOR']);
    res = SheetRepo.excluirRegistroPorId(s.OBJETIVOS, 'ID_Objetivo', idItem);
  } else if (tipoEntidade === 'PROJETO') {
    AuthService.exigirPerfil(ctx, ['ADMIN', 'GESTOR']);
    res = SheetRepo.excluirRegistroPorId(s.PROJETOS, 'ID_Projeto', idItem);
  } else {
    throw new Error('Tipo de item inválido.');
  }

  return { ok: true, versaoCache: res.versao };
}

/* ================================ ROTINAS ================================ */

/** Rotina existente que o usuário pode operar; caso contrário lança erro. */
function rotinaOperavel_(idRotina, ctx) {
  const rot = buscarPorId_(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', idRotina);
  if (!rot) throw new Error('Rotina não encontrada.');
  if (!AuthService.usuarioPodeOperarRotina(rot, ctx)) {
    throw new Error('ACESSO NEGADO: só o responsável, um Gestor ou Admin pode atualizar esta rotina.');
  }
  return rot;
}

/**
 * 1º clique = Check, 2º clique = Finalizar. Quem agiu, a data/hora e a próxima
 * execução são definidos pelo servidor (não pelo navegador).
 */
function apiAvancarCliqueRotina(payload) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  payload = payload || {};
  const rot = rotinaOperavel_(payload.idRotina, ctx);
  const idRotina = rot.ID_Rotina;

  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  const obsTexto = texto_(payload.observacaoRapida, 1000) || texto_(rot.Ultima_Descricao, 1000) || 'Verificado sem observações.';

  if (payload.novoStatus === 'Check') {
    const res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', idRotina, {
      Status_Ciclo: 'Check',
      Ultima_Descricao: obsTexto,
      Ultima_Execucao: agora
    });
    return { ok: true, versaoCache: res.versao };
  }
  if (payload.novoStatus !== 'Finalizada') {
    throw new Error('Ação de rotina inválida.');
  }

  const historico = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.HISTORICO_ROTINAS);
  let idLog;
  try {
    idLog = idNovo_(payload.idLog, 'LOG', historico, 'ID_Log');
  } catch (e) {
    idLog = idNovo_('', 'LOG', historico, 'ID_Log');
  }

  SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.HISTORICO_ROTINAS, {
    ID_Log: idLog,
    ID_Rotina: rot.ID_Rotina,
    Titulo_Rotina: rot.Titulo_Rotina,
    Responsavel: `${rot.Responsavel} (por ${nomeDeQuemAge_(ctx)})`,
    Data_Hora_Registro: agora,
    Descricao_Informada: obsTexto,
    Resumo_Checklist: `Finalizada (${rot.Frequencia})`
  });

  let res;
  if (rot.Frequencia === 'Pontual') {
    res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', idRotina, {
      Status_Ciclo: 'Finalizada',
      Ultima_Descricao: obsTexto,
      Ultima_Execucao: agora
    });
  } else {
    res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', idRotina, {
      Status_Ciclo: 'Pendente',
      Proxima_Execucao: Utils.calcularProximaDataRotina(rot.Proxima_Execucao, rot.Frequencia),
      Ultima_Descricao: `[Concluída em ${agora}] ${obsTexto}`,
      Ultima_Execucao: agora
    });
  }

  return { ok: true, versaoCache: res.versao };
}

function apiSalvarObservacaoRotina(idRotina, observacaoRapida) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  const rot = rotinaOperavel_(idRotina, ctx);
  const res = SheetRepo.aplicarPatchNaLinha(APP_CONFIG.SHEETS.ROTINAS, 'ID_Rotina', rot.ID_Rotina, {
    Ultima_Descricao: texto_(observacaoRapida, 1000)
  });
  return { ok: true, versaoCache: res.versao };
}

function apiCriarRotina(payload) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  payload = payload || {};
  const titulo = texto_(payload.titulo, 300);
  if (!titulo) throw new Error('Informe o título da rotina.');
  const rotinas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.ROTINAS);

  const res = SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.ROTINAS, {
    ID_Rotina: idNovo_(payload.idRotina, 'ROT', rotinas, 'ID_Rotina'),
    Titulo_Rotina: titulo,
    ID_Time: idDeTime_(payload.idTime),
    Responsavel: nomeDeMembro_(payload.responsavel, nomeDeQuemAge_(ctx)),
    Frequencia: enum_(payload.frequencia, APP_CONFIG.FREQUENCIAS, 'Diária'),
    Proxima_Execucao: dataISO_(payload.dataInicio, Utils.hojeISO()),
    Status_Ciclo: 'Pendente',
    Checklist_Amigavel: texto_(payload.detalhes, 1000) || 'Verificar rotina e registrar observação.',
    Ultima_Descricao: texto_(payload.observacaoInicial, 1000),
    Ultima_Execucao: '-',
    Tipo_Visibilidade: 'PUBLICO',
    Usuarios_Permitidos: ''
  });
  return { ok: true, versaoCache: res.versao };
}

/* ================== ESTRUTURA: TIME, MEMBRO, OBJETIVO, PROJETO ================== */

/**
 * Criar e editar, conforme o perfil:
 *  - TIME (área): somente Admin
 *  - MEMBRO: Gestor ou Admin (Gestor não cria, edita nem promove Admin)
 *  - OBJETIVO / PROJETO: qualquer membro cadastrado, desde que possa ver o item
 */
function apiCriarItemEstrutura(tipo, payload) {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  payload = payload || {};
  const s = APP_CONFIG.SHEETS;
  let res;

  if (tipo === 'TIME') {
    AuthService.exigirPerfil(ctx, ['ADMIN']);
    const nome = texto_(payload.nome, 120);
    const sigla = texto_(payload.sigla, 12);
    if (!nome || !sigla) throw new Error('Preencha nome e sigla da área.');

    if (payload.idTimeEdicao) {
      if (!buscarPorId_(s.TIMES, 'ID_Time', payload.idTimeEdicao)) throw new Error('Área não encontrada.');
      res = SheetRepo.aplicarPatchNaLinha(s.TIMES, 'ID_Time', payload.idTimeEdicao, {
        Nome_Time: nome,
        Sigla: sigla,
        Cor_Hex: corHex_(payload.cor)
      });
    } else {
      const times = SheetRepo.obterEntidadeComCache(s.TIMES);
      res = SheetRepo.inserirRegistro(s.TIMES, {
        ID_Time: idNovo_(payload.idGerado, 'TM', times, 'ID_Time'),
        Nome_Time: nome,
        Sigla: sigla,
        Cor_Hex: corHex_(payload.cor),
        Ativo: 'SIM'
      });
    }
  } else if (tipo === 'MEMBRO') {
    AuthService.exigirPerfil(ctx, ['ADMIN', 'GESTOR']);
    const membros = SheetRepo.obterEntidadeComCache(s.MEMBROS);
    const nome = texto_(payload.nome, 120);
    const email = texto_(payload.email, 200).toLowerCase();
    const perfil = enum_(payload.perfil, APP_CONFIG.PERFIS, 'TIME');
    if (!nome) throw new Error('Informe o nome de exibição.');
    if (!/^[^\s@,<>"']+@[^\s@,<>"']+\.[^\s@,<>"']+$/.test(email)) throw new Error('E-mail inválido.');
    if (perfil === 'ADMIN' && ctx.perfil !== 'ADMIN') {
      throw new Error('ACESSO NEGADO: somente um Admin pode conceder o perfil Admin.');
    }

    const idEdicao = payload.idMembroEdicao ? String(payload.idMembroEdicao) : '';
    const conflito = membros.find(m => String(m.ID_Membro) !== idEdicao && (
      String(m.Nome_Exibicao || '').trim().toLowerCase() === nome.toLowerCase() ||
      String(m.Email_Google || '').trim().toLowerCase() === email
    ));
    if (conflito) throw new Error('Já existe um usuário com este nome ou e-mail.');

    if (idEdicao) {
      const alvo = membros.find(m => String(m.ID_Membro) === idEdicao);
      if (!alvo) throw new Error('Usuário não encontrado.');
      if (AuthService.normalizarPerfil(alvo.Perfil_Acesso) === 'ADMIN' && ctx.perfil !== 'ADMIN') {
        throw new Error('ACESSO NEGADO: somente um Admin pode editar outro Admin.');
      }
      res = SheetRepo.aplicarPatchNaLinha(s.MEMBROS, 'ID_Membro', idEdicao, {
        Nome_Exibicao: nome,
        Email_Google: email,
        ID_Time_Principal: idDeTime_(payload.idTime),
        Perfil_Acesso: perfil
      });
    } else {
      res = SheetRepo.inserirRegistro(s.MEMBROS, {
        ID_Membro: idNovo_(payload.idGerado, 'MEM', membros, 'ID_Membro'),
        Nome_Exibicao: nome,
        Email_Google: email,
        ID_Time_Principal: idDeTime_(payload.idTime),
        Perfil_Acesso: perfil
      });
    }
  } else if (tipo === 'OBJETIVO') {
    const titulo = texto_(payload.titulo, 300);
    if (!titulo) throw new Error('Informe o título do objetivo.');
    const campos = {
      ID_Time: idDeTime_(payload.idTime),
      Titulo_Objetivo: titulo,
      Meta_Indicador: texto_(payload.meta, 300),
      Tipo_Visibilidade: enum_(payload.visibilidade, ['PUBLICO', 'TIME'], 'PUBLICO')
    };

    if (payload.idObjetivoEdicao) {
      const atual = buscarPorId_(s.OBJETIVOS, 'ID_Objetivo', payload.idObjetivoEdicao);
      if (!atual || !AuthService.usuarioPodeVisualizar(atual, ctx)) {
        throw new Error('Objetivo não encontrado ou sem permissão de acesso.');
      }
      res = SheetRepo.aplicarPatchNaLinha(s.OBJETIVOS, 'ID_Objetivo', atual.ID_Objetivo, campos);
    } else {
      const objetivos = SheetRepo.obterEntidadeComCache(s.OBJETIVOS);
      campos.ID_Objetivo = idNovo_(payload.idGerado, 'OBJ', objetivos, 'ID_Objetivo');
      campos.Usuarios_Permitidos = '';
      res = SheetRepo.inserirRegistro(s.OBJETIVOS, campos);
    }
  } else if (tipo === 'PROJETO') {
    const nome = texto_(payload.nome, 300);
    if (!nome) throw new Error('Informe o nome do projeto.');
    const objetivo = buscarPorId_(s.OBJETIVOS, 'ID_Objetivo', payload.idObjetivo);
    if (!objetivo || !AuthService.usuarioPodeVisualizar(objetivo, ctx)) {
      throw new Error('Selecione um objetivo válido para o projeto.');
    }
    const campos = {
      Nome_Projeto: nome,
      ID_Objetivo: String(objetivo.ID_Objetivo),
      ID_Time: String(objetivo.ID_Time || idDeTime_(payload.idTime)),
      Lider: nomeDeMembro_(payload.lider, ''),
      Tipo_Visibilidade: enum_(payload.visibilidade, ['PUBLICO', 'TIME'], 'PUBLICO')
    };

    if (payload.idProjetoEdicao) {
      const atual = buscarPorId_(s.PROJETOS, 'ID_Projeto', payload.idProjetoEdicao);
      if (!atual || !AuthService.usuarioPodeVisualizar(atual, ctx)) {
        throw new Error('Projeto não encontrado ou sem permissão de acesso.');
      }
      res = SheetRepo.aplicarPatchNaLinha(s.PROJETOS, 'ID_Projeto', atual.ID_Projeto, campos);
    } else {
      const projetos = SheetRepo.obterEntidadeComCache(s.PROJETOS);
      campos.ID_Projeto = idNovo_(payload.idGerado, 'PRJ', projetos, 'ID_Projeto');
      campos.Usuarios_Permitidos = '';
      res = SheetRepo.inserirRegistro(s.PROJETOS, campos);
    }
  } else {
    throw new Error('Tipo de item inválido.');
  }

  return { ok: true, versaoCache: res.versao };
}

/* ====================== AÇÕES ADMINISTRATIVAS (SÓ ADMIN) ====================== */

function apiConfigurarAgendamentoCache(intervaloMinutos) {
  const ctx = AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN']);
  instalarGatilhosAutomaticos(intervaloMinutos);
  return montarEstadoParaContexto_(ctx);
}

function apiAplicarPresetArea(codigoPreset) {
  const ctx = AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN']);
  const hoje = Utils.hojeISO();
  const idsPorPreset = { CONTABIL: 'TM-FIN', ONBOARDING: 'TM-KYC', UAT: 'TM-QA' };
  const idTime = idsPorPreset[codigoPreset];
  if (!idTime) throw new Error('Preset inválido.');
  if (buscarPorId_(APP_CONFIG.SHEETS.TIMES, 'ID_Time', idTime)) {
    throw new Error('Este preset já foi aplicado (a área ' + idTime + ' já existe).');
  }

  if (codigoPreset === 'CONTABIL') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TIMES, { ID_Time: idTime, Nome_Time: 'Finanças & Fechamento Contábil', Sigla: 'FIN', Cor_Hex: '#0284c7', Ativo: 'SIM' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.OBJETIVOS, { ID_Objetivo: 'OBJ-FIN1', ID_Time: idTime, Titulo_Objetivo: 'Reduzir prazo do fechamento mensal para D+3', Meta_Indicador: 'Fechamento em 3 dias úteis', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.PROJETOS, { ID_Projeto: 'PRJ-FIN1', Nome_Projeto: 'Automação de Reconciliação Bancária', ID_Objetivo: 'OBJ-FIN1', ID_Time: idTime, Lider: 'Rafael (PMO)', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.ROTINAS, { ID_Rotina: Utils.gerarId('ROT'), Titulo_Rotina: 'Conferência Diária de Saldos e Conciliação', ID_Time: idTime, Responsavel: 'Beatriz (Data)', Frequencia: 'Diária', Proxima_Execucao: hoje, Status_Ciclo: 'Pendente', Checklist_Amigavel: 'Validar saldos bancários, conferir partidas pendentes e emitir relatório.', Ultima_Descricao: '', Ultima_Execucao: '-', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
  } else if (codigoPreset === 'ONBOARDING') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TIMES, { ID_Time: idTime, Nome_Time: 'Onboarding Corporativo & KYC', Sigla: 'KYC', Cor_Hex: '#0d9488', Ativo: 'SIM' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.OBJETIVOS, { ID_Objetivo: 'OBJ-KYC1', ID_Time: idTime, Titulo_Objetivo: 'Acelerar SLA de Onboarding de Clientes Corporativos', Meta_Indicador: 'SLA < 5 dias úteis', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.PROJETOS, { ID_Projeto: 'PRJ-KYC1', Nome_Projeto: 'Extração Inteligente de Contratos e Procurações', ID_Objetivo: 'OBJ-KYC1', ID_Time: idTime, Lider: 'Lucas (AI)', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
  } else if (codigoPreset === 'UAT') {
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.TIMES, { ID_Time: idTime, Nome_Time: 'Ambientes de Teste & Homologação UAT', Sigla: 'UAT', Cor_Hex: '#e11d48', Ativo: 'SIM' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.OBJETIVOS, { ID_Objetivo: 'OBJ-UAT1', ID_Time: idTime, Titulo_Objetivo: 'Garantir disponibilidade e estabilidade de pré-produção', Meta_Indicador: '99% uptime em UAT', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
    SheetRepo.inserirRegistro(APP_CONFIG.SHEETS.PROJETOS, { ID_Projeto: 'PRJ-UAT1', Nome_Projeto: 'Gestão de Janelas de Teste e SLA de Vendors', ID_Objetivo: 'OBJ-UAT1', ID_Time: idTime, Lider: 'Camila (Transf)', Tipo_Visibilidade: 'PUBLICO', Usuarios_Permitidos: '' });
  }

  return montarEstadoParaContexto_(ctx);
}

function apiInserirFormulaGeminiPlanilha() {
  AuthService.exigirPerfil(AuthService.obterContexto(), ['ADMIN']);
  const ss = SheetRepo.obterPlanilha();
  let abaIA = ss.getSheetByName('IA_Gemini_Workspace');
  if (!abaIA) {
    abaIA = ss.insertSheet('IA_Gemini_Workspace');
    abaIA.appendRow(['Data_Solicitacao', 'Contexto_Analisado', 'Formula_Nativa_Gemini_Sheets']);
    abaIA.getRange(1, 1, 1, 3).setFontWeight('bold')
      .setBackground('#4f46e5')
      .setFontColor('#ffffff');
    abaIA.setFrozenRows(1);
  }

  const tarefas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.TAREFAS);
  const rotinas = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.ROTINAS);
  const abertas = tarefas.filter(t => t.Status !== 'Concluído');
  const pendentes = abertas.map(t => `[${t.ID_Tarefa}] ${t.Titulo_Tarefa} (${t.Responsavel})`).join('; ');
  const resumoContexto = `Tarefas abertas (${abertas.length}): ${pendentes}. Rotinas ativas: ${rotinas.length}.`;

  const novaLinhaIdx = abaIA.getLastRow() + 1;
  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm');
  abaIA.getRange(novaLinhaIdx, 1).setValue(agora);
  abaIA.getRange(novaLinhaIdx, 2).setValue(resumoContexto);

  try {
    abaIA.getRange(novaLinhaIdx, 3).setFormula(`=AI("Crie um resumo executivo curto com os principais focos e riscos para o time com base nestes dados: " & B${novaLinhaIdx})`);
  } catch (e) {
    abaIA.getRange(novaLinhaIdx, 3).setValue('Para ativar o Gemini nativo na célula, use: =AI("Resuma os riscos: " & B' + novaLinhaIdx + ')');
  }

  return {
    sucesso: true,
    mensagem: `Aba "IA_Gemini_Workspace" atualizada na linha ${novaLinhaIdx} da sua planilha com a fórmula =AI()!`,
    planilhaUrl: ss.getUrl()
  };
}

/** Botão "Sincronizar Sheets ➔ Cache": qualquer membro cadastrado pode pedir. */
function apiForcarRecargaCache() {
  const ctx = AuthService.exigirMembro(AuthService.obterContexto());
  CacheManager.aquecerTodoOCache();
  const agora = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('CACHE_LAST_WARMUP', agora);
  return montarEstadoParaContexto_(ctx);
}
