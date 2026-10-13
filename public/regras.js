// Regras de negócio compartilhadas entre o navegador e o servidor.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Regras = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LISTAS = {
    tipoVendedor: ["Pessoa Física", "Pessoa Jurídica"],
    tipoContrato: ["Grãos FIXADO", "Grãos A FIXAR", "Soja Verde"],
    moeda: ["R$ (Real)", "U$ (Dólar)"],
    mercadoria: ["Soja em Grãos", "Milho em Grãos", "Sorgo em Grãos"],
    transgenia: ["GMO Positivo", "GMO FREE", "Sorgo", "Milho"],
    frete: ["CIF Armazém", "CIF Fazenda", "FOB Armazém", "FOB Fazenda"],
    filial: ["Yukaer Agro - Barra do Garça/MT", "Yukaer Agro - Catalão/GO", "Yukaer Agro - Estiva Gerbi/SP", "Yukaer Agro - Ibiá/MG", "Yukaer Agro - Patrocínio/MG", "Yukaer Agro - Pedrinópolis/MG", "Yukaer Agro - Uberaba/MG", "Yukaer Agro - Uberlândia/MG"],
    pesoClass: ["Peso Destino / Análise Destino", "Peso Origem / Análise Origem", "Peso Origem / Análise Destino"],
    simNao: ["Não", "Sim"],
    tipoConta: ["Conta Corrente", "Poupança"],
    opFiscal: ["NF Própria", "NF Trânsito", "NF Remessa"],
    assinatura: ["A EMITIR", "ENVIADO P/ASSINATURA", "DIGITAL RECEBIDO", "ENTREGUE EM FILIAL"],
    pagamento: ["EM ABERTO", "PAGO"],
    entregas: ["EM ABERTO", "PARCIAL", "CONCLUÍDA"],
    comissao: ["EM ABERTO", "PAGA", "SEM COMISSÃO"],
  };

  const DOCUMENTOS = [
    ["doc_id", "Documento pessoal com foto (PF) / cartão completo (PJ)"],
    ["cnpj", "Cartão CNPJ, QSA e Contrato Social (PJ)"],
    ["ie", "Inscrição Estadual emitida há menos de 30 dias"],
    ["funrural", "Termo de opção de recolhimento do FUNRURAL"],
    ["endereco", "Comprovante de endereço (até 3 meses)"],
    ["banco", "Comprovante de dados bancários"],
    ["car", "CAR de todas as áreas de produção"],
  ];

  const CHECKLIST_MESA = ["Assinatura", "Comprovante de Conta", "Cópia", "Original", "Certidão de Penhor", "Liberação de Penhor", "Declaração Funrural", "NP/CPR"];

  const STATUS = { rascunho: "Rascunho", enviada: "Aguardando mesa", ajuste: "Devolvida p/ ajuste", aprovada: "Aprovada", reprovada: "Reprovada" };

  // Aceita "1.234,56", "1234.56" ou número.
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v ?? "").trim();
    if (!s) return 0;
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return isFinite(n) ? n : 0;
  }

  // Cálculo da boleta: sacas de 60 kg, Funrural 0,2% com declaração, 1,63% sem, PJ isento.
  function calcular(boleta) {
    const c = boleta.cliente || {}, n = boleta.neg || {};
    const kg = num(n.volumeKg), sc = kg / 60, preco = num(n.preco);
    const bruto = sc * preco;
    const pj = c.tipoVendedor === "Pessoa Jurídica";
    const pct = pj ? 0 : (n.declFunrural === "Sim" ? 0.002 : 0.0163);
    const funrural = -bruto * pct;
    const descGmo = num(n.descGmo) * sc;
    const comissao = num(n.comissaoSc) * sc;
    const liquido = bruto + funrural - descGmo;
    const moeda = String(n.moeda || "").startsWith("U$") ? "U$" : "R$";
    return { kg, sc, preco, bruto, pct, funrural, descGmo, comissao, liquido, precoKg: preco / 60, moeda };
  }

  const OBRIGATORIOS = [
    ["cliente.nome", "Nome"], ["cliente.ie", "Inscrição estadual"], ["cliente.propriedade", "Propriedade"],
    ["neg.safra", "Safra"], ["neg.volumeKg", "Volume"], ["neg.preco", "Preço"], ["neg.frete", "Frete"], ["neg.filial", "Filial"],
    ["neg.entregaDe", "Entrega de"], ["neg.entregaAte", "Entrega até"], ["neg.local", "Local de entrega"], ["neg.pgtoData", "Data de pagamento"],
    ["neg.comissaoSc", "Comissão"], ["neg.pesoClass", "Peso e classificação"], ["banco.banco", "Banco"], ["banco.agencia", "Agência"], ["banco.conta", "Conta"],
  ];
  const digitos = s => String(s || "").replace(/\D/g, "");

  function camposFaltando(b) {
    const out = OBRIGATORIOS.filter(([p]) => { const [g, k] = p.split("."); return !String(b[g]?.[k] ?? "").trim(); }).map(x => x[1]);
    const c = b.cliente || {};
    if (c.tipoVendedor === "Pessoa Jurídica") { if (!digitos(c.cnpj)) out.push("CNPJ"); }
    else if (!digitos(c.cpf)) out.push("CPF");
    if (num(b.neg?.volumeKg) <= 0 && !out.includes("Volume")) out.push("Volume");
    if (num(b.neg?.preco) <= 0 && !out.includes("Preço")) out.push("Preço");
    return out;
  }

  // "2026/2027" -> "2027"
  function anoDaSafra(safra, hoje = new Date()) {
    const m = String(safra || "").match(/(\d{4})\s*$/);
    return m ? m[1] : String(hoje.getFullYear() + 1);
  }
  function formatarNumero(seq, ano) { return (seq < 10 ? "0" + seq : String(seq)) + "/" + ano; }

  return { LISTAS, DOCUMENTOS, CHECKLIST_MESA, STATUS, num, calcular, camposFaltando, anoDaSafra, formatarNumero, digitos };
});
