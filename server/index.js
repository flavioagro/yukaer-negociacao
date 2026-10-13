// Ponto de entrada: lê a configuração das variáveis de ambiente e sobe o servidor.
const path = require("node:path");
const { criarApp } = require("./app");

// No Azure App Service (Linux) só a pasta /home é persistente.
const noAzure = !!process.env.WEBSITE_SITE_NAME;
const pastaDados = process.env.PASTA_DADOS || (noAzure ? "/home/data" : path.join(__dirname, "..", "dados"));
const lista = s => String(s || "").split(/[;,]/).map(x => x.trim()).filter(Boolean);

const config = {
  arquivoBanco: process.env.ARQUIVO_BANCO || path.join(pastaDados, "yukaer.db"),
  pastaArquivos: process.env.PASTA_ARQUIVOS || path.join(pastaDados, "arquivos"),
  producao: process.env.NODE_ENV === "production",
  urlBase: (process.env.URL_BASE || "").replace(/\/$/, ""),
  emailsMesa: lista(process.env.EMAILS_MESA),
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || "",
};

const app = criarApp(config);
const porta = Number(process.env.PORT || 3000);
app.listen(porta, () => {
  console.log(`Mesa de Negociação Yukaer em http://localhost:${porta}`);
  console.log(`Banco: ${config.arquivoBanco}`);
  if (!config.smtpHost) console.log("E-mail não configurado (SMTP_HOST vazio): os avisos só aparecem neste log.");
});
