# DPX Treasury API

### Environment Variables Required

```bash
# Blockchain
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
TREASURY_WALLET_ADDRESS=0xYOUR_WALLET

# DPX Contracts (Already configured!)
DPX_TOKEN_ADDRESS=0x7A62dEcF6936675480F0991A2EF4a0d6f1023891
ESG_CONTRACT_ADDRESS=0x7717e89bC45cBD5199b44595f6E874ac62d79786
REDISTRIBUTION_CONTRACT_ADDRESS=0x4F3741252847E4F07730c4CEC3018b201Ac6ce87
STABILITY_PID_CONTRACT_ADDRESS=0xda8aA06cDa9D06001554d948dA473EBe5282Ea17

# Server
PORT=3000
NODE_ENV=production
```

## 📦 API Endpoints

- `GET /health` - Health check
- `GET /v1/treasury/balance?wallet_address=0x...` - Get DPX balance
- `GET /v1/treasury/token-info` - Token information
- `GET /v1/treasury/wallet-info` - Wallet information
- `POST /v1/treasury/transfer` - Transfer DPX tokens
- `POST /v1/esg/validate` - Validate ESG compliance
- `GET /v1/esg/score?address=0x...` - Get ESG score
- `GET /v1/network/info` - Network information

## 🔗 DPX Contracts (Base Network)

- **Token**: 0x7A62dEcF6936675480F0991A2EF4a0d6f1023891
- **ESG**: 0x7717e89bC45cBD5199b44595f6E874ac62d79786
- **Redistribution**: 0x4F3741252847E4F07730c4CEC3018b201Ac6ce87
- **Stability/PID**: 0xda8aA06cDa9D06001554d948dA473EBe5282Ea17

---

**DovPaxBranch (DPX)** - ESG-Compliant Stablecoin on Base 💚⚡
