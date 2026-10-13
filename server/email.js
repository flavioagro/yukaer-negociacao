// Envio de avisos por e-mail. Sem SMTP configurado, apenas registra no log.
const nodemailer = require("nodemailer");

function criarCarteiro(config) {
  const ativo = !!config.smtpHost;
  const transporte = ativo ? nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort, secure: config.smtpPort === 465,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  }) : null;
  const enviados = [];
  async function enviar(para, assunto, texto) {
    const lista = [].concat(para).filter(Boolean);
    if (!lista.length) return;
    enviados.push({ para: lista, assunto, texto });
    if (!transporte) { console.log(`[e-mail não configurado] para ${lista.join(", ")}: ${assunto}`); return; }
    try { await transporte.sendMail({ from: config.smtpFrom, to: lista.join(", "), subject: assunto, text: texto }); }
    catch (e) { console.error("Falha ao enviar e-mail:", e.message); }
  }
  return { enviar, enviados };
}

module.exports = { criarCarteiro };
