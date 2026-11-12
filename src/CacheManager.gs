/**
 * ============================================================================
 * ARQUIVO: CacheManager.gs
 * OBJETIVO: Gerenciar o Cache em Memória RAM do Servidor (CacheService)
 *           usando paginação automática (Chunking) para superar o limite
 *           de 100KB por chave do Google Apps Script.
 * ============================================================================
 */
class CacheManager {
  /**
   * Salva uma lista grande de registros dividindo em páginas (chunks) no CacheService.
   */
  static salvarEntidadePaginada(nomeEntidade, listaCompleta) {
    const cache = CacheService.getScriptCache();
    const tamanhoPagina = APP_CONFIG.CACHE.PAGE_SIZE_ITEMS;
    const totalPaginas = Math.max(1, Math.ceil(listaCompleta.length / tamanhoPagina));
    const payloadCache = {};

    for (let p = 0; p < totalPaginas; p++) {
      const fatia = listaCompleta.slice(p * tamanhoPagina, (p + 1) * tamanhoPagina);
      const chavePagina = `${APP_CONFIG.CACHE.PREFIX}${nomeEntidade}_P_${p}`;
      payloadCache[chavePagina] = JSON.stringify(fatia);
    }

    const chaveMeta = `${APP_CONFIG.CACHE.PREFIX}${nomeEntidade}_META`;
    const versao = new Date().getTime();
    payloadCache[chaveMeta] = JSON.stringify({
      totalItems: listaCompleta.length,
      totalPages: totalPaginas,
      updatedAt: versao
    });
    payloadCache[APP_CONFIG.CACHE.VERSION_KEY] = String(versao);

    // Salva todas as páginas de uma só vez na memória RAM do Google
    cache.putAll(payloadCache, APP_CONFIG.CACHE.TTL_SECONDS);
    return versao;
  }

  /**
   * Lê e remonta todos os chunks de uma entidade a partir da memória RAM do Google.
   * Retorna null caso o cache tenha expirado (Cache Miss).
   */
  static lerEntidadePaginada(nomeEntidade) {
    const cache = CacheService.getScriptCache();
    const chaveMeta = `${APP_CONFIG.CACHE.PREFIX}${nomeEntidade}_META`;
    const metaRaw = cache.get(chaveMeta);
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw);
    const chavesPaginas = [];
    for (let p = 0; p < meta.totalPages; p++) {
      chavesPaginas.push(`${APP_CONFIG.CACHE.PREFIX}${nomeEntidade}_P_${p}`);
    }

    const paginasRaw = cache.getAll(chavesPaginas);
    let listaCompleta = [];
    for (let p = 0; p < meta.totalPages; p++) {
      const ch = chavesPaginas[p];
      if (!paginasRaw[ch]) return null; // Se alguma página expirou, força recarga limpa
      listaCompleta = listaCompleta.concat(JSON.parse(paginasRaw[ch]));
    }
    return listaCompleta;
  }

  /**
   * Retorna a versão atual do cache em memória para o Polling leve do navegador.
   */
  static obterVersaoAtual() {
    const cache = CacheService.getScriptCache();
    return cache.get(APP_CONFIG.CACHE.VERSION_KEY) || '0';
  }

  /**
   * Recarrega todas as tabelas da planilha para o Cache paginado na RAM.
   */
  static aquecerTodoOCache() {
    const entidades = Object.keys(APP_CONFIG.SHEETS);
    let ultimaVersao = 0;
    entidades.forEach(chave => {
      const nomeAba = APP_CONFIG.SHEETS[chave];
      const dados = SheetRepo.lerAbaBruta(nomeAba);
      ultimaVersao = CacheManager.salvarEntidadePaginada(nomeAba, dados);
    });
    return ultimaVersao;
  }
}
