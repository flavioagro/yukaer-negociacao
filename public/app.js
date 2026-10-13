"use strict";
// Interface da Mesa de Negociação Yukaer. Conversa com o servidor pela API em /api.
const { LISTAS: L, DOCUMENTOS: DOCS, CHECKLIST_MESA, STATUS, num, calcular, camposFaltando, digitos } = window.Regras;

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fNum = (v, d = 0) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fMoney = (v, cur = "R$") => cur + " " + fNum(v, 2);
const fPct = v => fNum((v || 0) * 100, 2) + "%";
const fDate = s => { if (!s) return "—"; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(s); };
const fDT = s => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
function opts(list, sel) { return `<option value=""></option>` + list.map(o => `<option${o === sel ? " selected" : ""}>${esc(o)}</option>`).join(""); }
function chip(st) { return `<span class="chip s-${esc(st)}">${esc(STATUS[st] || st)}</span>`; }
const ehMesa = () => S.usuario && (S.usuario.papel === "mesa" || S.usuario.papel === "admin");

// ---------- API ----------
class ErroApi extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || {}; } }
async function api(metodo, url, corpo) {
  const init = { method: metodo, headers: { "X-Yukaer": "1" }, credentials: "same-origin" };
  if (corpo instanceof FormData) init.body = corpo;
  else if (corpo !== undefined) { init.body = JSON.stringify(corpo); init.headers["Content-Type"] = "application/json"; }
  let r;
  try { r = await fetch(url, init); } catch { throw new ErroApi(0, "Sem conexão com o servidor. Confira a internet e tente de novo."); }
  const dados = await r.json().catch(() => ({}));
  if (r.ok) return dados;
  if (r.status === 401 && url !== "/api/entrar") { S.usuario = null; render(); }
  if (r.status === 403 && dados.trocarSenha) { S.usuario.trocarSenha = true; render(); }
  throw new ErroApi(r.status, dados.erro || "Não foi possível concluir. Tente de novo.", dados);
}

// ---------- estado ----------
const S = {
  usuario: null, tab: null, boletas: [], contratos: [], fornecedores: [], fornTotal: 0, usuarios: [],
  draft: null, ctlFilter: { q: "", filial: "", corretor: "", assin: "", pag: "" }, ctlLimit: 100, fornQ: "", solFilter: "enviada",
};

async function boot() {
  $("#sair").onclick = async () => { try { await api("POST", "/api/sair"); } catch {} S.usuario = null; S.draft = null; render(); };
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== S.tab && tabsFor().some(t => t[0] === h)) { S.tab = h; render(); } });
  try { S.usuario = (await api("GET", "/api/eu")).usuario; } catch { S.usuario = null; }
  S.tab = location.hash.slice(1) || null;
  if (S.usuario) await carregar();
  render();
  setInterval(atualizarEmSegundoPlano, 30000);
}

// Carrega os dados que a tela usa.
async function carregar() {
  if (!S.usuario || S.usuario.trocarSenha) return;
  const tarefas = [api("GET", "/api/boletas").then(b => S.boletas = b)];
  if (ehMesa()) tarefas.push(api("GET", "/api/contratos").then(c => S.contratos = c));
  if (ehMesa() && S.tab === "usuarios") tarefas.push(api("GET", "/api/usuarios").then(u => S.usuarios = u));
  if (ehMesa() && S.tab === "forn") tarefas.push(carregarFornecedores());
  await Promise.all(tarefas);
}
async function carregarFornecedores() {
  const r = await api("GET", "/api/fornecedores?q=" + encodeURIComponent(S.fornQ));
  S.fornecedores = r.fornecedores; S.fornTotal = r.total;
}
async function atualizarEmSegundoPlano() {
  if (!S.usuario || document.hidden) return;
  try { await carregar(); } catch { return; }
  const digitando = document.activeElement && $("#main").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ($("#overlay").firstChild || S.tab === "nova" || digitando) renderTabs(); else render();
}

// ---------- abas ----------
function tabsFor() {
  if (ehMesa()) {
    const pend = S.boletas.filter(x => x.status === "enviada").length;
    return [["aprov", "Aprovações", pend], ["controle", "Controle de contratos"], ["forn", "Fornecedores"], ["usuarios", "Corretores e usuários"], ["conta", "Minha conta"]];
  }
  const aj = S.boletas.filter(x => x.status === "ajuste").length;
  return [["nova", "Nova boleta"], ["minhas", "Minhas solicitações", aj], ["conta", "Minha conta"]];
}
function renderTabs() {
  const logado = S.usuario && !S.usuario.trocarSenha;
  $("#sair").hidden = !S.usuario;
  $("#who").textContent = S.usuario ? `${S.usuario.nome} · ${ehMesa() ? (S.usuario.papel === "admin" ? "Administrador" : "Mesa comercial") : "Corretor"}` : "";
  if (!logado) { $("#tabs").innerHTML = ""; return; }
  const t = tabsFor(); if (!S.tab || !t.some(x => x[0] === S.tab)) S.tab = t[0][0];
  $("#tabs").innerHTML = t.map(([k, l, b]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${esc(l)}${b ? `<span class="badge">${b}</span>` : ""}</button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => irPara(b.dataset.tab));
}
async function irPara(tab) {
  if (S.tab === "nova" && tab !== "nova") guardarRascunhoLocal();
  S.tab = tab; history.replaceState(null, "", "#" + tab);
  render();
  if (["forn", "usuarios"].includes(tab)) { try { await carregar(); render(); } catch (e) { toast(e.message); } }
}
function render() {
  renderTabs();
  const m = $("#main");
  if (!S.usuario) { $("#overlay").innerHTML = ""; return viewEntrar(m); }
  if (S.usuario.trocarSenha) return viewTrocarSenha(m, true);
  ({ nova: viewNova, minhas: viewMinhas, conta: viewConta, aprov: viewAprov, controle: viewControle, forn: viewForn, usuarios: viewUsuarios })[S.tab](m);
}

// ---------- entrada e senha ----------
function viewEntrar(m) {
  m.innerHTML = `<div class="login panel"><h1>Entrar</h1><p class="sub">Acesso para corretores parceiros e mesa comercial da Yukaer Agro.</p>
   <form id="fEntrar"><label class="f"><span>E-mail</span><input id="lEmail" type="email" autocomplete="username" required></label>
   <label class="f"><span>Senha</span><input id="lSenha" type="password" autocomplete="current-password" required></label>
   <button class="btn pri">Entrar</button><span class="err" id="lErr"></span>
   <p class="legend" style="margin:0">Esqueceu a senha? Peça à mesa comercial para gerar uma senha provisória.</p></form></div>`;
  $("#lEmail").focus();
  $("#fEntrar").onsubmit = async e => {
    e.preventDefault(); const b = $("#fEntrar button"); b.disabled = true; $("#lErr").textContent = "";
    try {
      S.usuario = (await api("POST", "/api/entrar", { email: $("#lEmail").value, senha: $("#lSenha").value })).usuario;
      S.tab = location.hash.slice(1) || null; await carregar(); render();
    } catch (err) { $("#lErr").textContent = err.message; b.disabled = false; }
  };
}
function formSenha(titulo, texto) {
  return `<form class="panel" id="fSenha" style="max-width:520px"><h2>${esc(titulo)}</h2><p class="legend" style="margin-top:-4px">${esc(texto)}</p><div class="grid" style="grid-template-columns:1fr">
   <label class="f"><span>Senha atual</span><input id="sAtual" type="password" autocomplete="current-password" required></label>
   <label class="f"><span>Nova senha</span><input id="sNova" type="password" autocomplete="new-password" minlength="8" required></label>
   <label class="f"><span>Repita a nova senha</span><input id="sNova2" type="password" autocomplete="new-password" minlength="8" required></label></div>
   <div class="row" style="margin-top:12px"><button class="btn pri">Salvar nova senha</button><span class="err" id="sErr"></span></div></form>`;
}
function ligarFormSenha(aoConcluir) {
  $("#fSenha").onsubmit = async e => {
    e.preventDefault(); const err = $("#sErr"); err.textContent = "";
    if ($("#sNova").value !== $("#sNova2").value) { err.textContent = "As duas senhas novas não são iguais."; return; }
    try { await api("POST", "/api/eu/senha", { atual: $("#sAtual").value, nova: $("#sNova").value }); toast("Senha alterada"); await aoConcluir(); }
    catch (x) { err.textContent = x.message; }
  };
}
function viewTrocarSenha(m) {
  m.innerHTML = `<h1>Crie sua senha</h1><p class="sub">Você entrou com uma senha provisória. Crie uma senha pessoal para continuar.</p>${formSenha("Nova senha", "Mínimo de 8 caracteres, com letras e números.")}`;
  ligarFormSenha(async () => { S.usuario.trocarSenha = false; S.tab = null; await carregar(); render(); });
}
function viewConta(m) {
  const u = S.usuario;
  m.innerHTML = `<h1>Minha conta</h1><p class="sub">Para mudar nome, empresa ou o nome usado no controle de contratos, fale com a mesa comercial.</p>
   <section class="panel" style="margin-bottom:14px">${kv([["Nome", esc(u.nome)], ["E-mail", esc(u.email)], ["Perfil", esc({ admin: "Administrador", mesa: "Mesa comercial", corretor: "Corretor" }[u.papel])],
     ...(u.papel === "corretor" ? [["Nome no controle", esc(u.corretorNome)], ["Empresa", esc(u.empresa)], ["Telefone", esc(u.telefone)]] : [])])}</section>
   ${formSenha("Trocar senha", "Mínimo de 8 caracteres, com letras e números. As outras sessões abertas serão encerradas.")}`;
  ligarFormSenha(async () => { $("#fSenha").reset(); });
}

// ---------- CORRETOR: nova boleta ----------
function blankSol() {
  return { status: "rascunho", cliente: { tipoVendedor: "Pessoa Física" },
    neg: { tipoContrato: "Grãos FIXADO", moeda: "R$ (Real)", mercadoria: "Soja em Grãos", transgenia: "GMO Positivo", safra: safraPadrao(), declFunrural: "Não", frete: "CIF Armazém", pesoClass: "Peso Destino / Análise Destino", opFiscal: "NF Própria" },
    banco: { tipoConta: "Conta Corrente" }, documentos: [], obs: "", historico: [], mesa: {} };
}
function safraPadrao() { const d = new Date(), a = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `${a}/${a + 1}`; }
const CHAVE_LOCAL = () => "yk-rascunho-" + (S.usuario?.id || "");
function guardarRascunhoLocal() {
  if ($("#fBol")) S.draft = { ...S.draft, ...lerForm() };
  try { if (S.draft && !S.draft.id) localStorage.setItem(CHAVE_LOCAL(), JSON.stringify(S.draft)); } catch {}
}
function fld(path, label, o = {}) {
  const [g, k] = path.split("."); const v = (S.draft?.[g] || {})[k] ?? "";
  const id = `b_${g}_${k}`; const cls = o.w ? ` ${o.w}` : "";
  let ctl;
  if (o.list) ctl = `<select id="${id}" data-p="${path}">${opts(o.list, v)}</select>`;
  else if (o.area) ctl = `<textarea id="${id}" data-p="${path}">${esc(v)}</textarea>`;
  else ctl = `<input id="${id}" data-p="${path}" type="${o.type || "text"}" ${o.step ? `step="${o.step}"` : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} value="${esc(v)}" ${o.inputmode ? `inputmode="${o.inputmode}"` : ""}>`;
  return `<label class="f${cls}"><span class="${o.req ? "req" : ""}">${esc(label)}</span>${ctl}</label>`;
}
function lerForm() {
  const out = { cliente: { ...(S.draft?.cliente || {}) }, neg: { ...(S.draft?.neg || {}) }, banco: { ...(S.draft?.banco || {}) } };
  $$("#fBol [data-p]").forEach(el => { const [g, k] = el.dataset.p.split("."); out[g][k] = el.value; });
  out.obs = $("#b_obs")?.value ?? S.draft?.obs ?? "";
  return out;
}
function viewNova(m) {
  if (!S.draft) { try { S.draft = JSON.parse(localStorage.getItem(CHAVE_LOCAL()) || "null"); } catch {} }
  if (!S.draft) S.draft = blankSol();
  const d = S.draft, editando = !!d.id;
  const docsHtml = DOCS.map(([k, l]) => { const a = (d.documentos || []).find(x => x.tipo === k); return `<div class="doc"><span>${esc(l)}</span>
     <span class="row">${a ? `<a href="/api/documentos/${a.id}" target="_blank" rel="noopener">${esc(a.nome)}</a>` : ""}
     <label class="btn sm">${a ? "Trocar" : "Anexar"}<input type="file" data-doc="${k}" hidden accept="image/*,application/pdf"></label></span></div>`; }).join("");
  const ultimaMesa = [...(d.historico || [])].reverse().find(h => h.papel === "mesa");
  m.innerHTML = `<h1>${editando ? `Boleta ${esc(d.codigo)}` : "Nova boleta de compra"}</h1>
  <p class="sub">Busque o produtor na base de fornecedores para preencher os dados do cliente e bancários. Os campos marcados são obrigatórios para a mesa analisar.</p>
  ${d.status === "ajuste" && ultimaMesa ? `<div class="banner" style="margin:0 0 14px;background:var(--info-soft)"><b>A mesa pediu ajuste:</b> ${esc(ultimaMesa.texto)}</div>` : ""}
  <div class="boleta">
  <form id="fBol" autocomplete="off">
   <section class="panel"><h2>Dados do cliente</h2>
    <div class="search" style="margin-bottom:12px"><label class="f"><span>Buscar na base de fornecedores (nome, fazenda, CPF ou CNPJ)</span><input id="fornQ" placeholder="Digite ao menos 3 letras ou números"></label><div class="sugg" id="sugg" hidden></div></div>
    <p class="legend" id="fornInfo">${d.fornecedorId ? "Fornecedor da base selecionado. Altere os campos se algum dado mudou." : "Produtor novo? Preencha os campos abaixo; a mesa inclui na base ao aprovar."}</p>
    <div class="grid">
     ${fld("cliente.nome", "Razão social / nome completo", { req: 1, w: "w2" })}
     ${fld("cliente.tipoVendedor", "Tipo do vendedor", { list: L.tipoVendedor, req: 1 })}
     ${fld("cliente.cpf", "CPF", { ph: "000.000.000-00" })}
     ${fld("cliente.cnpj", "CNPJ", { ph: "00.000.000/0000-00" })}
     ${fld("cliente.ie", "Inscrição estadual", { req: 1 })}
     ${fld("cliente.car", "CAR")}
     ${fld("cliente.telefone", "Telefone / celular")}
     ${fld("cliente.email", "E-mail", { type: "email" })}
     ${fld("cliente.propriedade", "Nome da propriedade", { req: 1 })}
     ${fld("cliente.municipio", "Município")}
     ${fld("cliente.estado", "Estado")}
     ${fld("cliente.enderecoFazenda", "Endereço da fazenda", { w: "w2" })}
     ${fld("cliente.enderecoResidencial", "Endereço residencial", { w: "w2" })}
    </div></section>
   <section class="panel"><h2>Dados da negociação</h2><div class="grid">
     ${fld("neg.tipoContrato", "Tipo de contrato", { list: L.tipoContrato, req: 1 })}
     ${fld("neg.moeda", "Moeda", { list: L.moeda, req: 1 })}
     ${fld("neg.mercadoria", "Mercadoria", { list: L.mercadoria, req: 1 })}
     ${fld("neg.transgenia", "Transgenia", { list: L.transgenia })}
     ${fld("neg.safra", "Safra", { req: 1, ph: "2026/2027" })}
     ${fld("neg.volumeKg", "Volume (kg)", { req: 1, type: "number", step: "1", inputmode: "numeric" })}
     ${fld("neg.preco", "Preço bruto / saca", { req: 1, type: "number", step: "0.01", inputmode: "decimal" })}
     ${fld("neg.declFunrural", "Declaração Funrural", { list: L.simNao })}
     ${fld("neg.frete", "Frete", { list: L.frete, req: 1 })}
     ${fld("neg.filial", "Filial compradora", { list: L.filial, req: 1 })}
     ${fld("neg.entregaDe", "Limite de entrega: de", { type: "date", req: 1 })}
     ${fld("neg.entregaAte", "até", { type: "date", req: 1 })}
     ${fld("neg.local", "Local retirada / entrega", { w: "w2", req: 1 })}
     ${fld("neg.localizacaoFob", "Localização FOB (link do mapa)", { w: "w2" })}
     ${fld("neg.pgtoData", "Pagamento data fixa", { type: "date", req: 1 })}
     ${fld("neg.dataFixacao", "Data da fixação", { type: "date" })}
     ${fld("neg.pgtoDiferenciado", "Pagamento diferenciado")}
     ${fld("neg.autorizacaoPgto", "Autorização de pagamento")}
     ${fld("neg.cpr", "CPR")}
     ${fld("neg.notaPromissoria", "Nota promissória")}
     ${fld("neg.cessaoCredito", "Cessão de crédito", { w: "w2", ph: "Favorecido, CNPJ e valor" })}
   </div>
   <h2 style="margin-top:16px">Descontos e custos</h2><div class="grid">
     ${fld("neg.descGmo", "Desconto GMO Free (R$/sc)", { type: "number", step: "0.01" })}
     ${fld("neg.descGmoData", "Data limite do desconto", { type: "date" })}
     ${fld("neg.armazenagemTon", "Armazenagem (R$/ton)", { type: "number", step: "0.01" })}
     ${fld("neg.comissaoSc", "Comissão (R$/sc)", { type: "number", step: "0.01", req: 1 })}
     ${fld("neg.freteCustoTon", "Frete custo (R$/ton)", { type: "number", step: "0.01" })}
   </div></section>
   <section class="panel"><h2>Dados bancários</h2><div class="grid">
     ${fld("banco.banco", "Banco", { req: 1 })}
     ${fld("banco.agencia", "Agência", { req: 1 })}
     ${fld("banco.conta", "Conta", { req: 1 })}
     ${fld("banco.tipoConta", "Tipo de conta", { list: L.tipoConta })}
     ${fld("banco.titularDoc", "CPF/CNPJ do titular")}
     ${fld("banco.pix", "PIX")}
   </div></section>
   <section class="panel"><h2>Fiscal, pagamento e informações complementares</h2><div class="grid">
     ${fld("neg.opFiscal", "Operação fiscal", { list: L.opFiscal })}
     ${fld("neg.pesoClass", "Peso e classificação", { list: L.pesoClass, req: 1 })}
     ${fld("neg.certidaoPenhor", "Certidão de penhor")}
     ${fld("neg.royalties", "Royalties")}
     <label class="f wall"><span>Observações</span><textarea id="b_obs">${esc(d.obs || "")}</textarea></label>
   </div></section>
   <section class="panel"><h2>Documentação obrigatória</h2>
     <p class="legend" style="margin-top:-6px">Anexe foto ou PDF de cada documento (até 15 MB). A mesa confere validade: IE e CNPJ até 30 dias, endereço até 3 meses. Ao anexar, a boleta é salva como rascunho.</p>
     <div class="docs">${docsHtml}</div></section>
  </form>
  <aside class="calc">
   <div class="panel"><h2>Resumo calculado</h2><dl id="calcBox"></dl></div>
   <div class="panel"><div class="row" style="flex-direction:column;align-items:stretch">
     <button class="btn pri" id="bEnviar" type="button">Enviar para a mesa</button>
     <button class="btn" id="bSalvar" type="button">Salvar rascunho</button>
     <button class="btn sm" id="bLimpar" type="button">${editando ? "Começar outra boleta" : "Limpar formulário"}</button>
     <span class="err" id="bolErr"></span></div></div>
  </aside></div>`;
  $("#fBol").addEventListener("input", () => { S.draft = { ...S.draft, ...lerForm() }; atualizarCalculo(); });
  $("#fBol").addEventListener("change", () => guardarRascunhoLocal());
  atualizarCalculo();
  ligarBuscaFornecedor();
  $$("#fBol input[type=file][data-doc]").forEach(inp => inp.onchange = () => anexar(inp));
  $("#bSalvar").onclick = () => salvarBoleta(false);
  $("#bEnviar").onclick = () => salvarBoleta(true);
  $("#bLimpar").onclick = () => { S.draft = blankSol(); try { localStorage.removeItem(CHAVE_LOCAL()); } catch {} render(); };
}
function atualizarCalculo() {
  const box = $("#calcBox"); if (!box || !S.draft) return;
  const c = calcular(S.draft), cur = c.moeda;
  box.innerHTML = `<dt>Volume (sc)</dt><dd>${fNum(c.sc, 2)}</dd><dt>Preço / kg</dt><dd>${fNum(c.precoKg, 4)}</dd>
   <dt>Valor bruto</dt><dd class="big">${fMoney(c.bruto, cur)}</dd><hr>
   <dt>Funrural ${fPct(c.pct)}</dt><dd>${fMoney(c.funrural, cur)}</dd>
   ${c.descGmo ? `<dt>Desconto GMO Free</dt><dd>${fMoney(-c.descGmo, cur)}</dd>` : ""}
   <dt>Valor líquido estimado</dt><dd class="big">${fMoney(c.liquido, cur)}</dd><hr>
   <dt>Comissão do corretor</dt><dd>${fMoney(c.comissao, cur)}</dd>`;
}
function ligarBuscaFornecedor() {
  const q = $("#fornQ"), box = $("#sugg"); let t, ultima = 0;
  q.oninput = () => {
    clearTimeout(t);
    const termo = q.value.trim();
    if (termo.length < 3) { box.hidden = true; return; }
    t = setTimeout(async () => {
      const minha = ++ultima;
      let r; try { r = await api("GET", "/api/fornecedores?q=" + encodeURIComponent(termo)); } catch (e) { box.innerHTML = `<div style="padding:10px" class="err">${esc(e.message)}</div>`; box.hidden = false; return; }
      if (minha !== ultima) return;
      box.innerHTML = r.fornecedores.length ? r.fornecedores.map(f => `<button type="button" data-id="${f.id}">${esc(f.nome)}<small>${esc(f.documento || "")}${f.fazenda ? " · " + esc(f.fazenda) : ""}${f.municipio ? " · " + esc(f.municipio) : ""}</small></button>`).join("")
        : `<div style="padding:10px" class="muted">Nenhum fornecedor encontrado. Preencha como produtor novo.</div>`;
      box.hidden = false;
      $$("button", box).forEach(b => b.onclick = () => { escolherFornecedor(b.dataset.id); box.hidden = true; q.value = ""; });
    }, 250);
  };
  q.onblur = () => setTimeout(() => box.hidden = true, 200);
}
async function escolherFornecedor(id) {
  let f; try { f = await api("GET", "/api/fornecedores/" + id); } catch (e) { toast(e.message); return; }
  guardarRascunhoLocal();
  const d = S.draft;
  d.fornecedorId = f.id;
  const pj = f.tipo === "Pessoa Jurídica";
  d.cliente = { ...d.cliente, nome: f.nome, tipoVendedor: pj ? "Pessoa Jurídica" : "Pessoa Física", cpf: f.cpf || "", cnpj: f.cnpj || "", ie: f.ie || "", car: f.car || "", telefone: f.telefone || "", email: f.email || "",
    propriedade: f.fazenda || "", municipio: f.municipio || "", estado: f.estado || "", enderecoFazenda: f.endereco || "", enderecoResidencial: d.cliente.enderecoResidencial || f.endereco || "" };
  d.banco = { ...d.banco, banco: f.banco || "", agencia: f.agencia || "", conta: f.conta || "", pix: f.pix || "", titularDoc: (pj ? f.cnpj : f.cpf) || "" };
  if (f.liminarFunrural === "SIM") d.neg.declFunrural = "Sim";
  render(); toast("Dados do fornecedor preenchidos");
}
function corpoBoleta(enviar) { const d = S.draft; return { cliente: d.cliente, neg: d.neg, banco: d.banco, obs: d.obs, fornecedorId: d.fornecedorId || null, enviar }; }
async function salvarBoleta(enviar) {
  guardarRascunhoLocal(); const d = S.draft; const err = $("#bolErr"); err.textContent = "";
  if (enviar) { const f = camposFaltando(d); if (f.length) { err.textContent = "Falta preencher: " + f.join(", ") + "."; return; } }
  const botoes = $$("#bEnviar,#bSalvar"); botoes.forEach(b => b.disabled = true);
  try {
    const b = d.id ? await api("PUT", "/api/boletas/" + d.id, corpoBoleta(enviar)) : await api("POST", "/api/boletas", corpoBoleta(enviar));
    try { localStorage.removeItem(CHAVE_LOCAL()); } catch {}
    toast(enviar ? `Boleta ${b.codigo} enviada para a mesa comercial` : `Rascunho ${b.codigo} salvo`);
    S.boletas = await api("GET", "/api/boletas");
    if (enviar) { S.draft = null; irPara("minhas"); } else { S.draft = b; render(); }
  } catch (e) { err.textContent = e.message; botoes.forEach(b => b.disabled = false); }
}
async function anexar(inp) {
  const arquivo = inp.files[0]; if (!arquivo) return;
  const err = $("#bolErr"); err.textContent = "";
  if (arquivo.size > 15 * 1024 * 1024) { err.textContent = "Arquivo grande demais. O limite é 15 MB."; return; }
  guardarRascunhoLocal();
  try {
    if (!S.draft.id) { S.draft = await api("POST", "/api/boletas", corpoBoleta(false)); try { localStorage.removeItem(CHAVE_LOCAL()); } catch {} }
    const fd = new FormData(); fd.append("tipo", inp.dataset.doc); fd.append("arquivo", arquivo);
    toast("Enviando documento…");
    const b = await api("POST", `/api/boletas/${S.draft.id}/documentos`, fd);
    S.draft = { ...S.draft, id: b.id, codigo: b.codigo, documentos: b.documentos };
    render(); toast("Documento anexado");
  } catch (e) { const x = $("#bolErr"); if (x) x.textContent = e.message; }
}

// ---------- CORRETOR: minhas solicitações ----------
function cartao(d) {
  const c = calcular(d);
  return `<button class="card" data-id="${d.id}"><div><div class="t">${esc(d.cliente?.nome || "Sem produtor")} <span class="muted num" style="font-weight:400">${esc(d.codigo || "")}</span></div>
   <div class="m">${esc(d.neg?.mercadoria || "")} · ${fNum(c.sc, 0)} sc a ${fMoney(c.preco, c.moeda)} · ${esc(d.neg?.filial || "")}${ehMesa() ? ` · corretor ${esc(d.corretorNome)}` : ""}</div></div>
   <div style="text-align:right">${chip(d.status)}<div class="m num" style="margin-top:4px">${d.mesa?.contratoNumero ? "Contrato " + esc(d.mesa.contratoNumero) : fDT(d.atualizadoEm)}</div></div></button>`;
}
function viewMinhas(m) {
  const arr = [...S.boletas].sort((a, b) => String(b.atualizadoEm).localeCompare(a.atualizadoEm));
  m.innerHTML = `<h1>Minhas solicitações</h1><p class="sub">Acompanhe cada boleta até a aprovação e o número do contrato. Boletas devolvidas para ajuste podem ser editadas e reenviadas.</p>
   <div class="list">${arr.length ? arr.map(cartao).join("") : `<div class="empty">Nenhuma boleta ainda. Use a aba “Nova boleta” para enviar a primeira.</div>`}</div>`;
  $$(".card", m).forEach(c => c.onclick = () => abrirBoleta(c.dataset.id));
}

// ---------- detalhe da boleta (corretor e mesa) ----------
function fecharGaveta() { $("#overlay").innerHTML = ""; render(); }
function abrirGaveta(html) {
  $("#overlay").innerHTML = `<div class="drawer-bg" id="dbg"><div class="drawer" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#dbg").onclick = e => { if (e.target.id === "dbg") fecharGaveta(); };
  $$("[data-close]").forEach(b => b.onclick = fecharGaveta);
}
function kv(pares) { return `<dl class="kv">${pares.filter(p => p[1] !== undefined).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === "" || v == null ? "—" : v}</dd></div>`).join("")}</dl>`; }
async function abrirBoleta(id) {
  let d; try { d = await api("GET", "/api/boletas/" + id); } catch (e) { toast(e.message); return; }
  const mesa = ehMesa();
  let base = null;
  if (mesa && d.fornecedorId) { try { base = await api("GET", "/api/fornecedores/" + d.fornecedorId); } catch {} }
  const c = calcular(d), cl = d.cliente, n = d.neg, bk = d.banco, me = d.mesa || {};
  const pode = mesa && d.status === "enviada";
  const podeEditar = !mesa && (d.status === "rascunho" || d.status === "ajuste");
  const dif = base ? [["Banco", base.banco, bk.banco], ["Agência", base.agencia, bk.agencia], ["Conta", base.conta, bk.conta], ["IE", base.ie, cl.ie]].filter(([, a, b]) => a && b && norm(a).trim() !== norm(b).trim()) : [];
  const html = `<div class="dh"><h3>${esc(d.codigo || "")} · ${esc(cl.nome || "")}</h3>${chip(d.status)}<button class="btn sm" data-close>Fechar</button></div>
  <div class="sec"><div class="kpis">
    <div class="kpi"><span>Volume</span><b>${fNum(c.sc, 0)} sc</b></div>
    <div class="kpi"><span>Preço bruto / sc</span><b>${fMoney(c.preco, c.moeda)}</b></div>
    <div class="kpi"><span>Valor bruto</span><b>${fMoney(c.bruto, c.moeda)}</b></div>
    <div class="kpi"><span>Líquido (Funrural ${fPct(c.pct)})</span><b>${fMoney(c.liquido, c.moeda)}</b></div>
    <div class="kpi"><span>Comissão</span><b>${fMoney(c.comissao, c.moeda)}</b></div></div></div>
  ${mesa ? (d.fornecedorId ? `<p class="legend">Fornecedor da base${dif.length ? `: <b style="color:var(--warn)">dados diferentes da base em ${dif.map(x => esc(x[0])).join(", ")}</b>` : ", dados conferem com a base"}. Corretor: <b>${esc(d.corretorNome)}</b>.</p>` : `<p class="legend"><b style="color:var(--warn)">Produtor novo</b>: entra na base de fornecedores ao aprovar. Corretor: <b>${esc(d.corretorNome)}</b>.</p>`) : ""}
  <section class="panel sec"><h2>Cliente</h2>${kv([["Nome / razão social", esc(cl.nome)], ["Tipo", esc(cl.tipoVendedor)], ["CPF", esc(cl.cpf)], ["CNPJ", esc(cl.cnpj)], ["Inscrição estadual", esc(cl.ie)], ["CAR", esc(cl.car)], ["Telefone", esc(cl.telefone)], ["E-mail", esc(cl.email)], ["Propriedade", esc(cl.propriedade)], ["Município / UF", esc([cl.municipio, cl.estado].filter(Boolean).join(" / "))], ["Endereço fazenda", esc(cl.enderecoFazenda)], ["Endereço residencial", esc(cl.enderecoResidencial)]])}</section>
  <section class="panel sec"><h2>Negociação</h2>${kv([["Tipo de contrato", esc(n.tipoContrato)], ["Moeda", esc(n.moeda)], ["Mercadoria", esc(n.mercadoria)], ["Transgenia", esc(n.transgenia)], ["Safra", esc(n.safra)], ["Volume (kg)", `<span class="num">${fNum(c.kg)}</span>`], ["Declaração Funrural", esc(n.declFunrural)], ["Frete", esc(n.frete)], ["Filial compradora", esc(n.filial)], ["Entrega", `${fDate(n.entregaDe)} a ${fDate(n.entregaAte)}`], ["Local retirada / entrega", esc(n.local)], ["Localização FOB", n.localizacaoFob && /^https?:\/\//.test(n.localizacaoFob) ? `<a href="${esc(n.localizacaoFob)}" target="_blank" rel="noopener">abrir mapa</a>` : esc(n.localizacaoFob)], ["Pagamento data fixa", fDate(n.pgtoData)], ["Data da fixação", fDate(n.dataFixacao)], ["Pgto diferenciado", esc(n.pgtoDiferenciado)], ["Autorização de pgto", esc(n.autorizacaoPgto)], ["CPR", esc(n.cpr)], ["Nota promissória", esc(n.notaPromissoria)], ["Cessão de crédito", esc(n.cessaoCredito)], ["Desconto GMO Free", n.descGmo ? `${fMoney(num(n.descGmo))}/sc até ${fDate(n.descGmoData)}` : ""], ["Armazenagem / ton", n.armazenagemTon ? fMoney(num(n.armazenagemTon)) : ""], ["Comissão / sc", fMoney(num(n.comissaoSc))], ["Frete custo / ton", n.freteCustoTon ? fMoney(num(n.freteCustoTon)) : ""], ["Operação fiscal", esc(n.opFiscal)], ["Peso e classificação", esc(n.pesoClass)], ["Certidão de penhor", esc(n.certidaoPenhor)], ["Royalties", esc(n.royalties)]])}</section>
  <section class="panel sec"><h2>Dados bancários</h2>${kv([["Banco", esc(bk.banco)], ["Agência", esc(bk.agencia)], ["Conta", esc(bk.conta)], ["Tipo", esc(bk.tipoConta)], ["CPF/CNPJ titular", esc(bk.titularDoc)], ["PIX", esc(bk.pix)]])}</section>
  ${d.obs ? `<section class="panel sec"><h2>Observações do corretor</h2><p style="margin:0;white-space:pre-wrap">${esc(d.obs)}</p></section>` : ""}
  <section class="panel sec"><h2>Documentação</h2><div class="docs">${DOCS.map(([k, l]) => { const a = d.documentos.find(x => x.tipo === k); return `<div class="doc"><span>${esc(l)}</span><span>${a ? `<a href="/api/documentos/${a.id}" target="_blank" rel="noopener">${esc(a.nome)}</a>` : `<span class="muted">não anexado</span>`}</span></div>`; }).join("")}</div></section>
  ${mesa ? `<section class="panel sec"><h2>Campo de uso exclusivo do Adm. Comercial</h2>
    <div class="checks">${CHECKLIST_MESA.map((x, i) => `<label><input type="checkbox" id="mc${i}" data-ck="${esc(x)}" ${me.checklist?.[x] ? "checked" : ""} ${pode ? "" : "disabled"}> ${esc(x)}</label>`).join("")}</div>
    <div class="grid" style="margin-top:12px"><label class="f"><span>Responsável pela compra</span><input id="mesaResp" value="${esc(me.responsavel || S.usuario.nome)}" ${pode ? "" : "readonly"}></label>
    <label class="f w2"><span>Parecer da mesa (vai para o corretor)</span><textarea id="mesaObs" ${pode ? "" : "readonly"}>${pode ? "" : esc(me.parecer || "")}</textarea></label></div>
    ${pode ? `<div class="row" style="margin-top:12px"><button class="btn ok" id="mApr">Aprovar e gerar contrato</button><button class="btn" id="mAj">Devolver para ajuste</button><button class="btn bad" id="mRep">Reprovar</button><span class="err" id="mErr"></span></div>` : ""}
    ${me.contratoNumero ? `<p style="margin:12px 0 0">Contrato gerado: <b class="num">${esc(me.contratoNumero)}</b></p>` : ""}</section>` : ""}
  ${!mesa && me.contratoNumero ? `<section class="panel sec"><h2>Contrato</h2><p style="margin:0">Aprovada pela mesa. Contrato nº <b class="num">${esc(me.contratoNumero)}</b>.</p></section>` : ""}
  <section class="panel sec"><h2>Histórico</h2><ul class="hist">${d.historico.map(h => `<li><time>${fDT(h.em)}</time><b>${esc(h.papel === "mesa" ? "Mesa" : "Corretor")}${h.por ? " (" + esc(h.por) + ")" : ""}:</b> ${esc(h.acao)}${h.texto ? ` · “${esc(h.texto)}”` : ""}</li>`).join("") || `<li class="muted">Rascunho ainda não enviado.</li>`}</ul></section>
  ${podeEditar ? `<div class="row sec"><button class="btn pri" id="bEdit">Editar boleta</button>${d.status === "rascunho" ? `<button class="btn bad" id="bDel">Excluir rascunho</button>` : ""}</div>` : ""}`;
  abrirGaveta(html);
  if (podeEditar) {
    $("#bEdit").onclick = () => { S.draft = d; $("#overlay").innerHTML = ""; irPara("nova"); };
    if ($("#bDel")) $("#bDel").onclick = async () => {
      if (!confirm("Excluir este rascunho? Os documentos anexados também serão apagados.")) return;
      try { await api("DELETE", "/api/boletas/" + d.id); S.boletas = await api("GET", "/api/boletas"); toast("Rascunho excluído"); fecharGaveta(); } catch (e) { toast(e.message); }
    };
  }
  if (pode) { $("#mApr").onclick = () => decidir(d.id, "aprovar"); $("#mAj").onclick = () => decidir(d.id, "ajuste"); $("#mRep").onclick = () => decidir(d.id, "reprovar"); }
}
async function decidir(id, acao) {
  const parecer = $("#mesaObs").value.trim(), err = $("#mErr"); err.textContent = "";
  if (acao !== "aprovar" && !parecer) { err.textContent = "Escreva no parecer o que o corretor precisa ajustar ou o motivo da reprovação."; return; }
  const checklist = {}; $$("[data-ck]").forEach(c => checklist[c.dataset.ck] = c.checked);
  $$("#mApr,#mAj,#mRep").forEach(b => b.disabled = true);
  try {
    const b = await api("POST", `/api/boletas/${id}/decisao`, { acao, parecer, responsavel: $("#mesaResp").value.trim(), checklist });
    toast(acao === "aprovar" ? `Contrato ${b.mesa.contratoNumero} gerado` : acao === "ajuste" ? "Devolvida ao corretor" : "Boleta reprovada");
    await carregar(); fecharGaveta();
  } catch (e) { err.textContent = e.message; $$("#mApr,#mAj,#mRep").forEach(b => b.disabled = false); }
}

// ---------- MESA: aprovações ----------
function viewAprov(m) {
  const todas = S.boletas.filter(x => x.status !== "rascunho");
  const cnt = s => todas.filter(x => x.status === s).length;
  const f = S.solFilter;
  const arr = todas.filter(x => f === "todas" || x.status === f).sort((a, b) => String(a.enviadoEm || a.atualizadoEm).localeCompare(b.enviadoEm || b.atualizadoEm) * (f === "enviada" ? 1 : -1));
  const pend = todas.filter(x => x.status === "enviada");
  const volP = pend.reduce((s, x) => s + calcular(x).sc, 0), valP = pend.reduce((s, x) => s + calcular(x).bruto, 0);
  m.innerHTML = `<h1>Fila de aprovação</h1><p class="sub">Boletas enviadas pelos corretores. Abra uma para conferir dados, documentos e cálculo; ao aprovar, o contrato recebe o próximo número e entra no controle.</p>
   <div class="kpis"><div class="kpi attn"><span>Aguardando mesa</span><b>${cnt("enviada")}</b></div><div class="kpi"><span>Volume aguardando</span><b>${fNum(volP)} sc</b></div><div class="kpi"><span>Valor aguardando</span><b>${fMoney(valP)}</b></div><div class="kpi"><span>Devolvidas p/ ajuste</span><b>${cnt("ajuste")}</b></div></div>
   <div class="filters"><select id="sf" aria-label="Situação">${[["enviada", "Aguardando mesa"], ["ajuste", "Devolvidas p/ ajuste"], ["aprovada", "Aprovadas"], ["reprovada", "Reprovadas"], ["todas", "Todas"]].map(([k, l]) => `<option value="${k}" ${k === f ? "selected" : ""}>${l} (${k === "todas" ? todas.length : cnt(k)})</option>`).join("")}</select></div>
   <div class="list">${arr.length ? arr.map(cartao).join("") : `<div class="empty">${f === "enviada" ? "Nenhuma boleta aguardando a mesa." : "Nada nesta situação."}</div>`}</div>`;
  $("#sf").onchange = e => { S.solFilter = e.target.value; render(); };
  $$(".card", m).forEach(c => c.onclick = () => abrirBoleta(c.dataset.id));
}

// ---------- MESA: controle de contratos ----------
const CTL_COLS = [["numero", "Nº Contrato"], ["filial", "Filial Comprador"], ["dataCompra", "Data Compra"], ["tipoContrato", "Tipo de Contrato"], ["produto", "Produto"], ["safra", "Safra"], ["produtor", "Produtor"], ["tipoVendedor", "Tipo Vendedor"], ["cpf", "CPF"], ["cnpj", "CNPJ"], ["ie", "Inscrição Estadual"], ["car", "CAR"], ["fazenda", "Fazenda/Sítio"], ["municipio", "Município"], ["estado", "Estado"], ["endereco", "Endereço"], ["telefone", "Telefone"], ["email", "E-mail"], ["banco", "Banco"], ["agencia", "Agência"], ["conta", "Conta"], ["pix", "PIX"], ["liminarFunrural", "Liminar Funrural"], ["certidaoPenhor", "Certidão Penhor"], ["outrosDocumentos", "Outros Documentos"], ["posicaoOutrosDocumentos", "Posição Outros Documentos"], ["qtdKg", "Qde/KG"], ["qtdSc", "Qtde Saco"], ["tipoFrete", "Tipo Frete"], ["localEntrega", "Local Entrega/Retirada"], ["dataEntrega", "Data Entrega"], ["valorSaco", "Valor Saco"], ["valorContrato", "Valor Contrato"], ["pctFunrural", "% Senar/Funrural"], ["valorFunrural", "Valor Senar/Funrural"], ["descRoyalties", "Desc. Royalties"], ["descAntecipacao", "Desc. Antecipação Pagamento"], ["valorLiquido", "Valor Líquido"], ["observacoes", "Observações"], ["posicaoAssinatura", "Posição Assinatura Contrato"], ["reconhecido", "Reconhecido"], ["valorAPagar", "Valor a Pagar"], ["tipoPagamento", "Tipo de Pagamento"], ["dataPagamento", "Data Pagamento"], ["dataRealPagamento", "Data Real Pagto."], ["valorPago", "Valor Pago"], ["statusPagamento", "Status Pagamento"], ["posicaoEntregas", "Posição de Entregas"], ["corretor", "Corretor"], ["comissao", "Comissão"], ["valorComissao", "Valor a Receber Comissão"], ["dataPagamentoComissao", "Data Pagamento Comissão"], ["situacaoComissao", "Situação Comissão"], ["qtdFiscal", "Fiscal Sistema"], ["qtdBalanca", "Balança Sistema"], ["aRetirar", "A Retirar/Receber"], ["responsavel", "Responsável"], ["codigoBoleta", "Boleta"], ["origem", "Origem"]];
function linhasControle() {
  const f = S.ctlFilter, q = norm(f.q).trim(), dq = digitos(f.q);
  return S.contratos.filter(c =>
    (!f.filial || c.filial === f.filial) && (!f.corretor || c.corretor === f.corretor) && (!f.assin || c.posicaoAssinatura === f.assin) && (!f.pag || c.statusPagamento === f.pag) &&
    (!q || norm(`${c.produtor} ${c.numero} ${c.fazenda}`).includes(q) || (dq.length >= 3 && digitos(`${c.cpf}${c.cnpj}`).includes(dq))));
}
function viewControle(m) {
  const todos = S.contratos;
  const uniq = k => [...new Set(todos.map(c => c[k]).filter(Boolean))].sort();
  const R = linhasControle();
  const soma = (k, arr = R) => arr.reduce((s, c) => s + num(c[k]), 0);
  const naoAss = R.filter(c => c.posicaoAssinatura !== "DIGITAL RECEBIDO" && c.posicaoAssinatura !== "ENTREGUE EM FILIAL");
  const pagAb = R.filter(c => c.statusPagamento !== "PAGO"); const comAb = R.filter(c => c.situacaoComissao === "EM ABERTO");
  const f = S.ctlFilter;
  const sel = (id, list, val, label) => `<select id="${id}" aria-label="${label}"><option value="">${label}: todos</option>${list.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const mostrar = R.slice(0, S.ctlLimit);
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  m.innerHTML = `<h1>Controle de contratos</h1><p class="sub">Mesmas colunas da aba Compras da planilha de controle. Altere a posição de assinatura, pagamento, entregas e comissão direto na tabela; clique na linha para ver e editar o contrato completo.</p>
   <div class="kpis">
    <div class="kpi"><span>Contratos</span><b>${fNum(R.length)}</b></div>
    <div class="kpi"><span>Volume contratado</span><b>${fNum(soma("qtdSc"))} sc</b></div>
    <div class="kpi"><span>Valor bruto</span><b>${fMoney(soma("valorContrato"))}</b></div>
    <div class="kpi ${naoAss.length ? "attn" : ""}"><span>Sem assinatura recebida</span><b>${naoAss.length}</b></div>
    <div class="kpi"><span>A pagar em aberto</span><b>${fMoney(soma("valorAPagar", pagAb) - soma("valorPago", pagAb))}</b></div>
    <div class="kpi"><span>Comissões em aberto</span><b>${fMoney(soma("valorComissao", comAb))}</b></div>
   </div>
   <div class="filters"><input id="cq" placeholder="Buscar produtor, nº, CPF/CNPJ" value="${esc(f.q)}">
    ${sel("cfil", uniq("filial"), f.filial, "Filial")}${sel("ccor", uniq("corretor"), f.corretor, "Corretor")}${sel("cass", L.assinatura, f.assin, "Assinatura")}${sel("cpag", L.pagamento, f.pag, "Pagamento")}
    <a class="btn" id="cexp" href="/api/contratos/exportar${params ? "?" + params : ""}">Exportar Excel</a>
    ${S.usuario.papel === "admin" ? `<label class="btn">Importar planilha de controle<input type="file" id="cImp" accept=".xlsx,.xlsm" hidden></label>` : ""}<span class="legend" id="cMsg"></span></div>
   <div class="tbl"><table><thead><tr><th>Nº</th><th>Data</th><th>Filial</th><th>Produtor</th><th>Corretor</th><th class="r">Sacas</th><th class="r">Preço/sc</th><th class="r">Valor</th><th>Entrega</th><th>Pgto</th><th>Assinatura</th><th>Pagamento</th><th>Entregas</th><th>Comissão</th></tr></thead>
   <tbody>${mostrar.map(c => `<tr data-id="${c.id}"><td class="num">${esc(c.numero)}</td><td class="num">${fDate(c.dataCompra)}</td><td>${esc(String(c.filial || "").replace(/^YUKAER AGRO - /i, ""))}</td><td>${esc(c.produtor)}</td><td>${esc(c.corretor)}</td>
     <td class="r num">${fNum(c.qtdSc)}</td><td class="r num">${fNum(c.valorSaco, 2)}</td><td class="r num">${fNum(c.valorContrato, 2)}</td><td class="num">${esc(c.dataEntrega)}</td><td class="num">${fDate(c.dataPagamento)}</td>
     <td>${inl(c, "posicaoAssinatura", L.assinatura)}</td><td>${inl(c, "statusPagamento", L.pagamento)}</td><td>${inl(c, "posicaoEntregas", L.entregas)}</td><td>${inl(c, "situacaoComissao", L.comissao)}</td></tr>`).join("") || `<tr><td colspan="14" class="muted" style="padding:20px;text-align:center">${todos.length ? "Nenhum contrato com estes filtros." : "Nenhum contrato ainda. Contratos aprovados na fila de aprovação aparecem aqui."}</td></tr>`}</tbody></table></div>
   ${R.length > mostrar.length ? `<div class="row" style="margin-top:10px"><button class="btn" id="cmore">Mostrar mais (${R.length - mostrar.length} restantes)</button></div>` : ""}`;
  const set = (k, v) => { S.ctlFilter[k] = v; S.ctlLimit = 100; render(); };
  let t; $("#cq").oninput = e => { clearTimeout(t); t = setTimeout(() => { set("q", e.target.value); const i = $("#cq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $("#cfil").onchange = e => set("filial", e.target.value); $("#ccor").onchange = e => set("corretor", e.target.value); $("#cass").onchange = e => set("assin", e.target.value); $("#cpag").onchange = e => set("pag", e.target.value);
  if ($("#cmore")) $("#cmore").onclick = () => { S.ctlLimit += 200; render(); };
  if ($("#cImp")) $("#cImp").onchange = e => importarControle(e.target.files[0]);
  $$("tbody tr[data-id]", m).forEach(tr => tr.onclick = e => { if (e.target.closest("select")) return; abrirContrato(Number(tr.dataset.id)); });
  $$("select[data-inl]", m).forEach(s => s.onchange = async () => {
    const [id, campo] = s.dataset.inl.split("|");
    try { const c = await api("PATCH", "/api/contratos/" + id, { [campo]: s.value }); trocarContrato(c); toast("Contrato " + c.numero + " atualizado"); }
    catch (e) { toast(e.message); }
  });
}
function trocarContrato(c) { const i = S.contratos.findIndex(x => x.id === c.id); if (i >= 0) S.contratos[i] = c; }
function inl(c, campo, list) { const v = c[campo] || ""; const l = list.includes(v) || !v ? list : [v, ...list]; return `<select data-inl="${c.id}|${campo}" aria-label="${campo}">${l.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`; }
async function importarControle(arquivo) {
  if (!arquivo) return; const msg = $("#cMsg"); msg.textContent = "Lendo a planilha… isso pode levar alguns segundos.";
  const fd = new FormData(); fd.append("arquivo", arquivo);
  try { const r = await api("POST", "/api/contratos/importar", fd); await carregar(); render();
    toast(`${r.contratosNovos} contratos importados, ${r.contratosJaExistentes} já existiam, ${r.fornecedores} fornecedores atualizados`); }
  catch (e) { msg.textContent = e.message; }
}
const EDIT_CTL = [["posicaoAssinatura", "Posição assinatura", L.assinatura], ["reconhecido", "Reconhecido", ["", "SIM", "NÃO"]], ["outrosDocumentos", "Outros documentos"], ["posicaoOutrosDocumentos", "Posição outros documentos"], ["certidaoPenhor", "Certidão de penhor"], ["dataPagamento", "Data pagamento", "date"], ["dataRealPagamento", "Data real pagto.", "date"], ["valorPago", "Valor pago", "number"], ["statusPagamento", "Status pagamento", L.pagamento], ["posicaoEntregas", "Posição de entregas", L.entregas], ["qtdFiscal", "Fiscal sistema (kg)", "number"], ["qtdBalanca", "Balança sistema (kg)", "number"], ["descRoyalties", "Desc. royalties", "number"], ["descAntecipacao", "Desc. antecipação", "number"], ["situacaoComissao", "Situação comissão", L.comissao], ["dataPagamentoComissao", "Data pagto. comissão", "date"], ["observacoes", "Observações", "area"]];
function abrirContrato(id) {
  const c = S.contratos.find(x => x.id === id); if (!c) return;
  const so = CTL_COLS.filter(([f]) => !EDIT_CTL.some(e => e[0] === f)).map(([f, h]) => { let v = c[f];
    if (["qtdKg", "qtdSc", "aRetirar"].includes(f)) v = `<span class="num">${fNum(v)}</span>`;
    else if (["valorSaco", "valorContrato", "valorFunrural", "valorLiquido", "valorAPagar", "valorComissao", "comissao"].includes(f)) v = `<span class="num">${fNum(v, 2)}</span>`;
    else if (f === "pctFunrural") v = fPct(v); else if (f === "dataCompra") v = fDate(v); else v = esc(v);
    return [h, v]; });
  abrirGaveta(`<div class="dh"><h3>Contrato ${esc(c.numero)} · ${esc(c.produtor)}</h3><button class="btn sm" data-close>Fechar</button></div>
   <form class="panel sec" id="fCtl"><h2>Acompanhamento</h2><div class="grid">${EDIT_CTL.map(([f, l, t]) => { const v = c[f] ?? ""; const id = "ce_" + f;
     if (Array.isArray(t)) return `<label class="f"><span>${esc(l)}</span><select id="${id}" data-f="${f}">${(t.includes(v) ? t : [v, ...t]).map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
     if (t === "area") return `<label class="f wall"><span>${esc(l)}</span><textarea id="${id}" data-f="${f}">${esc(v)}</textarea></label>`;
     return `<label class="f"><span>${esc(l)}</span><input id="${id}" data-f="${f}" type="${t || "text"}" ${t === "number" ? 'step="0.01"' : ""} value="${esc(v)}"></label>`; }).join("")}</div>
     <div class="row" style="margin-top:12px"><button class="btn pri">Salvar alterações</button><span class="legend">${c.codigoBoleta ? `Origem: boleta ${esc(c.codigoBoleta)} aprovada na plataforma` : `Origem: ${esc(c.origem || "")}`}</span><span class="err" id="ctlErr"></span></div></form>
   <section class="panel sec"><h2>Dados do contrato</h2>${kv(so)}</section>`);
  $("#fCtl").onsubmit = async e => {
    e.preventDefault(); const patch = {}; $$("#fCtl [data-f]").forEach(el => patch[el.dataset.f] = el.value);
    try { const n = await api("PATCH", "/api/contratos/" + c.id, patch); trocarContrato(n); toast("Contrato " + c.numero + " salvo"); fecharGaveta(); }
    catch (x) { $("#ctlErr").textContent = x.message; }
  };
}

// ---------- MESA: fornecedores ----------
const FORN_F = [["nome", "Nome / razão social"], ["tipo", "Tipo", L.tipoVendedor], ["cpf", "CPF"], ["cnpj", "CNPJ"], ["ie", "Inscrição estadual"], ["car", "CAR"], ["fazenda", "Fazenda / sítio"], ["municipio", "Município"], ["estado", "Estado"], ["endereco", "Endereço"], ["telefone", "Telefone"], ["email", "E-mail"], ["banco", "Banco"], ["agencia", "Agência"], ["conta", "Conta"], ["pix", "PIX"], ["liminarFunrural", "Liminar Funrural", ["NÃO", "SIM", "PJ - ISENTO"]]];
function viewForn(m) {
  const arr = S.fornecedores;
  m.innerHTML = `<h1>Base de fornecedores</h1><p class="sub">É daqui que a boleta do corretor puxa os dados do produtor. Importe uma exportação do Zaak (Excel ou CSV) para atualizar a base; registros com o mesmo CPF/CNPJ são atualizados. Corretores só veem nome, fazenda e o final do documento na busca.</p>
   <div class="filters"><input id="fq" placeholder="Buscar nome, fazenda, CPF/CNPJ" value="${esc(S.fornQ)}"><button class="btn pri" id="fNew">Novo fornecedor</button>
    <label class="btn">Importar Excel/CSV do Zaak<input type="file" id="fImp" accept=".xlsx,.xlsm,.csv" hidden></label><span class="legend" id="impMsg">${fNum(S.fornTotal)} fornecedores${S.fornQ ? " encontrados" : " na base"}</span></div>
   <div class="tbl"><table><thead><tr><th>Nome</th><th>Tipo</th><th>CPF / CNPJ</th><th>IE</th><th>Fazenda</th><th>Município</th><th>Banco</th><th>Funrural</th><th>Origem</th></tr></thead><tbody>
   ${arr.map(f => `<tr data-id="${f.id}"><td>${esc(f.nome)}</td><td>${esc(f.tipo)}</td><td class="num">${esc(f.tipo === "Pessoa Jurídica" ? f.cnpj : f.cpf)}</td><td class="num">${esc(f.ie)}</td><td>${esc(f.fazenda)}</td><td>${esc([f.municipio, f.estado].filter(Boolean).join(" / "))}</td><td>${esc([f.banco, f.agencia, f.conta].filter(Boolean).join(" · "))}</td><td>${esc(f.liminarFunrural)}</td><td class="muted">${esc(f.origem)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted" style="padding:20px;text-align:center">Nenhum fornecedor. Importe a base ou cadastre um novo.</td></tr>`}
   </tbody></table></div>${S.fornTotal > arr.length ? `<p class="legend">Mostrando ${arr.length} de ${fNum(S.fornTotal)}. Refine a busca.</p>` : ""}`;
  let t; $("#fq").oninput = e => { clearTimeout(t); t = setTimeout(async () => { S.fornQ = e.target.value; try { await carregarFornecedores(); } catch (x) { toast(x.message); } render(); const i = $("#fq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $("#fNew").onclick = () => abrirFornecedor(null);
  $$("tbody tr[data-id]", m).forEach(tr => tr.onclick = () => abrirFornecedor(Number(tr.dataset.id)));
  $("#fImp").onchange = e => importarFornecedores(e.target.files[0]);
}
function abrirFornecedor(id) {
  const f = id ? S.fornecedores.find(x => x.id === id) : { tipo: "Pessoa Física" };
  abrirGaveta(`<div class="dh"><h3>${id ? esc(f.nome) : "Novo fornecedor"}</h3><button class="btn sm" data-close>Fechar</button></div>
   <form class="panel sec" id="fF"><div class="grid">${FORN_F.map(([k, l, list]) => list ? `<label class="f"><span>${esc(l)}</span><select id="ff_${k}" data-f="${k}">${opts(list, f[k])}</select></label>` : `<label class="f ${k === "nome" || k === "endereco" ? "w2" : ""}"><span>${esc(l)}</span><input id="ff_${k}" data-f="${k}" value="${esc(f[k] || "")}"></label>`).join("")}</div>
   <div class="row" style="margin-top:12px"><button class="btn pri">Salvar</button><span class="err" id="ffErr"></span></div>
   ${id ? `<p class="legend">Origem: ${esc(f.origem)} · atualizado em ${fDT(f.atualizadoEm)}</p>` : ""}</form>`);
  $("#fF").onsubmit = async e => {
    e.preventDefault(); const d = {}; $$("#fF [data-f]").forEach(el => d[el.dataset.f] = el.value.trim());
    try { await (id ? api("PUT", "/api/fornecedores/" + id, d) : api("POST", "/api/fornecedores", d)); await carregarFornecedores(); toast("Fornecedor salvo"); fecharGaveta(); }
    catch (x) { $("#ffErr").textContent = x.message; }
  };
}
async function importarFornecedores(arquivo) {
  if (!arquivo) return; const msg = $("#impMsg"); msg.textContent = "Importando…";
  const fd = new FormData(); fd.append("arquivo", arquivo);
  try { const r = await api("POST", "/api/fornecedores/importar", fd); await carregarFornecedores(); render(); toast(`${r.importados} fornecedores importados ou atualizados`); }
  catch (e) { msg.textContent = e.message; }
}

// ---------- MESA: corretores e usuários ----------
function viewUsuarios(m) {
  const admin = S.usuario.papel === "admin";
  const estat = nome => { const cs = S.contratos.filter(c => c.corretor === nome); return { n: cs.length, sc: cs.reduce((s, c) => s + num(c.qtdSc), 0), com: cs.filter(c => c.situacaoComissao === "EM ABERTO").reduce((s, c) => s + num(c.valorComissao), 0) }; };
  const comAcesso = new Set(S.usuarios.filter(u => u.corretorNome).map(u => u.corretorNome));
  const soPlanilha = [...new Set(S.contratos.map(c => c.corretor).filter(Boolean))].filter(n => !comAcesso.has(n)).sort();
  const papel = { admin: "Administrador", mesa: "Mesa comercial", corretor: "Corretor" };
  m.innerHTML = `<h1>Corretores e usuários</h1><p class="sub">Cadastre o corretor com o e-mail dele e o nome usado no controle (coluna Corretor). Ele recebe uma senha provisória por e-mail e cria a própria senha no primeiro acesso.${admin ? "" : " Usuários da mesa são cadastrados pelo administrador."}</p>
   <form class="panel" id="fU" style="margin-bottom:14px"><h2>Novo acesso</h2><div class="grid">
    <label class="f"><span class="req">Nome</span><input id="u_nome" required></label>
    <label class="f"><span class="req">E-mail</span><input id="u_email" type="email" required></label>
    <label class="f"><span>Perfil</span><select id="u_papel"><option value="corretor">Corretor</option>${admin ? `<option value="mesa">Mesa comercial</option><option value="admin">Administrador</option>` : ""}</select></label>
    <label class="f" id="u_cn_l"><span class="req">Nome no controle</span><input id="u_cn" placeholder="Ex.: GUTO" list="u_cn_sug"><datalist id="u_cn_sug">${soPlanilha.map(n => `<option value="${esc(n)}">`).join("")}</datalist></label>
    <label class="f"><span>Corretora / empresa</span><input id="u_emp"></label>
    <label class="f"><span>Telefone</span><input id="u_tel"></label>
   </div><div class="row" style="margin-top:12px"><button class="btn pri">Criar acesso</button><span class="err" id="uErr"></span></div></form>
   <div class="tbl"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Nome no controle</th><th>Situação</th><th class="r">Contratos</th><th class="r">Sacas</th><th class="r">Comissão em aberto</th><th></th></tr></thead><tbody>
   ${S.usuarios.map(u => { const s = u.corretorNome ? estat(u.corretorNome) : null; const pode = admin || u.papel === "corretor";
     return `<tr data-id="${u.id}"><td>${esc(u.nome)}${u.empresa ? ` <span class="muted">· ${esc(u.empresa)}</span>` : ""}</td><td>${esc(u.email)}</td><td>${esc(papel[u.papel])}</td><td>${esc(u.corretorNome || "")}</td>
     <td>${u.ativo ? (u.trocarSenha ? `<span class="chip s-enviada">Aguardando 1º acesso</span>` : `<span class="chip s-aprovada">Ativo</span>`) : `<span class="chip s-reprovada">Bloqueado</span>`}</td>
     <td class="r num">${s ? s.n : ""}</td><td class="r num">${s ? fNum(s.sc) : ""}</td><td class="r num">${s ? fNum(s.com, 2) : ""}</td>
     <td class="acts">${pode && u.id !== S.usuario.id ? `<button class="btn sm" data-acao="senha">Nova senha</button> <button class="btn sm ${u.ativo ? "bad" : ""}" data-acao="ativo">${u.ativo ? "Bloquear" : "Reativar"}</button>${u.papel === "corretor" ? ` <button class="btn sm" data-acao="editar">Editar</button>` : ""}` : ""}</td></tr>`; }).join("")}
   ${soPlanilha.map(n => { const s = estat(n); return `<tr><td>${esc(n)}</td><td class="muted">sem acesso</td><td>Corretor</td><td>${esc(n)}</td><td><span class="chip s-rascunho">Só na planilha</span></td><td class="r num">${s.n}</td><td class="r num">${fNum(s.sc)}</td><td class="r num">${fNum(s.com, 2)}</td><td></td></tr>`; }).join("")}
   </tbody></table></div>`;
  $$("tbody tr", m).forEach(tr => tr.style.cursor = "default");
  $("#u_papel").onchange = e => $("#u_cn_l").hidden = e.target.value !== "corretor";
  $("#fU").onsubmit = async e => {
    e.preventDefault(); $("#uErr").textContent = "";
    try {
      const r = await api("POST", "/api/usuarios", { nome: $("#u_nome").value, email: $("#u_email").value, papel: $("#u_papel").value, corretorNome: $("#u_cn").value, empresa: $("#u_emp").value, telefone: $("#u_tel").value });
      S.usuarios = await api("GET", "/api/usuarios"); render(); mostrarSenha(r.usuario, r.senhaTemporaria, true);
    } catch (x) { $("#uErr").textContent = x.message; }
  };
  $$("button[data-acao]", m).forEach(b => b.onclick = async () => {
    const id = Number(b.closest("tr").dataset.id), u = S.usuarios.find(x => x.id === id);
    try {
      if (b.dataset.acao === "senha") { if (!confirm(`Gerar nova senha provisória para ${u.nome}? A senha atual deixa de funcionar.`)) return; const r = await api("POST", `/api/usuarios/${id}/redefinir-senha`); mostrarSenha(u, r.senhaTemporaria, false); }
      if (b.dataset.acao === "ativo") { if (u.ativo && !confirm(`Bloquear o acesso de ${u.nome}?`)) return; await api("PATCH", "/api/usuarios/" + id, { ativo: !u.ativo }); toast(u.ativo ? "Acesso bloqueado" : "Acesso reativado"); }
      if (b.dataset.acao === "editar") return editarCorretor(u);
      S.usuarios = await api("GET", "/api/usuarios"); if (!$("#overlay").firstChild) render();
    } catch (x) { toast(x.message); }
  });
}
function mostrarSenha(u, senha, novo) {
  abrirGaveta(`<div class="dh"><h3>${novo ? "Acesso criado" : "Nova senha provisória"}</h3><button class="btn sm" data-close>Fechar</button></div>
   <section class="panel sec"><p style="margin-top:0">${esc(u.nome)} entra em <b>${esc(location.origin)}</b> com o e-mail <b>${esc(u.email)}</b> e a senha provisória abaixo. No primeiro acesso o sistema pede uma senha nova.</p>
   <p><span class="secret">${esc(senha)}</span></p>
   <p class="legend">${novo ? "Se o e-mail estiver configurado, o corretor já recebeu estes dados. " : ""}Esta senha não volta a aparecer. Envie por um canal privado, nunca em grupo.</p></section>`);
}
function editarCorretor(u) {
  abrirGaveta(`<div class="dh"><h3>${esc(u.nome)}</h3><button class="btn sm" data-close>Fechar</button></div>
   <form class="panel sec" id="fEc"><div class="grid">
    <label class="f"><span>Nome</span><input id="ec_nome" value="${esc(u.nome)}"></label>
    <label class="f"><span>Nome no controle</span><input id="ec_cn" value="${esc(u.corretorNome || "")}"></label>
    <label class="f"><span>Corretora / empresa</span><input id="ec_emp" value="${esc(u.empresa || "")}"></label>
    <label class="f"><span>Telefone</span><input id="ec_tel" value="${esc(u.telefone || "")}"></label></div>
   <div class="row" style="margin-top:12px"><button class="btn pri">Salvar</button><span class="err" id="ecErr"></span></div></form>`);
  $("#fEc").onsubmit = async e => {
    e.preventDefault();
    try { await api("PATCH", "/api/usuarios/" + u.id, { nome: $("#ec_nome").value, corretorNome: $("#ec_cn").value, empresa: $("#ec_emp").value, telefone: $("#ec_tel").value });
      S.usuarios = await api("GET", "/api/usuarios"); toast("Cadastro salvo"); fecharGaveta(); }
    catch (x) { $("#ecErr").textContent = x.message; }
  };
}

boot();
