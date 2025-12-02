// DPX Treasury API - Simplified Working Version
// This version compiles successfully and is ready for Railway deployment

import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================================
// BLOCKCHAIN SETUP
// ============================================================================

const provider = new ethers.JsonRpcProvider(
  process.env.BASE_RPC_URL || 'https://mainnet.base.org'
);

const wallet = new ethers.Wallet(
  process.env.PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000000',
  provider
);

// DPX Token Contract
const DPX_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

const dpxToken = new ethers.Contract(
  process.env.DPX_TOKEN_ADDRESS || '0x7A62dEcF6936675480F0991A2EF4a0d6f1023891',
  DPX_TOKEN_ABI,
  wallet
);

// ESG Contract
const ESG_CONTRACT_ABI = [
  'function validateTransaction(address from, address to, uint256 amount) view returns (bool, uint256)',
  'function getESGScore(address account) view returns (uint256)'
];

const esgContract = new ethers.Contract(
  process.env.ESG_CONTRACT_ADDRESS || '0x7717e89bC45cBD5199b44595f6E874ac62d79786',
  ESG_CONTRACT_ABI,
  wallet
);

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    contracts: {
      dpx_token: process.env.DPX_TOKEN_ADDRESS,
      esg: process.env.ESG_CONTRACT_ADDRESS,
      redistribution: process.env.REDISTRIBUTION_CONTRACT_ADDRESS,
      stability: process.env.STABILITY_PID_CONTRACT_ADDRESS
    }
  });
});

// Get DPX balance
app.get('/v1/treasury/balance', async (req, res) => {
  try {
    const walletAddress = req.query.wallet_address as string || process.env.TREASURY_WALLET_ADDRESS;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'wallet_address required' });
    }

    const balance = await dpxToken.balanceOf(walletAddress);
    const decimals = await dpxToken.decimals();
    const formattedBalance = ethers.formatUnits(balance, decimals);

    res.json({
      wallet_address: walletAddress,
      balance: formattedBalance,
      balance_wei: balance.toString(),
      currency: 'DPX',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: 'Failed to get balance', message: error.message });
  }
});

// Get token info
app.get('/v1/treasury/token-info', async (req, res) => {
  try {
    const name = await dpxToken.name();
    const symbol = await dpxToken.symbol();
    const decimals = await dpxToken.decimals();
    const totalSupply = await dpxToken.totalSupply();
    const formattedSupply = ethers.formatUnits(totalSupply, decimals);

    res.json({
      name,
      symbol,
      decimals: Number(decimals),
      total_supply: formattedSupply,
      total_supply_wei: totalSupply.toString(),
      contract_address: process.env.DPX_TOKEN_ADDRESS,
      network: 'Base',
      chain_id: 8453
    });
  } catch (error: any) {
    console.error('Token info error:', error);
    res.status(500).json({ error: 'Failed to get token info', message: error.message });
  }
});

// ESG validation
app.post('/v1/esg/validate', async (req, res) => {
  try {
    const { from_address, to_address, amount } = req.body;

    if (!from_address || !to_address || !amount) {
      return res.status(400).json({ error: 'from_address, to_address, and amount required' });
    }

    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const [passed, score] = await esgContract.validateTransaction(from_address, to_address, amountWei);

    res.json({
      passed,
      score: Number(score),
      from_address,
      to_address,
      amount,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('ESG validation error:', error);
    res.status(500).json({ error: 'ESG validation failed', message: error.message });
  }
});

// Get ESG score
app.get('/v1/esg/score', async (req, res) => {
  try {
    const address = req.query.address as string;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    const score = await esgContract.getESGScore(address);

    res.json({
      address,
      score: Number(score),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('ESG score error:', error);
    res.status(500).json({ error: 'Failed to get ESG score', message: error.message });
  }
});

// Transfer DPX tokens
app.post('/v1/treasury/transfer', async (req, res) => {
  try {
    const { to_address, amount } = req.body;

    if (!to_address || !amount) {
      return res.status(400).json({ error: 'to_address and amount required' });
    }

    const amountWei = ethers.parseUnits(amount.toString(), 18);
    
    // Execute transfer
    const tx = await dpxToken.transfer(to_address, amountWei);
    const receipt = await tx.wait();

    res.json({
      success: true,
      transaction_hash: receipt.hash,
      from_address: wallet.address,
      to_address,
      amount,
      block_number: receipt.blockNumber,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: 'Transfer failed', message: error.message });
  }
});

// Get network info
app.get('/v1/network/info', async (req, res) => {
  try {
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();

    res.json({
      network_name: network.name,
      chain_id: Number(network.chainId),
      current_block: blockNumber,
      rpc_url: process.env.BASE_RPC_URL || 'Not configured',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Network info error:', error);
    res.status(500).json({ error: 'Failed to get network info', message: error.message });
  }
});

// Get wallet info
app.get('/v1/treasury/wallet-info', (req, res) => {
  res.json({
    address: wallet.address,
    network: 'Base',
    chain_id: 8453,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    available_routes: [
      'GET /health',
      'GET /v1/treasury/balance',
      'GET /v1/treasury/token-info',
      'GET /v1/treasury/wallet-info',
      'POST /v1/treasury/transfer',
      'POST /v1/esg/validate',
      'GET /v1/esg/score',
      'GET /v1/network/info'
    ]
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log('============================================');
  console.log('🚀 DPX Treasury API Server Started');
  console.log('============================================');
  console.log(`Port: ${PORT}`);
  console.log(`Network: Base (Chain ID: 8453)`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`DPX Token: ${process.env.DPX_TOKEN_ADDRESS}`);
  console.log(`ESG Contract: ${process.env.ESG_CONTRACT_ADDRESS}`);
  console.log('============================================');
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('============================================');
});

export default app;
