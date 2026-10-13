// Leitura e geração de planilhas: importação do Controle de Contratos (aba Compras),
// importação da base de fornecedores (exportação do Zaak) e exportação do controle.
const ExcelJS = require("exceljs");
const { num, digitos } = require("../public/regras");

const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Valor "limpo" de uma célula do ExcelJS.
function valor(v) {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("error" in v) return "";
    if ("result" in v) return valor(v.result);
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("");
    if ("text" in v) return valor(v.text);
    return "";
  }
  return v;
}
function texto(v) {
  v = valor(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return ["-", "#VALUE!", "#N/A", "#REF!", "None"].includes(s) ? "" : s;
}
function data(v) { v = valor(v); if (v instanceof Date) return v.toISOString().slice(0, 10); const s = texto(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; }

// Colunas da aba Compras -> campos do contrato.
const COLUNAS_COMPRAS = {
  numero: "Nº Contrato", numeroTerceiros: "Nº Contrato Terceiros", filial: "Filial Comprador", dataCompra: "Data Compra", tipoContrato: "Tipo de Contrato",
  produto: "Produto", safra: "Safra", produtor: "Produtor", tipoVendedor: "Tipo Vendedor", cpf: "CPF", cnpj: "CNPJ", ie: "Inscrição Estadual", car: "CAR",
  fazenda: "Fazenda/Sítio", municipio: "Município", estado: "Estado", endereco: "Endereço", telefone: "Telefone", email: "E-mail", banco: "Banco",
  agencia: "Agência", conta: "Conta", pix: "PIX", liminarFunrural: "Liminar Funrural", certidaoPenhor: "Certidão Penhor", outrosDocumentos: "Outros Documentos",
  posicaoOutrosDocumentos: "Posição Outros Documentos", favorecido: "Favorecido", qtdKgOrigem: "Qdt/KG - Origem", qtdKg: "Qde/KG", qtdSc: "Qtde Saco",
  umidade: "Umidade", impurezas: "Impurezas", avariados: "Avariados", outrosQualidade: "Outros", tipoFrete: "Tipo Frete", localEntrega: "Local Entrega/Retirada",
  dataEntrega: "Data Entrega", valorSaco: "Valor Saco", valorContrato: "Valor Contrato", pctFunrural: "% Senar/Funrural", valorFunrural: "Valor Senar/Funrural",
  descRoyalties: "Desc. Royalties", descAntecipacao: "Desc. Antecipação Pagamento", valorLiquido: "Valor Líquido", observacoes: "Observações",
  posicaoAssinatura: "Posição Assinatura Contrato", reconhecido: "Reconhecido", valorAPagar: "Valor a Pagar", tipoPagamento: "Tipo de Pagamento",
  dataPagamento: "Data Pagamento", dataRealPagamento: "Data Real Pagto.", valorPago: "Valor Pago", statusPagamento: "Status Pagamento",
  posicaoEntregas: "Posiçao de Entregas", corretor: "Corretor", comissao: "Comissão", valorComissao: "Valor a Receber Comissão",
  dataPagamentoComissao: "Data Pagamento Comissão", situacaoComissao: "Situação Comissão", qtdFiscal: "Fiscal Sistema", qtdBalanca: "Balança Sistema", aRetirar: "A Retirar/Receber",
};
const NUMERICOS = new Set(["qtdKgOrigem", "qtdKg", "qtdSc", "umidade", "impurezas", "avariados", "valorSaco", "valorContrato", "pctFunrural", "valorFunrural", "descRoyalties", "descAntecipacao", "valorLiquido", "valorAPagar", "valorPago", "comissao", "valorComissao", "qtdFiscal", "qtdBalanca", "aRetirar"]);
const DATAS = new Set(["dataCompra", "dataPagamento", "dataRealPagamento", "dataPagamentoComissao"]);

// Ordem e títulos da exportação (mesmo layout da aba Compras).
const EXPORTACAO = [
  ["numero", "Nº Contrato"], ["filial", "Filial Comprador"], ["dataCompra", "Data Compra"], ["tipoContrato", "Tipo de Contrato"], ["produto", "Produto"], ["safra", "Safra"],
  ["produtor", "Produtor"], ["tipoVendedor", "Tipo Vendedor"], ["cpf", "CPF"], ["cnpj", "CNPJ"], ["ie", "Inscrição Estadual"], ["car", "CAR"], ["fazenda", "Fazenda/Sítio"],
  ["municipio", "Município"], ["estado", "Estado"], ["endereco", "Endereço"], ["telefone", "Telefone"], ["email", "E-mail"], ["banco", "Banco"], ["agencia", "Agência"],
  ["conta", "Conta"], ["pix", "PIX"], ["liminarFunrural", "Liminar Funrural"], ["certidaoPenhor", "Certidão Penhor"], ["outrosDocumentos", "Outros Documentos"],
  ["posicaoOutrosDocumentos", "Posição Outros Documentos"], ["qtdKg", "Qde/KG"], ["qtdSc", "Qtde Saco"], ["tipoFrete", "Tipo Frete"], ["localEntrega", "Local Entrega/Retirada"],
  ["dataEntrega", "Data Entrega"], ["valorSaco", "Valor Saco"], ["valorContrato", "Valor Contrato"], ["pctFunrural", "% Senar/Funrural"], ["valorFunrural", "Valor Senar/Funrural"],
  ["descRoyalties", "Desc. Royalties"], ["descAntecipacao", "Desc. Antecipação Pagamento"], ["valorLiquido", "Valor Líquido"], ["observacoes", "Observações"],
  ["posicaoAssinatura", "Posição Assinatura Contrato"], ["reconhecido", "Reconhecido"], ["valorAPagar", "Valor a Pagar"], ["tipoPagamento", "Tipo de Pagamento"],
  ["dataPagamento", "Data Pagamento"], ["dataRealPagamento", "Data Real Pagto."], ["valorPago", "Valor Pago"], ["statusPagamento", "Status Pagamento"],
  ["posicaoEntregas", "Posiçao de Entregas"], ["corretor", "Corretor"], ["comissao", "Comissão"], ["valorComissao", "Valor a Receber Comissão"],
  ["dataPagamentoComissao", "Data Pagamento Comissão"], ["situacaoComissao", "Situação Comissão"], ["qtdFiscal", "Fiscal Sistema"], ["qtdBalanca", "Balança Sistema"],
  ["aRetirar", "A Retirar/Receber"], ["responsavel", "Responsável"], ["codigoBoleta", "Boleta"],
];

async function abrirPlanilha(buffer, nomeArquivo) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(nomeArquivo || "")) {
    const ws = wb.addWorksheet("CSV");
    for (const linha of lerCsv(buffer.toString("utf8"))) ws.addRow(linha);
  } else {
    await wb.xlsx.load(buffer);
  }
  return wb;
}

// CSV com ; ou , e aspas.
function lerCsv(txt) {
  txt = txt.replace(/^﻿/, "");
  const primeira = txt.split(/\r?\n/, 1)[0] || "";
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";
  const linhas = []; let linha = [], campo = "", aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; continue; }
    if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && txt[i + 1] === "\n") i++; linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Procura a linha de cabeçalho que contém as colunas pedidas (nas primeiras 30 linhas).
function acharCabecalho(ws, obrigatorias) {
  const alvo = obrigatorias.map(norm);
  for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
    const vals = []; ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => { vals[col] = norm(texto(c.value)); });
    if (alvo.every(a => vals.includes(a))) return { linha: r, colunas: vals };
  }
  return null;
}

// Lê a aba Compras do Controle de Contratos. Retorna { contratos, fornecedores }.
async function lerControle(buffer, nomeArquivo) {
  const wb = await abrirPlanilha(buffer, nomeArquivo);
  const ws = wb.getWorksheet("Compras") || wb.worksheets.find(w => acharCabecalho(w, ["Nº Contrato", "Produtor"]));
  if (!ws) throw new Error("Não encontrei a aba Compras com as colunas Nº Contrato e Produtor.");
  const cab = acharCabecalho(ws, ["Nº Contrato", "Produtor"]);
  if (!cab) throw new Error("Não encontrei o cabeçalho da aba Compras (Nº Contrato, Produtor).");
  const idx = {}; for (const [k, h] of Object.entries(COLUNAS_COMPRAS)) { const i = cab.colunas.indexOf(norm(h)); if (i > 0) idx[k] = i; }
  const contratos = [], fornecedores = new Map();
  let vazias = 0;
  for (let r = cab.linha + 1; r <= ws.rowCount && vazias < 50; r++) {
    const row = ws.getRow(r);
    const numero = texto(row.getCell(idx.numero).value);
    const m = numero.match(/^(\d+)\s*\/\s*(\d{4})$/);
    if (!m) { vazias++; continue; }
    vazias = 0;
    const c = {};
    for (const [k, i] of Object.entries(idx)) {
      const v = row.getCell(i).value;
      c[k] = NUMERICOS.has(k) ? num(valor(v)) : DATAS.has(k) ? data(v) : texto(v);
    }
    c.seq = Number(m[1]); c.ano = m[2]; c.numero = `${m[1]}/${m[2]}`;
    if (!c.situacaoComissao) c.situacaoComissao = c.comissao > 0 ? "EM ABERTO" : "SEM COMISSÃO";
    c.origem = "planilha";
    contratos.push(c);
    const pf = /F[IÍ]S/i.test(c.tipoVendedor);
    const chave = digitos(pf ? c.cpf : c.cnpj);
    if (chave && c.produtor) fornecedores.set(chave, {
      chave, nome: c.produtor, tipo: pf ? "Pessoa Física" : "Pessoa Jurídica", cpf: pf ? c.cpf : "", cnpj: pf ? "" : c.cnpj, ie: c.ie, car: c.car, fazenda: c.fazenda,
      municipio: c.municipio, estado: c.estado, endereco: c.endereco, telefone: c.telefone, email: c.email, banco: c.banco, agencia: c.agencia, conta: c.conta, pix: c.pix,
      liminarFunrural: c.liminarFunrural,
    });
  }
  return { contratos, fornecedores: [...fornecedores.values()] };
}

// Lê uma exportação de fornecedores (Zaak ou planilha própria).
const APELIDOS = {
  nome: ["produtor", "nome", "razao social", "razao social/nome completo", "fornecedor", "nome completo", "nome/razao social"],
  tipo: ["tipo vendedor", "tipo", "tipo do vendedor", "tipo pessoa", "pessoa"], cpf: ["cpf"], cnpj: ["cnpj"], cpfCnpj: ["cpf/cnpj", "cnpj/cpf", "documento"],
  ie: ["inscricao estadual", "ie", "i.e.", "insc. estadual"], car: ["car"], fazenda: ["fazenda/sitio", "fazenda", "propriedade", "nome propriedade"],
  municipio: ["municipio", "cidade"], estado: ["estado", "uf"], endereco: ["endereco", "endereco fazenda", "logradouro"], telefone: ["telefone", "celular", "telefone/celular", "fone"],
  email: ["e-mail", "email"], banco: ["banco"], agencia: ["agencia"], conta: ["conta", "c/c", "conta corrente"], pix: ["pix", "chave pix"], liminarFunrural: ["liminar funrural", "funrural"],
};
async function lerFornecedores(buffer, nomeArquivo) {
  const wb = await abrirPlanilha(buffer, nomeArquivo);
  for (const ws of wb.worksheets) {
    let cab = null;
    for (const nomeCol of APELIDOS.nome) {
      for (const doc of ["cpf", "cnpj", "cpf/cnpj", "cnpj/cpf", "documento"]) { cab = acharCabecalho(ws, [nomeCol, doc]); if (cab) break; }
      if (cab) break;
    }
    if (!cab) continue;
    const idx = {}; for (const [k, al] of Object.entries(APELIDOS)) { const i = cab.colunas.findIndex(c => al.includes(c)); if (i > 0) idx[k] = i; }
    const out = new Map();
    for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); const f = {};
      for (const [k, i] of Object.entries(idx)) f[k] = texto(row.getCell(i).value);
      if (!f.nome) continue;
      if (f.cpfCnpj) { const d = digitos(f.cpfCnpj); if (d.length === 14) f.cnpj = f.cnpj || f.cpfCnpj; else f.cpf = f.cpf || f.cpfCnpj; }
      delete f.cpfCnpj;
      const pj = /jur|pj/i.test(f.tipo || "") || (!digitos(f.cpf) && digitos(f.cnpj).length === 14);
      f.tipo = pj ? "Pessoa Jurídica" : "Pessoa Física";
      f.chave = digitos(pj ? f.cnpj : f.cpf);
      if (f.chave) out.set(f.chave, f);
    }
    return [...out.values()];
  }
  throw new Error("Não encontrei colunas de nome e CPF/CNPJ. A planilha precisa de cabeçalhos como Produtor (ou Nome) e CPF, CNPJ.");
}

async function gerarExportacao(contratos) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compras");
  ws.columns = EXPORTACAO.map(([k, h]) => ({ header: h, key: k, width: Math.max(12, Math.min(40, h.length + 4)) }));
  for (const c of contratos) {
    const linha = {};
    for (const [k] of EXPORTACAO) linha[k] = DATAS.has(k) && c[k] ? new Date(c[k] + "T00:00:00Z") : c[k] ?? "";
    ws.addRow(linha);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const [k] of EXPORTACAO) {
    const col = ws.getColumn(k);
    if (DATAS.has(k)) col.numFmt = "dd/mm/yyyy";
    else if (k === "pctFunrural") col.numFmt = "0.00%";
    else if (NUMERICOS.has(k)) col.numFmt = "#,##0.00";
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { lerControle, lerFornecedores, gerarExportacao, lerCsv, EXPORTACAO };
