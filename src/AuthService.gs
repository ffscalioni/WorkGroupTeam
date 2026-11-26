/**
 * ============================================================================
 * ARQUIVO: src/AuthService.gs (ARQUIVO COMPLETO)
 * OBJETIVO: Identificar o usuário Google logado, resolver o perfil de acesso
 *           NO SERVIDOR e aplicar as regras de visibilidade e permissão.
 *
 * IMPORTANTE: o navegador nunca é fonte de verdade para permissões. Todo
 * endpoint em Controllers.gs obtém o contexto por AuthService.obterContexto()
 * e valida a ação aqui, antes de ler ou gravar qualquer dado.
 *
 * Perfis resolvidos:
 *   ADMIN     -> acesso total
 *   GESTOR    -> vê tudo, gerencia usuários (exceto Admins)
 *   TIME      -> vê conforme PUBLICO / TIME / RESTRITO
 *   VISITANTE -> conta Google ainda não cadastrada em DB_Membros (sem dados)
 * ============================================================================
 */
class AuthService {
  /**
   * E-mail da Conta Google de quem está acessando o aplicativo.
   * Não há fallback para o usuário efetivo: com o Web App executando como o
   * publicador, isso faria qualquer visitante ser tratado como o dono do app.
   */
  static obterEmailUsuarioAtivo() {
    try {
      const email = Session.getActiveUser().getEmail();
      return email ? String(email).trim().toLowerCase() : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * E-mail de quem publicou o Web App (dono). É sempre ADMIN, o que permite
   * o primeiro acesso antes de existir qualquer cadastro real em DB_Membros.
   */
  static obterEmailDonoDoApp() {
    try {
      const email = Session.getEffectiveUser().getEmail();
      return email ? String(email).trim().toLowerCase() : '';
    } catch (e) {
      return '';
    }
  }

  static normalizarPerfil(perfilBruto) {
    const p = String(perfilBruto || '').trim().toUpperCase();
    if (p === 'ADMIN' || p === 'GESTOR') return p;
    return 'TIME'; // inclui o valor legado 'MEMBRO'
  }

  static encontrarMembroPorEmail(emailLogado, listaMembros) {
    if (!emailLogado || !Array.isArray(listaMembros)) return null;
    const emailLimpo = String(emailLogado).trim().toLowerCase();
    return listaMembros.find(m =>
      String(m.Email_Google || '').trim().toLowerCase() === emailLimpo
    ) || null;
  }

  /**
   * Resolve quem está chamando e qual o perfil efetivo. Use em todo endpoint.
   */
  static obterContexto() {
    const email = AuthService.obterEmailUsuarioAtivo();
    const ehDono = !!email && email === AuthService.obterEmailDonoDoApp();
    const membros = SheetRepo.obterEntidadeComCache(APP_CONFIG.SHEETS.MEMBROS);
    const membro = AuthService.encontrarMembroPorEmail(email, membros);

    let perfil = 'VISITANTE';
    if (membro) perfil = AuthService.normalizarPerfil(membro.Perfil_Acesso);
    if (ehDono) perfil = 'ADMIN';

    return { email, ehDono, membro, perfil };
  }

  static ehGestao(ctx) {
    return ctx.perfil === 'ADMIN' || ctx.perfil === 'GESTOR';
  }

  /** Exige uma conta cadastrada (qualquer perfil diferente de VISITANTE). */
  static exigirMembro(ctx) {
    if (!ctx || ctx.perfil === 'VISITANTE') {
      throw new Error('ACESSO NEGADO: sua conta Google ainda não está cadastrada na equipe.');
    }
    return ctx;
  }

  /** Exige um dos perfis informados, ex.: exigirPerfil(ctx, ['ADMIN']). */
  static exigirPerfil(ctx, perfisPermitidos) {
    if (!ctx || perfisPermitidos.indexOf(ctx.perfil) === -1) {
      throw new Error('ACESSO NEGADO: esta ação exige perfil ' + perfisPermitidos.join(' ou ') + '.');
    }
    return ctx;
  }

  /**
   * O item (tarefa, rotina ou projeto) é do usuário? Compara Responsavel/Lider
   * com o nome de exibição ou o e-mail, sempre por igualdade exata.
   */
  static itemPertenceAoUsuario(item, membroLogado, emailLogado) {
    const email = String(emailLogado || '').trim().toLowerCase();
    const nome = membroLogado ? String(membroLogado.Nome_Exibicao || '').trim().toLowerCase() : '';
    const donos = [item.Responsavel, item.Lider]
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean);
    return donos.some(d => (email && d === email) || (nome && d === nome));
  }

  /**
   * Regra de visibilidade (PUBLICO, TIME, RESTRITO) aplicada no servidor.
   */
  static usuarioPodeVisualizar(item, ctx) {
    if (!ctx || ctx.perfil === 'VISITANTE') return false;
    if (AuthService.ehGestao(ctx)) return true;

    const vis = String(item.Tipo_Visibilidade || 'PUBLICO').trim().toUpperCase();
    if (vis === 'PUBLICO') return true;

    if (AuthService.itemPertenceAoUsuario(item, ctx.membro, ctx.email)) return true;

    if (vis === 'TIME') {
      return !!ctx.membro && !!item.ID_Time &&
        String(item.ID_Time) === String(ctx.membro.ID_Time_Principal);
    }

    if (vis === 'RESTRITO') {
      const permitidos = Utils.parseListaCsv(item.Usuarios_Permitidos).map(s => s.toLowerCase());
      const nome = ctx.membro ? String(ctx.membro.Nome_Exibicao || '').trim().toLowerCase() : '';
      return (!!nome && permitidos.includes(nome)) || (!!ctx.email && permitidos.includes(ctx.email));
    }

    return false; // valor de visibilidade desconhecido: nega por segurança
  }

  /** Rotina: só o responsável, Gestor ou Admin pode dar check, finalizar ou excluir. */
  static usuarioPodeOperarRotina(rotina, ctx) {
    if (!ctx || ctx.perfil === 'VISITANTE') return false;
    if (AuthService.ehGestao(ctx)) return true;
    return AuthService.itemPertenceAoUsuario(rotina, ctx.membro, ctx.email);
  }
}
