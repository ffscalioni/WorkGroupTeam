/**
 * ============================================================================
 * ARQUIVO: build.js (Empacotador Local para Contornar Bloqueio do Clasp)
 * OBJETIVO: Manter os 19 arquivos separados no VS Code/GitHub, mas gerar
 *           automaticamente apenas 2 arquivos prontos na pasta "dist/" para
 *           copiar e colar no Google Apps Script pelo navegador em segundos!
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// Parâmetros de pastas (você pode ajustar se mudar o nome das pastas)
const PASTA_ORIGEM = path.join(__dirname, 'src');
const PASTA_DESTINO = path.join(__dirname, 'dist');

// Ordem exata em que os arquivos .gs devem ser unidos
const ORDEM_ARQUIVOS_GS = [
  'Config.gs',
  'Utils.gs',
  'CacheManager.gs',
  'SheetRepo.gs',
  'AuthService.gs',
  'NotificationService.gs',
  'Controllers.gs',
  'Triggers.gs',
  'Dicionario.gs',
  'Main.gs'
];

function gerarPacoteParaNavegador() {
  console.log('🚀 Iniciando empacotamento local do Workspace Team Hub...');

  // 1. Cria a pasta "dist/" se ela ainda não existir
  if (!fs.existsSync(PASTA_DESTINO)) {
    fs.mkdirSync(PASTA_DESTINO);
  }

  // 2. Une todos os arquivos .gs em um único arquivo de Backend
  let conteudoBackend = '/**\n * ARQUIVO GERADO AUTOMATICAMENTE PELO BUILD.JS\n * Cole todo este conteúdo no arquivo Código.gs do seu Google Apps Script.\n */\n\n';

  ORDEM_ARQUIVOS_GS.forEach(nomeArquivo => {
    const caminhoCompleto = path.join(PASTA_ORIGEM, nomeArquivo);
    if (fs.existsSync(caminhoCompleto)) {
      const codigo = fs.readFileSync(caminhoCompleto, 'utf8');
      conteudoBackend += `\n// ==================== INÍCIO DE: ${nomeArquivo} ====================\n`;
      conteudoBackend += codigo + '\n';
      console.log(`✅ Backend incluído: ${nomeArquivo}`);
    } else {
      console.warn(`⚠️ Aviso: Arquivo ${nomeArquivo} não encontrado em src/`);
    }
  });

  const caminhoBackendFinal = path.join(PASTA_DESTINO, '1_Codigo_Backend.gs');
  fs.writeFileSync(caminhoBackendFinal, conteudoBackend, 'utf8');

  // 3. Lê o AppShell.html e substitui os <?!= include('...'); ?> pelos arquivos HTML separados
  const caminhoAppShell = path.join(PASTA_ORIGEM, 'AppShell.html');
  if (fs.existsSync(caminhoAppShell)) {
    let htmlFinal = fs.readFileSync(caminhoAppShell, 'utf8');

    // Expressão regular que encontra <?!= include('NomeDoArquivo'); ?>
    const regexInclude = /<\?!=\s*include\(['"]([^'"]+)['"]\);\s*\?>/g;

    htmlFinal = htmlFinal.replace(regexInclude, (match, nomeArquivoHtml) => {
      const arquivoComExtensao = nomeArquivoHtml.endsWith('.html')
        ? nomeArquivoHtml
        : `${nomeArquivoHtml}.html`;
      const caminhoHtml = path.join(PASTA_ORIGEM, arquivoComExtensao);

      if (fs.existsSync(caminhoHtml)) {
        console.log(`✅ HTML mesclado no AppShell: ${arquivoComExtensao}`);
        const conteudoParcial = fs.readFileSync(caminhoHtml, 'utf8');
        return `\n<!-- ==================== INÍCIO DE: ${arquivoComExtensao} ==================== -->\n${conteudoParcial}\n<!-- ==================== FIM DE: ${arquivoComExtensao} ==================== -->\n`;
      } else {
        console.warn(`⚠️ Aviso: HTML ${arquivoComExtensao} não encontrado!`);
        return `<!-- Arquivo ${arquivoComExtensao} não encontrado -->`;
      }
    });

    const caminhoHtmlFinal = path.join(PASTA_DESTINO, '2_AppShell.html');
    fs.writeFileSync(caminhoHtmlFinal, htmlFinal, 'utf8');
  }

  // 4. Módulo Dicionário de Dados: página independente, copiada como está
  const caminhoDicionario = path.join(PASTA_ORIGEM, 'Dicionario.html');
  if (fs.existsSync(caminhoDicionario)) {
    fs.copyFileSync(caminhoDicionario, path.join(PASTA_DESTINO, '3_Dicionario.html'));
    console.log('✅ Módulo copiado: Dicionario.html --> dist/3_Dicionario.html (crie o arquivo HTML "Dicionario" no editor)');
  }

  console.log('\n🎉 PRONTO! Os 2 arquivos consolidados foram gerados na pasta "dist/":');
  console.log('   1) dist/1_Codigo_Backend.gs  --> Cole no "Código.gs" do navegador');
  console.log('   2) dist/2_AppShell.html      --> Cole no "AppShell.html" do navegador');
}

// Executa a função
gerarPacoteParaNavegador();