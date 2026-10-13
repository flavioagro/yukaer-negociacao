const crypto = require("node:crypto");
const { agora } = require("./db");

const COOKIE = "yk_sessao";
const DURACAO_MS = 12 * 60 * 60 * 1000;

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString("base64")}$${h.toString("base64")}`;
}
function conferirSenha(senha, guardado) {
  const [alg, sal, h] = String(guardado || "").split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const esperado = Buffer.from(h, "base64");
  const obtido = crypto.scryptSync(String(senha), Buffer.from(sal, "base64"), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}
function senhaValida(s) { return typeof s === "string" && s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s); }
function senhaTemporaria() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = ""; for (let i = 0; i < 8; i++) s += a[crypto.randomInt(a.length)];
  return s + crypto.randomInt(10, 99);
}

function lerCookie(req, nome) {
  const c = req.headers.cookie || "";
  for (const p of c.split(";")) { const [k, ...v] = p.trim().split("="); if (k === nome) return decodeURIComponent(v.join("=")); }
  return null;
}

function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DURACAO_MS).toISOString();
  db.prepare("DELETE FROM sessoes WHERE expira_em < ?").run(agora());
  db.prepare("INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)").run(token, usuarioId, expira);
  return token;
}
function cookieSessao(token, producao) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO_MS / 1000}${producao ? "; Secure" : ""}`;
}
function cookieApagado(producao) { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${producao ? "; Secure" : ""}`; }

// Carrega o usuário da sessão em req.usuario (ou null).
function carregarUsuario(db) {
  return (req, _res, next) => {
    req.usuario = null;
    const token = lerCookie(req, COOKIE);
    if (token) {
      const u = db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expira_em > ? AND u.ativo = 1`).get(token, agora());
      if (u) { req.usuario = u; req.token = token; }
    }
    next();
  };
}

const ehMesa = u => u && (u.papel === "mesa" || u.papel === "admin");
function exigir(...papeis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: "Entre com seu e-mail e senha." });
    if (req.usuario.trocar_senha && !req.path.endsWith("/senha") && req.path !== "/api/eu") return res.status(403).json({ erro: "Troque a senha provisória antes de continuar.", trocarSenha: true });
    if (papeis.length && !papeis.includes(req.usuario.papel)) return res.status(403).json({ erro: "Seu perfil não tem acesso a esta área." });
    next();
  };
}

// Limite simples de tentativas de login por IP + e-mail.
const tentativas = new Map();
function podeTentar(chave) {
  const t = tentativas.get(chave); const agoraMs = Date.now();
  if (!t || agoraMs - t.inicio > 15 * 60 * 1000) return true;
  return t.n < 10;
}
function registrarFalha(chave) {
  const t = tentativas.get(chave); const agoraMs = Date.now();
  if (!t || agoraMs - t.inicio > 15 * 60 * 1000) tentativas.set(chave, { inicio: agoraMs, n: 1 }); else t.n++;
}
function limparFalhas(chave) { tentativas.delete(chave); }

function usuarioPublico(u) {
  return u && { id: u.id, email: u.email, nome: u.nome, papel: u.papel, corretorNome: u.corretor_nome, empresa: u.empresa, telefone: u.telefone, trocarSenha: !!u.trocar_senha, ativo: !!u.ativo, criadoEm: u.criado_em };
}

module.exports = { hashSenha, conferirSenha, senhaValida, senhaTemporaria, criarSessao, cookieSessao, cookieApagado, carregarUsuario, exigir, ehMesa, podeTentar, registrarFalha, limparFalhas, usuarioPublico, COOKIE };
