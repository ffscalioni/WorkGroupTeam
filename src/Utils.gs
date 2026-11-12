/**
 * ============================================================================
 * ARQUIVO: Utils.gs
 * OBJETIVO: Classe estática com funções auxiliares, geração de IDs, formatação
 *           de datas e conversão bidirecional de células amigáveis no Sheets.
 * ============================================================================
 */
class Utils {
  /**
   * Gera um identificador único com prefixo (ex: "ATV-4821").
   */
  static gerarId(prefixo) {
    return `${prefixo}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  /**
   * Retorna a data de hoje no formato AAAA-MM-DD.
   */
  static hojeISO() {
    return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  /**
   * Converte o texto amigável da planilha ("[x] Item 1 | [ ] Item 2")
   * para um array de objetos JavaScript usado pelo frontend.
   */
  static parseChecklistFromSheet(textoCelula) {
    if (!textoCelula || typeof textoCelula !== 'string') return [];
    return textoCelula.split('|').map(bloco => {
      const limpo = bloco.trim();
      const feito = limpo.toLowerCase().startsWith('[x]');
      const texto = limpo.replace(/^\[[xX\s]\]\s*/, '').trim();
      return { texto, feito };
    }).filter(item => item.texto.length > 0);
  }

  /**
   * Converte o array de objetos do checklist de volta para o formato humano
   * amigável no Google Sheets ("[x] Item 1 | [ ] Item 2").
   */
  static formatChecklistToSheet(listaChecklist) {
    if (!Array.isArray(listaChecklist) || listaChecklist.length === 0) return '';
    return listaChecklist
      .map(i => `${i.feito ? '[x]' : '[ ]'} ${String(i.texto).trim()}`)
      .join(' | ');
  }

  /**
   * Converte string separada por vírgula ("Lucas (AI), Rafael (PMO)") em Array.
   */
  static parseListaCsv(texto) {
    if (!texto) return [];
    return String(texto).split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Converte Array em string amigável separada por vírgula.
   */
  static formatListaCsv(arr) {
    if (!Array.isArray(arr)) return String(arr || '');
    return arr.join(', ');
  }

  /**
   * Calcula a próxima data de uma rotina com base na frequência.
   */
  static calcularProximaDataRotina(dataBaseStr, frequencia) {
    const partes = String(dataBaseStr || Utils.hojeISO()).split('-');
    const dt = partes.length === 3
      ? new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]))
      : new Date();

    if (frequencia === 'Diária') dt.setDate(dt.getDate() + 1);
    else if (frequencia === 'Semanal') dt.setDate(dt.getDate() + 7);
    else if (frequencia === 'Mensal') dt.setMonth(dt.getMonth() + 1);
    else dt.setDate(dt.getDate() + 1);

    return Utilities.formatDate(dt, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
}
