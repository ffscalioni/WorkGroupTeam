/**
 * ============================================================================
 * ARQUIVO: NotificationService.gs
 * OBJETIVO: Disparar alertas automáticos por e-mail quando uma dependência é
 *           concluída, protegendo a cota diária do MailApp.
 * ============================================================================
 */
class NotificationService {
  static obterCotaRestante() {
    try {
      return MailApp.getRemainingDailyQuota();
    } catch (e) {
      return 100;
    }
  }

  /**
   * Verifica se a tarefa concluída destrava outras tarefas dependentes e notifica os responsáveis.
   */
  static notificarDesbloqueioDeDependencias(idTarefaConcluida, todasTarefas, todosMembros) {
    if (!APP_CONFIG.EMAIL.ENABLED) return { enviados: 0 };
    const dependentes = todasTarefas.filter(t => String(t.ID_Tarefa_Predecessora) === String(idTarefaConcluida));
    if (dependentes.length === 0) return { enviados: 0 };

    const cotaRestante = NotificationService.obterCotaRestante();
    if (cotaRestante <= APP_CONFIG.EMAIL.MIN_QUOTA_RESERVE) {
      return { enviados: 0, aviso: 'Reserva mínima de cota de e-mail atingida.' };
    }

    let enviados = 0;
    dependentes.forEach(dep => {
      const membro = todosMembros.find(m => m.Nome_Exibicao === dep.Responsavel);
      if (membro && membro.Email_Google) {
        try {
          MailApp.sendEmail({
            to: membro.Email_Google,
            subject: `[Workspace Hub] 🔓 Tarefa Desbloqueada: ${dep.ID_Tarefa} - ${dep.Titulo_Tarefa}`,
            htmlBody: `
              <div style="font-family:Arial,sans-serif;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">
                <h3 style="color:#2563eb;margin-top:0;">🔓 Dependência Concluída!</h3>
                <p>Olá, <strong>${membro.Nome_Exibicao}</strong>!</p>
                <p>A atividade predecessora <strong>${idTarefaConcluida}</strong> acabou de ser concluída.</p>
                <p>Sua atividade <strong>[${dep.ID_Tarefa}] ${dep.Titulo_Tarefa}</strong> já está liberada para execução.</p>
              </div>
            `
          });
          enviados++;
        } catch (err) {
          console.warn('Falha ao enviar e-mail para ' + membro.Email_Google, err);
        }
      }
    });

    return { enviados, desbloqueadas: dependentes.map(d => d.ID_Tarefa) };
  }
}
