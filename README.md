# Mesa de Negociação Yukaer

Plataforma web onde os corretores parceiros preenchem a Boleta de Compra, a mesa comercial aprova, e o contrato aprovado entra no controle de contratos com o próximo número (ex.: 316/2027). Substitui o envio da boleta em Excel e a planilha "Controle de Contratos".

## O que tem

- **Corretor** (acesso externo, por e-mail e senha): nova boleta com busca na base de fornecedores, cálculo de sacas, Funrural, líquido e comissão, anexo de documentos (PDF ou foto), rascunho, envio para a mesa, acompanhamento e reenvio quando a mesa devolve para ajuste.
- **Mesa comercial**: fila de aprovação com checklist do Adm. Comercial, parecer, aprovar / devolver / reprovar; controle de contratos com as mesmas colunas da aba Compras e edição de assinatura, pagamento, entregas e comissão; exportação para Excel; base de fornecedores com importação do Zaak; cadastro de corretores.
- **Administrador**: tudo da mesa, mais cadastro de usuários da mesa e importação da planilha de controle antiga.
- Avisos por e-mail: boleta nova para a mesa, decisão para o corretor, senha provisória para o novo usuário.

## Segurança

- Senhas guardadas com scrypt; senha provisória obriga a troca no primeiro acesso; bloqueio após 10 tentativas erradas em 15 minutos.
- Sessão em cookie HttpOnly e Secure, válida por 12 horas.
- Cada corretor só vê as próprias boletas. Na busca de fornecedores o corretor vê só nome, fazenda e o final do CPF/CNPJ; os dados completos aparecem ao escolher o produtor.
- Documentos ficam fora da pasta pública e só abrem para o dono da boleta e para a mesa.
- A plataforma **não guarda login nem senha do Zaak**. A base de fornecedores é atualizada por importação de uma exportação do Zaak (Excel ou CSV).
- Nenhum dado de produtor fica no código. O banco e os documentos ficam na pasta de dados do servidor.

## Rodar no computador (teste)

Precisa do Node.js 22.13 ou mais novo.

```bash
npm install
npm run criar-admin -- seu.email@yukaer.com.br "Seu Nome"   # mostra a senha provisória
npm run importar-controle -- "C:\caminho\Controle de Contratos.xlsm"   # opcional
npm start   # abre em http://localhost:3000
npm test    # testes do fluxo completo
```

Os dados ficam na pasta `dados/` (banco `yukaer.db` e documentos em `dados/arquivos`).

## Publicar no Azure (App Service)

1. **Criar o App Service** no portal do Azure: Criar recurso > Aplicativo Web.
   - Publicar: Código. Pilha de runtime: **Node 22 LTS**. Sistema operacional: **Linux**.
   - Plano: B1 atende bem para começar (uma instância).
2. **Configuração > Configurações gerais**: ative "Sempre ativado" (Always On). Comando de inicialização: `npm start`.
3. **Variáveis de ambiente** (Configuração > Variáveis de ambiente), conforme `.env.example`:
   - `NODE_ENV=production`
   - `URL_BASE=https://<seu-endereco>` (o endereço público da plataforma)
   - `EMAILS_MESA=mesa@yukaer.com.br` (quem recebe aviso de boleta nova; separe por vírgula)
   - `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (caixa do Microsoft 365 que envia os avisos; precisa ter "SMTP autenticado" ativado no admin do Microsoft 365)
   - Opcional: `PASTA_DADOS` (padrão no Azure: `/home/data`, que é persistente)
4. **Enviar o código**: em Centro de Implantação, conecte o repositório do GitHub (o Azure faz o `npm install` e publica a cada alteração). Alternativa: `az webapp deploy --src-path yukaer-negociacao.zip --type zip`.
5. **Criar o primeiro administrador**: em Ferramentas de desenvolvimento > SSH, rode
   `cd /home/site/wwwroot && npm run criar-admin -- seu.email@yukaer.com.br "Seu Nome"`
6. **Importar o histórico** (opcional): entre como administrador, aba Controle de contratos > "Importar planilha de controle" e escolha o .xlsm. Contratos já existentes não são duplicados.
7. **Domínio próprio** (opcional): Domínios personalizados > adicionar `negociacao.yukaer.com.br` e criar o certificado gerenciado gratuito.

Mantenha **uma única instância** (sem escalar horizontalmente): o banco é um arquivo SQLite em `/home/data`. Para muitas centenas de usuários simultâneos, o próximo passo seria trocar para Azure SQL.

## Backup

- Ative **Backups** no App Service (inclui a pasta `/home`), ou
- copie diariamente `/home/data/yukaer.db` e `/home/data/arquivos/` para um Storage Account.

## Base de fornecedores do Zaak

A aba Fornecedores aceita .xlsx ou .csv com cabeçalhos como Produtor/Nome, Tipo, CPF, CNPJ, Inscrição Estadual, CAR, Fazenda, Município, Estado, Endereço, Telefone, E-mail, Banco, Agência, Conta, PIX, Funrural. Registros com o mesmo CPF/CNPJ são atualizados, não duplicados.

Para automatizar: peça ao suporte do Zaak uma exportação agendada (ou uma API / usuário somente leitura no banco). Com isso dá para criar uma rotina que envia o arquivo para `POST /api/fornecedores/importar` sem ninguém precisar exportar à mão.

## Estrutura

```
server/index.js      configuração por variáveis de ambiente
server/app.js        API (sessão, fornecedores, boletas, decisão, contratos, usuários)
server/db.js         banco SQLite (node:sqlite)
server/auth.js       senhas, sessões, permissões
server/planilhas.js  leitura do controle .xlsm, importação de fornecedores, exportação Excel
server/email.js      avisos por e-mail (SMTP)
public/              telas (index.html, app.js, app.css) e regras de cálculo (regras.js)
scripts/             criar-admin e importar-controle
test/                testes do fluxo completo
```
