// Cria (ou redefine a senha de) um administrador.
// Uso: npm run criar-admin -- email@yukaer.com.br "Nome Completo"
const path = require("node:path");
const { abrir, agora } = require("../server/db");
const A = require("../server/auth");

const [email, ...nomePartes] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: npm run criar-admin -- email@yukaer.com.br "Nome Completo"');
  process.exit(1);
}
const noAzure = !!process.env.WEBSITE_SITE_NAME;
const pastaDados = process.env.PASTA_DADOS || (noAzure ? "/home/data" : path.join(__dirname, "..", "dados"));
const db = abrir(process.env.ARQUIVO_BANCO || path.join(pastaDados, "yukaer.db"));
const senha = A.senhaTemporaria();
const existente = db.prepare("SELECT id FROM usuarios WHERE email = ?").get(email.toLowerCase());
if (existente) {
  db.prepare("UPDATE usuarios SET papel = 'admin', ativo = 1, senha_hash = ?, trocar_senha = 1 WHERE id = ?").run(A.hashSenha(senha), existente.id);
  console.log(`Usuário ${email} agora é administrador e recebeu nova senha provisória.`);
} else {
  db.prepare("INSERT INTO usuarios (email, nome, papel, senha_hash, trocar_senha, ativo, criado_em) VALUES (?, ?, 'admin', ?, 1, 1, ?)")
    .run(email.toLowerCase(), nomePartes.join(" ") || email, A.hashSenha(senha), agora());
  console.log(`Administrador ${email} criado.`);
}
console.log(`Senha provisória: ${senha}`);
console.log("No primeiro acesso o sistema pede uma senha nova.");
