const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const multer = require("multer");
const { abrir, transacao, agora, json } = require("./db");
const A = require("./auth");
const R = require("../public/regras");
const P = require("./planilhas");
const { criarCarteiro } = require("./email");

const EDITAVEIS_CONTRATO = ["posicaoAssinatura", "reconhecido", "outrosDocumentos", "posicaoOutrosDocumentos", "dataPagamento", "dataRealPagamento", "valorPago", "statusPagamento", "posicaoEntregas", "qtdFiscal", "qtdBalanca", "descRoyalties", "descAntecipacao", "situacaoComissao", "dataPagamentoComissao", "observacoes", "certidaoPenhor"];
const NUM_CONTRATO = new Set(["valorPago", "qtdFiscal", "qtdBalanca", "descRoyalties", "descAntecipacao"]);
const CAMPOS_FORNECEDOR = ["nome", "tipo", "cpf", "cnpj", "ie", "car", "fazenda", "municipio", "estado", "endereco", "telefone", "email", "banco", "agencia", "conta", "pix", "liminarFunrural"];
const TIPOS_ARQUIVO = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/;

class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const falha = (status, msg) => { throw new Erro(status, msg); };
const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);

function limparGrupo(obj, max = 500) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) out[k] = texto(v, max);
  return out;
}

function criarApp(config) {
  const db = config.db || abrir(config.arquivoBanco);
  const carteiro = config.carteiro || criarCarteiro(config);
  fs.mkdirSync(config.pastaArquivos, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  const uploadPlanilha = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } });

  const app = express();
  app.disable("x-powered-by");
  if (config.producao) app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (config.producao) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(A.carregarUsuario(db));
  // Proteção contra requisições de outros sites: toda escrita na API exige o cabeçalho X-Yukaer.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.get("x-yukaer") !== "1") return res.status(403).json({ erro: "Requisição recusada." });
    next();
  });

  const rota = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  // ---------- dados auxiliares ----------
  const lerFornecedor = row => row && { id: row.id, chave: row.chave, ...json(row.dados), nome: row.nome, origem: row.origem, atualizadoEm: row.atualizado_em };
  const lerContrato = row => row && { id: row.id, ...json(row.dados), numero: row.numero, ano: row.ano, seq: row.seq, boletaId: row.boleta_id, atualizadoEm: row.atualizado_em };
  function lerBoleta(row) {
    if (!row) return null;
    const d = json(row.dados) || {};
    const docs = db.prepare("SELECT id, tipo, nome_arquivo, tamanho, criado_em FROM documentos WHERE boleta_id = ? ORDER BY id").all(row.id)
      .map(x => ({ id: x.id, tipo: x.tipo, nome: x.nome_arquivo, tamanho: x.tamanho, criadoEm: x.criado_em }));
    return { id: row.id, codigo: row.codigo, status: row.status, corretorId: row.corretor_id, corretorNome: row.corretor_nome || "", fornecedorId: row.fornecedor_id,
      cliente: d.cliente || {}, neg: d.neg || {}, banco: d.banco || {}, obs: d.obs || "", mesa: json(row.mesa) || {}, historico: json(row.historico) || [],
      documentos: docs, criadoEm: row.criado_em, enviadoEm: row.enviado_em, atualizadoEm: row.atualizado_em };
  }
  const SQL_BOLETA = "SELECT b.*, u.corretor_nome FROM boletas b JOIN usuarios u ON u.id = b.corretor_id";
  function boletaPermitida(req, id) {
    const row = db.prepare(SQL_BOLETA + " WHERE b.id = ?").get(Number(id));
    if (!row) falha(404, "Boleta não encontrada.");
    const u = req.usuario;
    if (u.papel === "corretor" && row.corretor_id !== u.id) falha(404, "Boleta não encontrada.");
    if (A.ehMesa(u) && row.status === "rascunho" && row.corretor_id !== u.id) falha(404, "Boleta não encontrada.");
    return row;
  }
  function upsertFornecedor(f, origem) {
    const chave = R.digitos(f.chave || (f.tipo === "Pessoa Jurídica" ? f.cnpj : f.cpf));
    if (!chave || !texto(f.nome)) return null;
    const atual = db.prepare("SELECT * FROM fornecedores WHERE chave = ?").get(chave);
    const dados = { ...(atual ? json(atual.dados) : {}) };
    for (const k of CAMPOS_FORNECEDOR) if (f[k] !== undefined && texto(f[k]) !== "") dados[k] = texto(f[k]);
    dados.nome = texto(f.nome) || dados.nome;
    if (atual) db.prepare("UPDATE fornecedores SET nome = ?, dados = ?, origem = ?, atualizado_em = ? WHERE id = ?").run(dados.nome, JSON.stringify(dados), origem, agora(), atual.id);
    else db.prepare("INSERT INTO fornecedores (chave, nome, dados, origem, atualizado_em) VALUES (?, ?, ?, ?, ?)").run(chave, dados.nome, JSON.stringify(dados), origem, agora());
    return db.prepare("SELECT id FROM fornecedores WHERE chave = ?").get(chave).id;
  }
  const emailsMesa = () => config.emailsMesa.length ? config.emailsMesa
    : db.prepare("SELECT email FROM usuarios WHERE papel IN ('mesa','admin') AND ativo = 1").all().map(r => r.email);
  const link = caminho => (config.urlBase || "") + caminho;

  // ---------- sessão ----------
  app.post("/api/entrar", rota((req, res) => {
    const email = texto(req.body?.email, 200).toLowerCase(), senha = String(req.body?.senha || "");
    const chave = `${req.ip}|${email}`;
    if (!A.podeTentar(chave)) falha(429, "Muitas tentativas. Aguarde 15 minutos e tente de novo.");
    const u = db.prepare("SELECT * FROM usuarios WHERE email = ?").get(email);
    if (!u || !u.ativo || !A.conferirSenha(senha, u.senha_hash)) { A.registrarFalha(chave); falha(401, "E-mail ou senha incorretos."); }
    A.limparFalhas(chave);
    const token = A.criarSessao(db, u.id);
    res.set("Set-Cookie", A.cookieSessao(token, config.producao)).json({ usuario: A.usuarioPublico(u) });
  }));
  app.post("/api/sair", (req, res) => {
    if (req.token) db.prepare("DELETE FROM sessoes WHERE token = ?").run(req.token);
    res.set("Set-Cookie", A.cookieApagado(config.producao)).json({ ok: true });
  });
  app.get("/api/eu", (req, res) => req.usuario ? res.json({ usuario: A.usuarioPublico(req.usuario) }) : res.status(401).json({ erro: "Sem sessão." }));
  app.post("/api/eu/senha", A.exigir(), rota((req, res) => {
    const { atual, nova } = req.body || {};
    if (!A.conferirSenha(atual || "", req.usuario.senha_hash)) falha(400, "A senha atual não confere.");
    if (!A.senhaValida(nova)) falha(400, "A nova senha precisa ter pelo menos 8 caracteres, com letras e números.");
    db.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?").run(A.hashSenha(nova), req.usuario.id);
    db.prepare("DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?").run(req.usuario.id, req.token);
    res.json({ ok: true });
  }));

  // ---------- fornecedores ----------
  app.get("/api/fornecedores", A.exigir(), (req, res) => {
    const q = texto(req.query.q, 100), dq = R.digitos(q);
    const filtra = (r) => {
      if (!q) return true;
      const t = q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const d = json(r.dados) || {};
      const alvo = `${r.nome} ${d.fazenda || ""} ${d.municipio || ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return alvo.includes(t) || (dq.length >= 3 && r.chave.includes(dq));
    };
    const rows = db.prepare("SELECT * FROM fornecedores ORDER BY nome").all();
    if (A.ehMesa(req.usuario)) {
      const lista = rows.filter(filtra);
      return res.json({ total: lista.length, fornecedores: lista.slice(0, 500).map(lerFornecedor) });
    }
    // Corretor: só pesquisa, com documento mascarado. Os dados completos vêm ao escolher um fornecedor.
    if (q.length < 3) return res.json({ total: 0, fornecedores: [] });
    const lista = rows.filter(filtra).slice(0, 15).map(r => { const d = json(r.dados) || {};
      return { id: r.id, nome: r.nome, documento: r.chave.length === 14 ? `CNPJ ••${r.chave.slice(-6)}` : `CPF ••${r.chave.slice(-5)}`, fazenda: d.fazenda || "", municipio: d.municipio || "" }; });
    res.json({ total: lista.length, fornecedores: lista });
  });
  app.get("/api/fornecedores/:id", A.exigir(), (req, res) => {
    const f = lerFornecedor(db.prepare("SELECT * FROM fornecedores WHERE id = ?").get(Number(req.params.id)));
    f ? res.json(f) : res.status(404).json({ erro: "Fornecedor não encontrado." });
  });
  app.post("/api/fornecedores", A.exigir("mesa", "admin"), rota((req, res) => {
    const f = limparGrupo(req.body);
    if (!f.nome) falha(400, "Informe o nome do fornecedor.");
    const id = upsertFornecedor(f, "cadastro manual");
    if (!id) falha(400, "Informe o CPF (pessoa física) ou o CNPJ (pessoa jurídica).");
    res.json(lerFornecedor(db.prepare("SELECT * FROM fornecedores WHERE id = ?").get(id)));
  }));
  app.put("/api/fornecedores/:id", A.exigir("mesa", "admin"), rota((req, res) => {
    const atual = db.prepare("SELECT * FROM fornecedores WHERE id = ?").get(Number(req.params.id));
    if (!atual) falha(404, "Fornecedor não encontrado.");
    const f = limparGrupo(req.body);
    const dados = { ...json(atual.dados) };
    for (const k of CAMPOS_FORNECEDOR) if (k in f) dados[k] = f[k];
    if (!dados.nome) falha(400, "Informe o nome do fornecedor.");
    db.prepare("UPDATE fornecedores SET nome = ?, dados = ?, atualizado_em = ? WHERE id = ?").run(dados.nome, JSON.stringify(dados), agora(), atual.id);
    res.json(lerFornecedor(db.prepare("SELECT * FROM fornecedores WHERE id = ?").get(atual.id)));
  }));
  app.post("/api/fornecedores/importar", A.exigir("mesa", "admin"), uploadPlanilha.single("arquivo"), rota(async (req, res) => {
    if (!req.file) falha(400, "Envie um arquivo .xlsx ou .csv.");
    let lista;
    try { lista = await P.lerFornecedores(req.file.buffer, req.file.originalname); } catch (e) { falha(400, e.message); }
    const origem = "importação " + texto(req.file.originalname, 120);
    const n = transacao(db, () => lista.reduce((s, f) => s + (upsertFornecedor(f, origem) ? 1 : 0), 0));
    res.json({ importados: n });
  }));

  // ---------- boletas ----------
  app.get("/api/boletas", A.exigir(), (req, res) => {
    const u = req.usuario;
    const rows = u.papel === "corretor"
      ? db.prepare(SQL_BOLETA + " WHERE b.corretor_id = ? ORDER BY b.atualizado_em DESC").all(u.id)
      : db.prepare(SQL_BOLETA + " WHERE b.status <> 'rascunho' OR b.corretor_id = ? ORDER BY b.atualizado_em DESC").all(u.id);
    res.json(rows.map(lerBoleta));
  });
  app.get("/api/boletas/:id", A.exigir(), rota((req, res) => res.json(lerBoleta(boletaPermitida(req, req.params.id)))));

  function salvarBoleta(req, existente) {
    const u = req.usuario;
    const corpo = req.body || {};
    const dados = { cliente: limparGrupo(corpo.cliente), neg: limparGrupo(corpo.neg), banco: limparGrupo(corpo.banco), obs: texto(corpo.obs, 4000) };
    const fornecedorId = corpo.fornecedorId && db.prepare("SELECT id FROM fornecedores WHERE id = ?").get(Number(corpo.fornecedorId)) ? Number(corpo.fornecedorId) : null;
    const enviar = !!corpo.enviar;
    if (enviar) { const f = R.camposFaltando(dados); if (f.length) falha(400, "Falta preencher: " + f.join(", ") + "."); }
    const historico = existente ? json(existente.historico) || [] : [];
    const status = enviar ? "enviada" : (existente?.status === "ajuste" ? "ajuste" : "rascunho");
    if (enviar) historico.push({ em: agora(), papel: "corretor", por: u.nome, acao: existente?.status === "ajuste" ? "Reenviada após ajuste" : "Enviada para a mesa", texto: "" });
    let id;
    if (existente) {
      db.prepare("UPDATE boletas SET dados = ?, fornecedor_id = ?, status = ?, historico = ?, atualizado_em = ?, enviado_em = COALESCE(?, enviado_em) WHERE id = ?")
        .run(JSON.stringify(dados), fornecedorId, status, JSON.stringify(historico), agora(), enviar ? agora() : null, existente.id);
      id = existente.id;
    } else {
      const r = db.prepare("INSERT INTO boletas (corretor_id, fornecedor_id, status, dados, historico, criado_em, enviado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(u.id, fornecedorId, status, JSON.stringify(dados), JSON.stringify(historico), agora(), enviar ? agora() : null, agora());
      id = Number(r.lastInsertRowid);
      db.prepare("UPDATE boletas SET codigo = ? WHERE id = ?").run(`B${new Date().getFullYear()}-${String(id).padStart(4, "0")}`, id);
    }
    const b = lerBoleta(db.prepare(SQL_BOLETA + " WHERE b.id = ?").get(id));
    if (enviar) {
      const c = R.calcular(b);
      carteiro.enviar(emailsMesa(), `Nova boleta ${b.codigo} de ${b.corretorNome || u.nome}`,
        `${b.corretorNome || u.nome} enviou a boleta ${b.codigo} para aprovação.\n\nProdutor: ${b.cliente.nome}\nVolume: ${c.sc.toFixed(0)} sc\nPreço: ${c.moeda} ${c.preco.toFixed(2)}/sc\nFilial: ${b.neg.filial}\n\nAbrir: ${link("/#aprov")}`);
    }
    return b;
  }
  app.post("/api/boletas", A.exigir("corretor"), rota((req, res) => {
    if (!req.usuario.corretor_nome) falha(400, "Seu cadastro de corretor está sem o nome usado no controle. Peça à mesa para completar.");
    res.json(salvarBoleta(req, null));
  }));
  app.put("/api/boletas/:id", A.exigir("corretor"), rota((req, res) => {
    const row = boletaPermitida(req, req.params.id);
    if (!["rascunho", "ajuste"].includes(row.status)) falha(409, "Esta boleta já foi enviada e não pode mais ser alterada.");
    res.json(salvarBoleta(req, row));
  }));
  app.delete("/api/boletas/:id", A.exigir("corretor"), rota((req, res) => {
    const row = boletaPermitida(req, req.params.id);
    if (row.status !== "rascunho") falha(409, "Só rascunhos podem ser excluídos.");
    for (const d of db.prepare("SELECT arquivo FROM documentos WHERE boleta_id = ?").all(row.id)) fs.rmSync(path.join(config.pastaArquivos, d.arquivo), { force: true });
    db.prepare("DELETE FROM boletas WHERE id = ?").run(row.id);
    res.json({ ok: true });
  }));

  // Documentos da boleta
  app.post("/api/boletas/:id/documentos", A.exigir(), upload.single("arquivo"), rota((req, res) => {
    const row = boletaPermitida(req, req.params.id);
    const dono = row.corretor_id === req.usuario.id;
    if (!(dono && ["rascunho", "ajuste"].includes(row.status)) && !A.ehMesa(req.usuario)) falha(409, "A boleta não aceita novos documentos neste momento.");
    const tipo = texto(req.body?.tipo, 40);
    if (!R.DOCUMENTOS.some(([k]) => k === tipo)) falha(400, "Tipo de documento inválido.");
    if (!req.file) falha(400, "Envie o arquivo.");
    if (!TIPOS_ARQUIVO.test(req.file.mimetype)) falha(400, "Envie PDF ou imagem (JPG, PNG, WEBP, HEIC).");
    const arquivo = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(config.pastaArquivos, arquivo), req.file.buffer);
    const anterior = db.prepare("SELECT id, arquivo FROM documentos WHERE boleta_id = ? AND tipo = ?").get(row.id, tipo);
    if (anterior) { db.prepare("DELETE FROM documentos WHERE id = ?").run(anterior.id); fs.rmSync(path.join(config.pastaArquivos, anterior.arquivo), { force: true }); }
    db.prepare("INSERT INTO documentos (boleta_id, tipo, nome_arquivo, arquivo, mime, tamanho, enviado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, tipo, texto(req.file.originalname, 200) || "documento", arquivo, req.file.mimetype, req.file.size, req.usuario.id, agora());
    res.json(lerBoleta(db.prepare(SQL_BOLETA + " WHERE b.id = ?").get(row.id)));
  }));
  app.get("/api/documentos/:id", A.exigir(), rota((req, res) => {
    const d = db.prepare("SELECT * FROM documentos WHERE id = ?").get(Number(req.params.id));
    if (!d) falha(404, "Documento não encontrado.");
    boletaPermitida(req, d.boleta_id);
    res.set({ "Content-Type": d.mime || "application/octet-stream", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.nome_arquivo)}`, "Cache-Control": "private, no-store" });
    res.sendFile(path.join(config.pastaArquivos, d.arquivo));
  }));

  // Decisão da mesa
  app.post("/api/boletas/:id/decisao", A.exigir("mesa", "admin"), rota((req, res) => {
    const acao = req.body?.acao, parecer = texto(req.body?.parecer, 2000), responsavel = texto(req.body?.responsavel, 120);
    if (!["aprovar", "ajuste", "reprovar"].includes(acao)) falha(400, "Ação inválida.");
    if (acao !== "aprovar" && !parecer) falha(400, "Escreva no parecer o que o corretor precisa ajustar ou o motivo da reprovação.");
    const checklist = {}; for (const k of R.CHECKLIST_MESA) checklist[k] = !!req.body?.checklist?.[k];
    const resultado = transacao(db, () => {
      const row = boletaPermitida(req, req.params.id);
      if (row.status !== "enviada") falha(409, "Esta boleta não está aguardando a mesa.");
      const b = lerBoleta(row);
      const mesa = { ...b.mesa, checklist, responsavel, parecer, decididoPor: req.usuario.nome, decididoEm: agora() };
      let status = acao === "aprovar" ? "aprovada" : acao === "ajuste" ? "ajuste" : "reprovada";
      if (acao === "aprovar") {
        const c = R.calcular(b), cl = b.cliente, n = b.neg, bk = b.banco;
        const ano = R.anoDaSafra(n.safra);
        const seq = (db.prepare("SELECT MAX(seq) m FROM contratos WHERE ano = ?").get(ano).m || 0) + 1;
        const numero = R.formatarNumero(seq, ano);
        const pj = cl.tipoVendedor === "Pessoa Jurídica";
        const fmt = s => s ? s.split("-").reverse().join("/") : "";
        const contrato = {
          filial: String(n.filial || "").toUpperCase(), dataCompra: agora().slice(0, 10), tipoContrato: String(n.tipoContrato || "").toUpperCase(),
          produto: String(n.mercadoria || "").toUpperCase() + (n.transgenia ? ` (${n.transgenia})` : ""), safra: n.safra, produtor: String(cl.nome || "").toUpperCase(),
          tipoVendedor: String(cl.tipoVendedor || "").toUpperCase(), cpf: cl.cpf || "", cnpj: cl.cnpj || "", ie: cl.ie || "", car: cl.car || "", fazenda: cl.propriedade || "",
          municipio: cl.municipio || "", estado: cl.estado || "", endereco: cl.enderecoFazenda || "", telefone: cl.telefone || "", email: cl.email || "",
          banco: bk.banco || "", agencia: bk.agencia || "", conta: bk.conta || "", pix: bk.pix || "",
          liminarFunrural: pj ? "PJ - ISENTO" : (n.declFunrural === "Sim" ? "SIM" : "NÃO"),
          outrosDocumentos: [n.cessaoCredito && "CESSÃO DE CRÉDITO", n.notaPromissoria && "PROMISSÓRIA", n.cpr && "CPR"].filter(Boolean).join(", "), certidaoPenhor: n.certidaoPenhor || "",
          qtdKg: c.kg, qtdSc: c.sc, tipoFrete: String(n.frete || "").split(" ")[0], localEntrega: String(n.local || "").toUpperCase(),
          dataEntrega: `${fmt(n.entregaDe)} A ${fmt(n.entregaAte)}`, valorSaco: c.preco, valorContrato: c.bruto, pctFunrural: c.pct, valorFunrural: c.funrural,
          descRoyalties: 0, descAntecipacao: 0, valorLiquido: c.liquido, valorAPagar: c.liquido, moeda: c.moeda, observacoes: b.obs || "",
          posicaoAssinatura: "A EMITIR", reconhecido: "", tipoPagamento: n.pgtoDiferenciado ? "DIFERENCIADO" : "DATA FIXA", dataPagamento: n.pgtoData || "",
          dataRealPagamento: "", valorPago: 0, statusPagamento: "EM ABERTO", posicaoEntregas: "EM ABERTO", corretor: row.corretor_nome || "",
          comissao: R.num(n.comissaoSc), valorComissao: c.comissao, situacaoComissao: R.num(n.comissaoSc) > 0 ? "EM ABERTO" : "SEM COMISSÃO",
          dataPagamentoComissao: "", aRetirar: c.kg, qtdFiscal: 0, qtdBalanca: 0, responsavel, codigoBoleta: b.codigo, origem: "plataforma",
        };
        db.prepare("INSERT INTO contratos (ano, seq, numero, boleta_id, dados, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)").run(ano, seq, numero, b.id, JSON.stringify(contrato), agora());
        mesa.contratoNumero = numero;
        const fid = upsertFornecedor({ ...cl, fazenda: cl.propriedade, endereco: cl.enderecoFazenda, banco: bk.banco, agencia: bk.agencia, conta: bk.conta, pix: bk.pix, liminarFunrural: contrato.liminarFunrural, nome: contrato.produtor }, "boleta " + b.codigo);
        if (fid) db.prepare("UPDATE boletas SET fornecedor_id = ? WHERE id = ?").run(fid, b.id);
      }
      const historico = [...b.historico, { em: agora(), papel: "mesa", por: req.usuario.nome, acao: acao === "aprovar" ? `Aprovada · contrato ${mesa.contratoNumero}` : acao === "ajuste" ? "Devolvida para ajuste" : "Reprovada", texto: parecer }];
      db.prepare("UPDATE boletas SET status = ?, mesa = ?, historico = ?, atualizado_em = ? WHERE id = ?").run(status, JSON.stringify(mesa), JSON.stringify(historico), agora(), b.id);
      return { b, mesa, status };
    });
    const { b, mesa, status } = resultado;
    const corretor = db.prepare("SELECT email, nome FROM usuarios WHERE id = ?").get(b.corretorId);
    const frase = status === "aprovada" ? `foi aprovada. Contrato nº ${mesa.contratoNumero}.` : status === "ajuste" ? "foi devolvida para ajuste." : "foi reprovada.";
    carteiro.enviar(corretor?.email, `Boleta ${b.codigo} ${status === "aprovada" ? "aprovada" : status === "ajuste" ? "devolvida para ajuste" : "reprovada"}`,
      `Olá, ${corretor?.nome}.\n\nA boleta ${b.codigo} (${b.cliente.nome}) ${frase}${parecer ? `\n\nParecer da mesa: ${parecer}` : ""}\n\nAbrir: ${link("/#minhas")}`);
    res.json(lerBoleta(db.prepare(SQL_BOLETA + " WHERE b.id = ?").get(b.id)));
  }));

  // ---------- contratos ----------
  function filtrarContratos(q) {
    const lista = db.prepare("SELECT * FROM contratos").all().map(lerContrato);
    const busca = texto(q.q, 100).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), dq = R.digitos(q.q);
    return lista.filter(c => (!q.filial || c.filial === q.filial) && (!q.corretor || c.corretor === q.corretor) && (!q.assin || c.posicaoAssinatura === q.assin) && (!q.pag || c.statusPagamento === q.pag)
      && (!busca || `${c.produtor} ${c.numero} ${c.fazenda}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(busca) || (dq.length >= 3 && R.digitos(`${c.cpf}${c.cnpj}`).includes(dq))))
      .sort((a, b) => (Number(b.ano) - Number(a.ano)) || (b.seq - a.seq));
  }
  app.get("/api/contratos", A.exigir("mesa", "admin"), (req, res) => res.json(filtrarContratos({})));
  app.get("/api/contratos/exportar", A.exigir("mesa", "admin"), rota(async (req, res) => {
    const buf = await P.gerarExportacao(filtrarContratos(req.query));
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Controle Contratos Yukaer ${agora().slice(0, 10)}.xlsx"` });
    res.send(Buffer.from(buf));
  }));
  app.patch("/api/contratos/:id", A.exigir("mesa", "admin"), rota((req, res) => {
    const row = db.prepare("SELECT * FROM contratos WHERE id = ?").get(Number(req.params.id));
    if (!row) falha(404, "Contrato não encontrado.");
    const dados = json(row.dados);
    for (const k of EDITAVEIS_CONTRATO) if (k in (req.body || {})) dados[k] = NUM_CONTRATO.has(k) ? R.num(req.body[k]) : texto(req.body[k], 2000);
    if (req.body?.statusPagamento === "PAGO") { if (!dados.dataRealPagamento) dados.dataRealPagamento = agora().slice(0, 10); if (!R.num(dados.valorPago)) dados.valorPago = R.num(dados.valorAPagar); }
    db.prepare("UPDATE contratos SET dados = ?, atualizado_em = ? WHERE id = ?").run(JSON.stringify(dados), agora(), row.id);
    res.json(lerContrato(db.prepare("SELECT * FROM contratos WHERE id = ?").get(row.id)));
  }));
  app.post("/api/contratos/importar", A.exigir("admin"), uploadPlanilha.single("arquivo"), rota(async (req, res) => {
    if (!req.file) falha(400, "Envie o arquivo do Controle de Contratos (.xlsx ou .xlsm).");
    let lido;
    try { lido = await P.lerControle(req.file.buffer, req.file.originalname); } catch (e) { falha(400, e.message); }
    res.json(importarControle(lido, "planilha " + texto(req.file.originalname, 120)));
  }));
  function importarControle({ contratos, fornecedores }, origem) {
    return transacao(db, () => {
      let novos = 0, existentes = 0;
      for (const c of contratos) {
        const { numero, ano, seq, ...dados } = c;
        if (db.prepare("SELECT 1 FROM contratos WHERE numero = ?").get(numero)) { existentes++; continue; }
        db.prepare("INSERT INTO contratos (ano, seq, numero, dados, atualizado_em) VALUES (?, ?, ?, ?, ?)").run(ano, seq, numero, JSON.stringify(dados), agora());
        novos++;
      }
      let forn = 0; for (const f of fornecedores) if (upsertFornecedor(f, origem)) forn++;
      return { contratosNovos: novos, contratosJaExistentes: existentes, fornecedores: forn };
    });
  }

  // ---------- usuários ----------
  app.get("/api/usuarios", A.exigir("mesa", "admin"), (req, res) => res.json(db.prepare("SELECT * FROM usuarios ORDER BY papel, nome").all().map(A.usuarioPublico)));
  app.post("/api/usuarios", A.exigir("mesa", "admin"), rota((req, res) => {
    const b = req.body || {};
    const papel = ["admin", "mesa", "corretor"].includes(b.papel) ? b.papel : "corretor";
    if (papel !== "corretor" && req.usuario.papel !== "admin") falha(403, "Só o administrador cadastra usuários da mesa.");
    const email = texto(b.email, 200).toLowerCase(), nome = texto(b.nome, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nome) falha(400, "Informe nome e e-mail válidos.");
    const corretorNome = texto(b.corretorNome, 60).toUpperCase();
    if (papel === "corretor" && !corretorNome) falha(400, "Informe o nome do corretor como aparece no controle (ex.: GUTO).");
    if (db.prepare("SELECT 1 FROM usuarios WHERE email = ?").get(email)) falha(409, "Já existe um usuário com este e-mail.");
    const senha = A.senhaTemporaria();
    db.prepare("INSERT INTO usuarios (email, nome, papel, corretor_nome, empresa, telefone, senha_hash, trocar_senha, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)")
      .run(email, nome, papel, corretorNome || null, texto(b.empresa, 120), texto(b.telefone, 40), A.hashSenha(senha), agora());
    const u = db.prepare("SELECT * FROM usuarios WHERE email = ?").get(email);
    carteiro.enviar(email, "Seu acesso à Mesa de Negociação Yukaer", `Olá, ${nome}.\n\nSeu acesso foi criado.\nEndereço: ${link("/")}\nE-mail: ${email}\nSenha provisória: ${senha}\n\nNo primeiro acesso você vai criar sua própria senha.`);
    res.json({ usuario: A.usuarioPublico(u), senhaTemporaria: senha });
  }));
  app.patch("/api/usuarios/:id", A.exigir("mesa", "admin"), rota((req, res) => {
    const u = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(Number(req.params.id));
    if (!u) falha(404, "Usuário não encontrado.");
    if (u.papel !== "corretor" && req.usuario.papel !== "admin") falha(403, "Só o administrador altera usuários da mesa.");
    const b = req.body || {};
    const campos = {
      nome: "nome" in b ? texto(b.nome, 120) || u.nome : u.nome,
      corretor_nome: "corretorNome" in b ? texto(b.corretorNome, 60).toUpperCase() || null : u.corretor_nome,
      empresa: "empresa" in b ? texto(b.empresa, 120) : u.empresa,
      telefone: "telefone" in b ? texto(b.telefone, 40) : u.telefone,
      ativo: "ativo" in b ? (b.ativo ? 1 : 0) : u.ativo,
    };
    if (u.id === req.usuario.id && !campos.ativo) falha(400, "Você não pode desativar o próprio acesso.");
    db.prepare("UPDATE usuarios SET nome = ?, corretor_nome = ?, empresa = ?, telefone = ?, ativo = ? WHERE id = ?").run(campos.nome, campos.corretor_nome, campos.empresa, campos.telefone, campos.ativo, u.id);
    if (!campos.ativo) db.prepare("DELETE FROM sessoes WHERE usuario_id = ?").run(u.id);
    res.json(A.usuarioPublico(db.prepare("SELECT * FROM usuarios WHERE id = ?").get(u.id)));
  }));
  app.post("/api/usuarios/:id/redefinir-senha", A.exigir("mesa", "admin"), rota((req, res) => {
    const u = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(Number(req.params.id));
    if (!u) falha(404, "Usuário não encontrado.");
    if (u.papel !== "corretor" && req.usuario.papel !== "admin") falha(403, "Só o administrador redefine senhas da mesa.");
    const senha = A.senhaTemporaria();
    db.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 1 WHERE id = ?").run(A.hashSenha(senha), u.id);
    db.prepare("DELETE FROM sessoes WHERE usuario_id = ?").run(u.id);
    res.json({ senhaTemporaria: senha });
  }));

  // ---------- páginas ----------
  app.get("/saude", (_req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: config.producao ? "1h" : 0 }));
  app.use("/api", (_req, res) => res.status(404).json({ erro: "Endereço não encontrado." }));

  app.use((err, req, res, _next) => {
    if (err instanceof Erro) return res.status(err.status).json({ erro: err.message });
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(400).json({ erro: "Arquivo grande demais." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ erro: "Dados inválidos." });
    console.error(err);
    res.status(500).json({ erro: "Erro inesperado no servidor. Tente de novo." });
  });

  app.locals.db = db;
  app.locals.carteiro = carteiro;
  app.locals.importarControle = importarControle;
  return app;
}

module.exports = { criarApp };
