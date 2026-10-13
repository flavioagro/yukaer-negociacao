// Importa a planilha "Controle de Contratos" (.xlsm/.xlsx) para o banco: contratos da aba Compras e fornecedores.
// Contratos já existentes (mesmo número) são mantidos. Uso: npm run importar-controle -- "caminho/Controle de Contratos.xlsm"
const fs = require("node:fs");
const path = require("node:path");
const { criarApp } = require("../server/app");
const { lerControle } = require("../server/planilhas");

(async () => {
  const arquivo = process.argv[2];
  if (!arquivo || !fs.existsSync(arquivo)) { console.error('Uso: npm run importar-controle -- "caminho/Controle de Contratos.xlsm"'); process.exit(1); }
  const noAzure = !!process.env.WEBSITE_SITE_NAME;
  const pastaDados = process.env.PASTA_DADOS || (noAzure ? "/home/data" : path.join(__dirname, "..", "dados"));
  const app = criarApp({
    arquivoBanco: process.env.ARQUIVO_BANCO || path.join(pastaDados, "yukaer.db"),
    pastaArquivos: process.env.PASTA_ARQUIVOS || path.join(pastaDados, "arquivos"),
    emailsMesa: [], carteiro: { enviar: async () => {}, enviados: [] },
  });
  const lido = await lerControle(fs.readFileSync(arquivo), path.basename(arquivo));
  console.log(`Planilha lida: ${lido.contratos.length} contratos e ${lido.fornecedores.length} fornecedores.`);
  const r = app.locals.importarControle(lido, "planilha " + path.basename(arquivo));
  console.log(`Contratos novos: ${r.contratosNovos} · já existentes: ${r.contratosJaExistentes} · fornecedores gravados: ${r.fornecedores}`);
})().catch(e => { console.error("Falha na importação:", e.message); process.exit(1); });
