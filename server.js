// 1) carrega .env (atalho ESM)
import 'dotenv/config';

// 2) importa libs (ESM)
import express from 'express';
import cors from 'cors';
import sdk from '@stellar/stellar-sdk';
const ServerCtor =
  (sdk?.Horizon && sdk.Horizon.Server) ||  // caso 1: CJS -> Horizon.Server
  sdk?.Server ||                           // caso 2: export direto
  sdk?.default?.Horizon?.Server;           // caso 3: ESM default -> Horizon.Server
import TOML from '@iarna/toml';

// 3) app + middlewares
const app = express();
app.use(cors());
app.use(express.json());

// 4) configs
const PORT = process.env.PORT || 4001;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const MONEYGRAM_HOME = process.env.MONEYGRAM_HOME || 'https://extstellar.moneygram.com';

// 5) cliente Horizon (Testnet)
const horizon = new ServerCtor(HORIZON_URL);

// 6) prova de conexão com a Testnet
app.get('/horizon/ping', async (_req, res) => {
  try {
    const { records } = await horizon.ledgers().order('desc').limit(1).call();
    res.json({ network: 'testnet', horizon: HORIZON_URL, latest_ledger: records[0].sequence });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// 7) baixar o stellar.toml da MoneyGram (texto)
app.get('/moneygram/sep1', async (_req, res) => {
  try {
    const url = `${MONEYGRAM_HOME}/.well-known/stellar.toml`;
    const r = await fetch(url);
    const text = await r.text();
    res.type('text/plain').send(text);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// 8) extrair endpoints úteis do TOML (JSON)
app.get('/moneygram/endpoints', async (_req, res) => {
  try {
    const url = `${MONEYGRAM_HOME}/.well-known/stellar.toml`;
    const r = await fetch(url);
    const text = await r.text();
    const toml = TOML.parse(text);

    const webAuth = toml.WEB_AUTH_ENDPOINT || toml['WEB_AUTH_ENDPOINT'];
    const sep24 = toml.TRANSFER_SERVER_SEP0024 || toml['TRANSFER_SERVER_SEP0024'];
    let usdcIssuer = '';
    if (Array.isArray(toml.CURRENCIES)) {
      const usdc = toml.CURRENCIES.find(c => (c.code === 'USDC' || c.code === 'usdc') && c.issuer);
      if (usdc) usdcIssuer = usdc.issuer;
    }
    res.json({
      MONEYGRAM_HOME,
      NETWORK_PASSPHRASE: toml.NETWORK_PASSPHRASE,
      WEB_AUTH_ENDPOINT: webAuth,
      TRANSFER_SERVER_SEP0024: sep24,
      USDC_ISSUER: usdcIssuer
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ----------------------------
   Helper: busca challenge SEP-10
-----------------------------*/
async function fetchSep10Challenge(account) {
  if (!/^G[A-Z2-7]{55}$/.test(account)) {
    return { status: 400, body: { error: 'Parâmetro "account" inválido. Envie uma conta Stellar (G...)' } };
  }

  // SEP-1 → pega WEB_AUTH_ENDPOINT
  const tomlText = await (await fetch(`${MONEYGRAM_HOME}/.well-known/stellar.toml`)).text();
  const toml = TOML.parse(tomlText);
  const webAuth = toml.WEB_AUTH_ENDPOINT || toml['WEB_AUTH_ENDPOINT'];
  if (!webAuth) return { status: 500, body: { error: 'WEB_AUTH_ENDPOINT não encontrado no stellar.toml da MoneyGram' } };

  // monta query (com client_domain)
  const q = new URLSearchParams({ account });
  if (process.env.CLIENT_DOMAIN) q.set('client_domain', process.env.CLIENT_DOMAIN);

  // chama o endpoint do anchor
  const r = await fetch(`${webAuth}?${q.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json, text/plain, */*' }
  });
  const text = await r.text();

  try {
    const json = JSON.parse(text);
    return { status: r.status, body: json, webAuth };
  } catch {
    return {
      status: r.status,
      body: { raw: text, status: r.status, nota: 'Resposta não-json recebida do WEB_AUTH_ENDPOINT da MoneyGram' },
      webAuth
    };
  }
}

// === SEP-10 — challenge (GET) ===
// GET /moneygram/sep10/challenge?account=G...
app.get('/moneygram/sep10/challenge', async (req, res) => {
  const account = String(req.query.account || '').trim();
  const out = await fetchSep10Challenge(account);
  return res.status(out.status).json(out.body);
});

// === SEP-10 — token (POST) ===
// POST /moneygram/sep10/token  { account?: "G..." }
app.post('/moneygram/sep10/token', async (req, res) => {
  try {
    const account = String(req.body?.account || process.env.TEST_USER_PUBLIC || '').trim();

    // 1) pega challenge (usa o mesmo helper)
    const out = await fetchSep10Challenge(account);
    if (!out.body || !out.body.transaction) {
      // veio WAF/HTML ou erro: repassa
      return res.status(out.status).json(out.body);
    }

    // 2) assina XDR (usuário + domínio)
    const { TransactionBuilder, Keypair } = sdk;
    const network = out.body.network_passphrase || NETWORK_PASSPHRASE;
    const tx = TransactionBuilder.fromXDR(out.body.transaction, network);

    // DEV: usa TEST_USER_SECRET; em produção, a assinatura do usuário vem do Freighter
    const kpUser   = Keypair.fromSecret(process.env.TEST_USER_SECRET || '');
    const kpWallet = Keypair.fromSecret(process.env.WALLET_SIGNING_SECRET || '');
    tx.sign(kpUser);
    tx.sign(kpWallet);
    const signedXdr = tx.toXDR();

    // 3) troca por token
    const tokenResp = await fetch(out.webAuth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ transaction: signedXdr })
    });
    const tokenText = await tokenResp.text();
    try { return res.status(tokenResp.status).json(JSON.parse(tokenText)); }
    catch { return res.status(tokenResp.status).json({ raw: tokenText, status: tokenResp.status }); }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// 4.1) TOML público do seu domínio (requisito do client_domain/SEP-10)
app.get('/.well-known/stellar.toml', (_req, res) => {
  const toml = [
    `NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE}"`,
    `VERSION="2.1.0"`,
    `SIGNING_KEY="${process.env.WALLET_SIGNING_KEY || ''}"`
  ].join('\n');
  res.type('text/plain').send(toml);
});

// 9) start
app.listen(PORT, () => {
  console.log(`Server ON → http://localhost:${PORT}`);
  console.log(`Testes:
   • /horizon/ping
   • /moneygram/sep1
   • /moneygram/endpoints
   • /moneygram/sep10/challenge?account=G...
   • POST /moneygram/sep10/token`);
});
