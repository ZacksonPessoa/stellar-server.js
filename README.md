# CriptoPix‑MG (Proof‑of‑Concept)

Backend Node/Express para integrar **Stellar Testnet** ao fluxo de cotações/pagamentos com **MoneyGram** (via descoberta SEP‑1). Este repositório é um POC didático, focado em:

1. Conectar no Horizon (Testnet)
2. Descobrir e baixar o `stellar.toml` do anchor (MoneyGram)
3. Criar e usar contas de teste na Testnet
4. Expor endpoints para cotação/checkout seguindo o padrão dos nossos fluxos **A/B**

> **Stack**: Node 18+, Express, `@stellar/stellar-sdk`, `@iarna/toml`, CORS, Docker.

---

## 📁 Estrutura

```
criptopix-mg/
├─ .dockerignore
├─ .env                 # variáveis locais (NÃO commitar)
├─ docker-compose.yml   # subir app com Docker (inclui túnel Cloudflare)
├─ Dockerfile           # imagem do app
├─ package.json
├─ package-lock.json
└─ server.js            # servidor Express (ESM)
```

---

## 🔧 Pré‑requisitos

* **Node.js 18+** (ou 20+)
* **npm** ou **pnpm**
* (Opcional) **Docker** e **Docker Compose**

Verifique versões:

```bash
node -v
npm -v
```

---

## 🔐 Variáveis de ambiente (`.env`)

Crie um arquivo `.env` na raiz com o seguinte conteúdo (ajuste se necessário):

```ini
# Porta do servidor HTTP
PORT=4001

# Horizon da Stellar (Testnet por padrão)
HORIZON_URL=https://horizon-testnet.stellar.org

# Passphrase da rede (Testnet)
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Domínio base para descoberta SEP-1 da MoneyGram
MONEYGRAM_HOME=https://extstellar.moneygram.com

# Domínio público do cliente (requisito SEP-10)
CLIENT_DOMAIN=http://localhost:4001

# Conta da wallet que assina (SEP-10)
WALLET_SIGNING_KEY=<PUBLIC_KEY>
WALLET_SIGNING_SECRET=<SECRET_KEY>

# Conta de usuário de teste
TEST_USER_PUBLIC=<PUBLIC_KEY>
TEST_USER_SECRET=<SECRET_KEY>
```

> **Dica:** use [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) ou o **Friendbot** para criar contas e receber XLM de teste.

---

## 💳 Criando uma carteira de teste

1. Gere um par de chaves:

```bash
node -e "const {Keypair}=require('@stellar/stellar-sdk');const kp=Keypair.random();console.log('Public:',kp.publicKey());console.log('Secret:',kp.secret());"
```

2. Cole os valores no `.env` (`TEST_USER_PUBLIC` e `TEST_USER_SECRET`).
3. Alimente a conta na **Testnet**:

```bash
curl "https://friendbot.stellar.org?addr=<TEST_USER_PUBLIC>"
```

---

## 🪪 Criar carteiras de teste (server & usuário)

Criaremos **duas chaves**:

* **Servidor (WALLET\_SIGNING\_KEY/SECRET)** → assina o desafio SEP‑10 e vai no seu `stellar.toml`. **Não precisa** ser conta financiada.
* **Usuário (TEST\_USER\_PUBLIC/SECRET)** → conta que assina o desafio. **Precisa** existir na testnet (funding via Friendbot).

> Requer `@stellar/stellar-sdk` já instalado (vem nas deps do projeto).

### 1) Gerar chave do **servidor**

```bash
node --input-type=module -e "import {Keypair} from '@stellar/stellar-sdk';const k=Keypair.random();console.log('WALLET_SIGNING_KEY='+k.publicKey());console.log('WALLET_SIGNING_SECRET='+k.secret());"
```

Copie os valores para o `.env`.

### 2) Gerar chave do **usuário de testes**

```bash
node --input-type=module -e "import {Keypair} from '@stellar/stellar-sdk';const k=Keypair.random();console.log('TEST_USER_PUBLIC='+k.publicKey());console.log('TEST_USER_SECRET='+k.secret());"
```

Adicione ao `.env` e **financie** a conta na Testnet:

```bash
PUB=$(grep '^TEST_USER_PUBLIC=' .env | cut -d= -f2)
# opcional: verifique tamanho/validez
echo -n "$PUB" | wc -c
# friendbot
curl "https://friendbot.stellar.org/?addr=$PUB"
```

### 3) (Opcional) Definir `CLIENT_DOMAIN`

Defina um domínio acessível que sirva `/.well-known/stellar.toml` (pode ser localhost em dev ou um subdomínio do tunnel), ex.:

```ini
CLIENT_DOMAIN=http://localhost:4001
```

---

## ▶️ Rodando localmente (sem Docker)

Instale dependências e suba o servidor:

```bash
npm install
npm run dev
```

O app inicia na porta definida (ex.: `http://localhost:4001`).

---

## 🐳 Rodando com Docker

### Build + run

```bash
docker compose up --build
```

Aplicação disponível em `http://localhost:4001` (ou túnel Cloudflare se configurado).

### Parar

```bash
docker compose down
```

---

## 🌐 Endpoints atuais

### `GET /horizon/ping`

Verifica conectividade com Horizon Testnet e retorna o último ledger.

### `GET /.well-known/stellar.toml`

Serve um **stellar.toml mínimo do próprio app** (usa `NETWORK_PASSPHRASE` e `WALLET_SIGNING_KEY` do `.env`).

### `GET /moneygram/sep1`

Baixa e (opcionalmente) faz cache do `stellar.toml` da MoneyGram (definida em `MONEYGRAM_HOME`).

### `GET /moneygram/endpoints`

Retorna os **endpoints descobertos** a partir do TOML (ex.: `WEB_AUTH_ENDPOINT` para SEP‑10).

### `GET /moneygram/sep10/challenge?account=G...&client_domain=...` (opcional `client_domain`)

Cria o **XDR de desafio** SEP‑10 assinado pelo servidor (chave `WALLET_SIGNING_SECRET`).

### `POST /moneygram/sep10/token`

Recebe o **XDR assinado pelo usuário** e troca por um **JWT** (mock/P.O.C.).

#### Exemplos rápidos (cURL)

```bash
# Healthcheck
curl http://localhost:$PORT/horizon/ping

# TOML do seu app
curl http://localhost:$PORT/.well-known/stellar.toml

# TOML da MoneyGram
curl http://localhost:$PORT/moneygram/sep1

# Endpoints descobertos a partir do TOML da MG
curl http://localhost:$PORT/moneygram/endpoints

# Desafio SEP-10 (use sua conta do TEST_USER_PUBLIC)
curl "http://localhost:$PORT/moneygram/sep10/challenge?account=$TEST_USER_PUBLIC&client_domain=$CLIENT_DOMAIN"

# Troca do XDR assinado por token (envie o XDR assinado no campo transaction)
curl -X POST http://localhost:$PORT/moneygram/sep10/token \
  -H 'Content-Type: application/json' \
  -d '{"transaction":"PASTE_O_XDR_ASSINADO_AQUI"}'
```

---

## 🧠 Conceitos usados

* **Stellar Horizon**: API para consultar a rede (contas, ledgers, transações).
* **Friendbot**: serviço que envia XLM grátis para contas de teste.
* **SEP‑1 (stellar.toml)**: arquivo de configuração hospedado no domínio do anchor.
* **SEP‑10**: protocolo de autenticação via challenge/assinatura.
* **`@stellar/stellar-sdk`**: cliente oficial para assinar/consultar a rede.

---

## 🧪 Testes rápidos (rotas)

1. **Suba o servidor** e confira o log das rotas:

```bash
npm run dev
# ou
node server.js
```

2. **Ping no Horizon**

```bash
curl http://localhost:$PORT/horizon/ping
```

3. **Seu TOML público** (servido pelo app)

```bash
curl http://localhost:$PORT/.well-known/stellar.toml
```

4. **Descobrir TOML da MoneyGram** e extrair endpoints

```bash
curl http://localhost:$PORT/moneygram/sep1
curl http://localhost:$PORT/moneygram/endpoints
```

5. **Fluxo SEP‑10 (local, POC)**

```bash
# 5.1 Gerar desafio
XDR=$(curl -s "http://localhost:$PORT/moneygram/sep10/challenge?account=$TEST_USER_PUBLIC&client_domain=$CLIENT_DOMAIN" | jq -r .transaction)

# 5.2 Assinar XDR com a chave do usuário
SIGNED_XDR=$(node --input-type=module -e '
import {Keypair, TransactionBuilder, Networks} from "@stellar/stellar-sdk";
const kp = Keypair.fromSecret(process.env.TEST_USER_SECRET);
const tx = TransactionBuilder.fromXDR(process.env.XDR, Networks.TESTNET);
tx.sign(kp);
console.log(tx.toXDR());
' XDR="$XDR" TEST_USER_SECRET="$TEST_USER_SECRET")

# 5.3 Trocar XDR por token (mock)
curl -s -X POST http://localhost:$PORT/moneygram/sep10/token \
  -H 'Content-Type: application/json' \
  -d "{\"transaction\":\"$SIGNED_XDR\"}"
```

> Se algum passo falhar, verifique `MONEYGRAM_HOME`, `NETWORK_PASSPHRASE`, chaves no `.env` e conectividade. Em dev, o CORS já está liberado.

---

## 🗺️ Roadmap (curto prazo)

* [x] Criar contas de teste e expor `.well-known/stellar.toml`.
* [x] Implementar ping ao Horizon.
* [x] Implementar discovery SEP‑1.
* [ ] Completar fluxo SEP‑10 (challenge + token).
* [ ] Integrar cotação USDC→BRL via MoneyGram.
* [ ] Criar rotas de checkout e instruções de pagamento.

---

## 🔒 Segurança

Este POC não implementa autenticação completa, rate limits ou secret management. Antes de expor publicamente:

* Ative HTTPS (reverse proxy, Nginx/Caddy)
* Configure tokens/keys via secrets
* Aplique CORS restritivo e logs
* Adicione validações de entrada e testes

---

## 📜 Licença

MIT — uso livre para estudos e POCs. Veja `LICENSE` (se aplicável).

---

## 👥 Autores e crédito

* **Zack (Analista de Sistemas)** — idealização e desenvolvimento


> Dúvidas ou melhorias? Abra uma *issue* ou envie sugestões no próximo commit.
