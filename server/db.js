const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','mesa','corretor')),
  corretor_nome TEXT,
  empresa TEXT,
  telefone TEXT,
  senha_hash TEXT NOT NULL,
  trocar_senha INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  dados TEXT NOT NULL,
  origem TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boletas (
  id INTEGER PRIMARY KEY,
  codigo TEXT UNIQUE,
  corretor_id INTEGER NOT NULL REFERENCES usuarios(id),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  status TEXT NOT NULL,
  dados TEXT NOT NULL,
  mesa TEXT NOT NULL DEFAULT '{}',
  historico TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  enviado_em TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boletas_corretor ON boletas(corretor_id);
CREATE INDEX IF NOT EXISTS boletas_status ON boletas(status);
CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY,
  boleta_id INTEGER NOT NULL REFERENCES boletas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  mime TEXT,
  tamanho INTEGER,
  enviado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY,
  ano TEXT NOT NULL,
  seq INTEGER NOT NULL,
  numero TEXT NOT NULL UNIQUE,
  boleta_id INTEGER REFERENCES boletas(id),
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (ano, seq)
);
`;

function abrir(arquivo) {
  if (arquivo !== ":memory:") fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

// Executa fn dentro de uma transação; desfaz tudo se lançar erro.
function transacao(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

const agora = () => new Date().toISOString();
const json = s => { try { return JSON.parse(s); } catch { return null; } };

module.exports = { abrir, transacao, agora, json };
