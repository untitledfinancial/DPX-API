# DPX Treasury API

ESG-compliant stablecoin treasury management API for DovPaxBranch (DPX) on Base network.

## 🚀 Deploy on DigitalOcean

This repository is ready to deploy on DigitalOcean App Platform.

### Quick Start

1. This repo is connected to DigitalOcean
2. DigitalOcean auto-detects Node.js from `package.json`
3. Builds with: `npm install && npm run build`
4. Runs with: `npm start`

### Environment Variables Required

See `.env.example` for all required environment variables.

**Most Important:**
- `PRIVATE_KEY` - Your wallet private key
- `BASE_RPC_URL` - Base network RPC (from Alchemy)
- `JWT_SECRET` - Random 64-char string
- `DATABASE_URL` - PostgreSQL connection string

**DPX Contracts (Already Configured!):**
- Token: `0x7A62dEcF6936675480F0991A2EF4a0d6f1023891`
- ESG: `0x7717e89bC45cBD5199b44595f6E874ac62d79786`
- Redistribution: `0x4F3741252847E4F07730c4CEC3018b201Ac6ce87`
- Stability/PID: `0xda8aA06cDa9D06001554d948dA473EBe5282Ea17`

## 📦 What's Included

- Treasury API with 25+ endpoints
- DPX token integration on Base
- ESG validation
- Redistribution tracking
- Stability monitoring
- Mercury/Kyriba adapters
- Payment session management for widget

## 🔗 API Endpoints

- `GET /health` - Health check
- `POST /v1/treasury/transfer` - Transfer DPX tokens
- `GET /v1/treasury/balance` - Check balances
- `POST /v1/esg/validate` - ESG validation
- `GET /v1/redistribution/schedule` - View redistribution
- `GET /v1/stability/metrics` - Stability metrics
- `POST /v1/payments/sessions` - Create payment session
- Plus 18 more endpoints!

## 🏗️ Build Commands

```bash
npm install           # Install dependencies
npm run build         # Build TypeScript
npm start            # Start production server
npm run dev          # Development mode (if ts-node installed)
```

## 🔐 Security

- Never commit `.env` files
- Keep private keys secure
- Rotate secrets regularly
- Use environment variables for all sensitive data

---

**DovPaxBranch (DPX)** - ESG-Compliant Stablecoin on Base 💚⚡
