const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { criarApp } = require("../server/app");
const { abrir, agora } = require("../server/db");
const A = require("../server/auth");
const R = require("../public/regras");

let servidor, base, db, carteiro, pasta;

before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), "yk-"));
  db = abrir(":memory:");
  carteiro = { enviados: [], enviar: async (para, assunto, texto) => carteiro.enviados.push({ para, assunto, texto }) };
  db.prepare("INSERT INTO usuarios (email, nome, papel, senha_hash, trocar_senha, ativo, criado_em) VALUES (?, ?, 'admin', ?, 0, 1, ?)").run("admin@yukaer.com.br", "Admin", A.hashSenha("Admin12345"), agora());
  // contrato existente para testar a numeração seguinte
  db.prepare("INSERT INTO contratos (ano, seq, numero, dados, atualizado_em) VALUES ('2027', 315, '315/2027', '{}', ?)").run(agora());
  const app = criarApp({ db, carteiro, pastaArquivos: pasta, emailsMesa: [], urlBase: "http://teste" });
  await new Promise(r => { servidor = app.listen(0, r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.close(); fs.rmSync(pasta, { recursive: true, force: true }); });

function cliente() {
  let cookie = "";
  return async (metodo, url, corpo, extra = {}) => {
    const headers = { "X-Yukaer": "1", ...(cookie ? { cookie } : {}), ...(extra.headers || {}) };
    let body;
    if (corpo instanceof FormData) body = corpo;
    else if (corpo !== undefined) { body = JSON.stringify(corpo); headers["Content-Type"] = "application/json"; }
    const r = await fetch(base + url, { method: metodo, headers, body });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const tipo = r.headers.get("content-type") || "";
    return { status: r.status, dados: tipo.includes("json") ? await r.json() : await r.arrayBuffer() };
  };
}

const boleta = (extra = {}) => ({
  cliente: { nome: "Produtor Teste", tipoVendedor: "Pessoa Física", cpf: "123.456.789-01", ie: "001", propriedade: "Fazenda Teste", municipio: "Ibiá", estado: "MG" },
  neg: { tipoContrato: "Grãos FIXADO", moeda: "R$ (Real)", mercadoria: "Soja em Grãos", transgenia: "GMO Positivo", safra: "2026/2027", volumeKg: "60000", preco: "120", declFunrural: "Não",
    frete: "CIF Armazém", filial: "Yukaer Agro - Ibiá/MG", entregaDe: "2027-02-01", entregaAte: "2027-03-01", local: "Armazém Ibiá", pgtoData: "2027-04-30", comissaoSc: "0.5", pesoClass: "Peso Destino / Análise Destino" },
  banco: { banco: "Sicoob", agencia: "0001", conta: "123-4" }, obs: "", ...extra,
});

let admin, corretor, outro, idBoleta;

test("cálculo da boleta", () => {
  const c = R.calcular(boleta());
  assert.equal(c.sc, 1000);
  assert.equal(c.bruto, 120000);
  assert.ok(Math.abs(c.funrural + 1956) < 1e-6);
  assert.ok(Math.abs(c.liquido - 118044) < 1e-6);
  assert.equal(c.comissao, 500);
  assert.equal(R.calcular({ ...boleta(), cliente: { tipoVendedor: "Pessoa Jurídica" } }).pct, 0);
  assert.equal(R.anoDaSafra("2026/2027"), "2027");
  assert.equal(R.formatarNumero(7, "2027"), "07/2027");
});

test("login e escrita sem cabeçalho de proteção", async () => {
  admin = cliente();
  assert.equal((await admin("POST", "/api/entrar", { email: "admin@yukaer.com.br", senha: "errada1234" })).status, 401);
  const r = await admin("POST", "/api/entrar", { email: "ADMIN@yukaer.com.br", senha: "Admin12345" });
  assert.equal(r.status, 200);
  assert.equal(r.dados.usuario.papel, "admin");
  const semCab = await admin("POST", "/api/usuarios", { nome: "x" }, { headers: { "X-Yukaer": "" } });
  assert.equal(semCab.status, 403);
  assert.equal((await cliente()("GET", "/api/boletas")).status, 401);
});

test("mesa cadastra corretores e eles trocam a senha provisória", async () => {
  const fazer = async (email, cn) => {
    const r = await admin("POST", "/api/usuarios", { nome: "Corretor " + cn, email, papel: "corretor", corretorNome: cn.toLowerCase() });
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario.corretorNome, cn);
    const c = cliente();
    assert.equal((await c("POST", "/api/entrar", { email, senha: r.dados.senhaTemporaria })).status, 200);
    const bloqueado = await c("GET", "/api/boletas");
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.dados.trocarSenha, true);
    assert.equal((await c("POST", "/api/eu/senha", { atual: r.dados.senhaTemporaria, nova: "curta" })).status, 400);
    assert.equal((await c("POST", "/api/eu/senha", { atual: r.dados.senhaTemporaria, nova: "SenhaNova123" })).status, 200);
    assert.equal((await c("GET", "/api/boletas")).status, 200);
    return c;
  };
  corretor = await fazer("guto@corretora.com", "GUTO");
  outro = await fazer("beto@corretora.com", "BETO");
  assert.ok(carteiro.enviados.some(e => String(e.para).includes("guto@corretora.com") && e.texto.includes("Senha provisória")));
  assert.equal((await admin("POST", "/api/usuarios", { nome: "Dup", email: "guto@corretora.com", papel: "corretor", corretorNome: "X" })).status, 409);
  assert.equal((await corretor("GET", "/api/usuarios")).status, 403);
});

test("busca de fornecedores do corretor vem mascarada", async () => {
  const f = await admin("POST", "/api/fornecedores", { nome: "JOÃO DA BASE", tipo: "Pessoa Física", cpf: "111.222.333-44", ie: "999", fazenda: "Fazenda Base", banco: "Itaú", agencia: "1", conta: "2" });
  assert.equal(f.status, 200);
  const r = await corretor("GET", "/api/fornecedores?q=joao");
  assert.equal(r.dados.fornecedores.length, 1);
  assert.equal(r.dados.fornecedores[0].documento, "CPF ••33344");
  assert.equal(r.dados.fornecedores[0].cpf, undefined);
  assert.equal((await corretor("GET", "/api/fornecedores?q=jo")).dados.fornecedores.length, 0);
  const completo = await corretor("GET", "/api/fornecedores/" + f.dados.id);
  assert.equal(completo.dados.banco, "Itaú");
  assert.equal((await corretor("POST", "/api/fornecedores", { nome: "x", cpf: "1" })).status, 403);
});

test("corretor salva rascunho, anexa documento e envia", async () => {
  const incompleta = await corretor("POST", "/api/boletas", { ...boleta(), neg: {}, enviar: true });
  assert.equal(incompleta.status, 400);
  assert.match(incompleta.dados.erro, /Falta preencher/);
  const r = await corretor("POST", "/api/boletas", boleta());
  assert.equal(r.status, 200);
  assert.equal(r.dados.status, "rascunho");
  assert.match(r.dados.codigo, /^B\d{4}-\d{4}$/);
  idBoleta = r.dados.id;

  const fd = new FormData();
  fd.append("tipo", "doc_id");
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 teste")], { type: "application/pdf" }), "rg.pdf");
  const up = await corretor("POST", `/api/boletas/${idBoleta}/documentos`, fd);
  assert.equal(up.status, 200);
  assert.equal(up.dados.documentos.length, 1);
  const fdRuim = new FormData();
  fdRuim.append("tipo", "doc_id");
  fdRuim.append("arquivo", new Blob(["x"], { type: "text/html" }), "x.html");
  assert.equal((await corretor("POST", `/api/boletas/${idBoleta}/documentos`, fdRuim)).status, 400);

  // a mesa não vê rascunhos e o outro corretor não vê a boleta
  assert.equal((await admin("GET", "/api/boletas")).dados.length, 0);
  assert.equal((await outro("GET", `/api/boletas/${idBoleta}`)).status, 404);
  assert.equal((await outro("GET", `/api/documentos/${up.dados.documentos[0].id}`)).status, 404);

  const env = await corretor("PUT", `/api/boletas/${idBoleta}`, { ...boleta(), enviar: true });
  assert.equal(env.status, 200);
  assert.equal(env.dados.status, "enviada");
  assert.ok(carteiro.enviados.some(e => e.assunto.includes(env.dados.codigo)));
  assert.equal((await corretor("PUT", `/api/boletas/${idBoleta}`, boleta())).status, 409);
  const doc = await admin("GET", `/api/documentos/${up.dados.documentos[0].id}`);
  assert.equal(doc.status, 200);
});

test("mesa devolve para ajuste, corretor reenvia e mesa aprova com o próximo número", async () => {
  assert.equal((await corretor("POST", `/api/boletas/${idBoleta}/decisao`, { acao: "aprovar" })).status, 403);
  assert.equal((await admin("POST", `/api/boletas/${idBoleta}/decisao`, { acao: "ajuste" })).status, 400);
  const aj = await admin("POST", `/api/boletas/${idBoleta}/decisao`, { acao: "ajuste", parecer: "Conferir a conta" });
  assert.equal(aj.dados.status, "ajuste");
  const re = await corretor("PUT", `/api/boletas/${idBoleta}`, { ...boleta({ banco: { banco: "Sicoob", agencia: "0001", conta: "999-9" } }), enviar: true });
  assert.equal(re.dados.status, "enviada");
  assert.equal(re.dados.historico.length, 3);

  const ap = await admin("POST", `/api/boletas/${idBoleta}/decisao`, { acao: "aprovar", responsavel: "Flávio", checklist: { Assinatura: true } });
  assert.equal(ap.status, 200);
  assert.equal(ap.dados.status, "aprovada");
  assert.equal(ap.dados.mesa.contratoNumero, "316/2027");
  assert.equal((await admin("POST", `/api/boletas/${idBoleta}/decisao`, { acao: "aprovar" })).status, 409);

  const contratos = (await admin("GET", "/api/contratos")).dados;
  const c = contratos.find(x => x.numero === "316/2027");
  assert.equal(c.corretor, "GUTO");
  assert.equal(c.qtdSc, 1000);
  assert.equal(c.conta, "999-9");
  assert.equal(c.posicaoAssinatura, "A EMITIR");
  assert.equal(c.liminarFunrural, "NÃO");
  // o produtor novo entrou na base
  assert.equal((await admin("GET", "/api/fornecedores?q=produtor teste")).dados.total, 1);
  assert.ok(carteiro.enviados.some(e => String(e.para).includes("guto@corretora.com") && e.texto.includes("316/2027")));

  const pago = await admin("PATCH", `/api/contratos/${c.id}`, { statusPagamento: "PAGO", produtor: "NÃO PODE" });
  assert.equal(pago.dados.statusPagamento, "PAGO");
  assert.equal(pago.dados.produtor, "PRODUTOR TESTE");
  assert.ok(pago.dados.valorPago > 0);
  assert.equal((await corretor("GET", "/api/contratos")).status, 403);

  const xl = await admin("GET", "/api/contratos/exportar?q=316");
  assert.equal(xl.status, 200);
  assert.ok(xl.dados.byteLength > 1000);
});

test("corretor bloqueado perde o acesso", async () => {
  const lista = (await admin("GET", "/api/usuarios")).dados;
  const beto = lista.find(u => u.email === "beto@corretora.com");
  assert.equal((await admin("PATCH", `/api/usuarios/${beto.id}`, { ativo: false })).status, 200);
  assert.equal((await outro("GET", "/api/boletas")).status, 401);
});
