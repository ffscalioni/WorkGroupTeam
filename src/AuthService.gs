/**
 * ============================================================================
 * ARQUIVO: AuthService.gs
 * OBJETIVO: Identificar o usuário Google logado e filtrar itens conforme as
 *           regras de visibilidade (PUBLICO, TIME, RESTRITO).
 * ============================================================================
 */
class AuthService {
  static obterEmailUsuarioAtivo() {
    try {
      return Session.getActiveUser().getEmail() || 'gestor@empresa.com';
    } catch (e) {
      return 'gestor@empresa.com';
    }
  }

  static usuarioPodeVisualizar(item, membroAtual) {
    if (!membroAtual || membroAtual.Perfil_Acesso === 'GESTOR') return true;
    const vis = item.Tipo_Visibilidade || 'PUBLICO';
    if (vis === 'PUBLICO') return true;
    if (vis === 'TIME') return item.ID_Time === membroAtual.ID_Time_Principal;
    if (vis === 'RESTRITO') {
      const permitidos = Utils.parseListaCsv(item.Usuarios_Permitidos);
      return permitidos.includes(membroAtual.Nome_Exibicao) ||
             permitidos.includes(membroAtual.Email_Google) ||
             item.Responsavel === membroAtual.Nome_Exibicao ||
             item.Lider === membroAtual.Nome_Exibicao;
    }
    return true;
  }
}
