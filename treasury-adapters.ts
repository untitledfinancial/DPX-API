// Treasury System Adapters
// Plug-and-play integrations for different treasury management systems

import { ethers } from 'ethers';
import axios from 'axios';

// ============================================================================
// BASE ADAPTER INTERFACE
// ============================================================================

export interface ITreasuryAdapter {
  initialize(config: any): Promise<void>;
  syncBalance(): Promise<BalanceSyncResult>;
  initiatePayment(payment: PaymentRequest): Promise<PaymentResult>;
  getTransactionStatus(txId: string): Promise<TransactionStatus>;
  reconcile(startDate: Date, endDate: Date): Promise<ReconciliationResult>;
}

export interface BalanceSyncResult {
  fiatBalance: string;
  cryptoBalance: string;
  lastSync: Date;
  discrepancies: any[];
}

export interface PaymentRequest {
  amount: string;
  currency: string;
  recipient: string;
  recipientAddress?: string;
  reference: string;
  urgency: 'standard' | 'fast' | 'instant';
  metadata?: Record<string, any>;
}

export interface PaymentResult {
  paymentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  blockchainTx?: string;
  estimatedCompletion: Date;
  fee: string;
}

export interface TransactionStatus {
  id: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations?: number;
  timestamp: Date;
}

export interface ReconciliationResult {
  period: { start: Date; end: Date };
  totalTransactions: number;
  matched: number;
  unmatched: number;
  discrepancies: Array<{
    txId: string;
    type: string;
    amount: string;
    description: string;
  }>;
}

// ============================================================================
// MERCURY ADAPTER
// ============================================================================

export class MercuryAdapter implements ITreasuryAdapter {
  private apiKey: string;
  private stablecoinApiKey: string;
  private accountId: string;
  private autoSweep: boolean;
  private sweepThreshold: string;
  private sweepDestination: string;
  private syncIntervalMs: number;
  private syncTimer?: NodeJS.Timeout;

  constructor() {
    this.apiKey = '';
    this.stablecoinApiKey = '';
    this.accountId = '';
    this.autoSweep = false;
    this.sweepThreshold = '10000';
    this.sweepDestination = '';
    this.syncIntervalMs = 5 * 60 * 1000; // 5 minutes
  }

  async initialize(config: {
    mercuryApiKey: string;
    stablecoinApiKey: string;
    accountId: string;
    autoSweep?: boolean;
    sweepThreshold?: string;
    sweepDestination?: string;
    balanceSyncInterval?: string;
  }): Promise<void> {
    this.apiKey = config.mercuryApiKey;
    this.stablecoinApiKey = config.stablecoinApiKey;
    this.accountId = config.accountId;
    this.autoSweep = config.autoSweep || false;
    this.sweepThreshold = config.sweepThreshold || '10000';
    this.sweepDestination = config.sweepDestination || '';

    // Parse sync interval (e.g., "5m" -> 5 minutes)
    if (config.balanceSyncInterval) {
      const match = config.balanceSyncInterval.match(/(\d+)([smh])/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        this.syncIntervalMs = value * (
          unit === 's' ? 1000 :
          unit === 'm' ? 60000 :
          3600000
        );
      }
    }

    // Start automatic balance sync
    this.startAutoSync();

    console.log('Mercury adapter initialized');
  }

  private startAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(async () => {
      try {
        const result = await this.syncBalance();
        
        // Auto-sweep if enabled and threshold exceeded
        if (this.autoSweep && parseFloat(result.fiatBalance) > parseFloat(this.sweepThreshold)) {
          await this.executeSweep();
        }
      } catch (error) {
        console.error('Auto-sync failed:', error);
      }
    }, this.syncIntervalMs);
  }

  async syncBalance(): Promise<BalanceSyncResult> {
    try {
      // Fetch Mercury balance
      const mercuryResponse = await axios.get(
        `https://api.mercury.com/api/v1/accounts/${this.accountId}/balance`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const fiatBalance = mercuryResponse.data.available;

      // Fetch stablecoin balance
      const cryptoResponse = await axios.get(
        `https://api.yourstablecoin.io/v1/treasury/balance`,
        {
          params: { wallet_address: this.sweepDestination },
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const cryptoBalance = cryptoResponse.data.balances.available;

      return {
        fiatBalance,
        cryptoBalance,
        lastSync: new Date(),
        discrepancies: []
      };
    } catch (error) {
      console.error('Balance sync failed:', error);
      throw error;
    }
  }

  private async executeSweep(): Promise<void> {
    console.log('Executing auto-sweep...');
    
    try {
      // Get current balance
      const balance = await this.syncBalance();
      const sweepAmount = (parseFloat(balance.fiatBalance) - parseFloat(this.sweepThreshold)).toFixed(2);

      if (parseFloat(sweepAmount) <= 0) {
        return;
      }

      // Initiate Mercury to stablecoin transfer
      // Step 1: Withdraw from Mercury to intermediate crypto address
      const withdrawResponse = await axios.post(
        `https://api.mercury.com/api/v1/accounts/${this.accountId}/withdraw`,
        {
          amount: sweepAmount,
          currency: 'USD',
          destination: 'crypto_wallet',
          blockchain: 'base'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Step 2: Convert to stablecoin
      await axios.post(
        `https://api.yourstablecoin.io/v1/treasury/mint`,
        {
          amount: sweepAmount,
          destination: this.sweepDestination,
          reference: `mercury_sweep_${Date.now()}`
        },
        {
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`Sweep completed: $${sweepAmount}`);
    } catch (error) {
      console.error('Sweep failed:', error);
      throw error;
    }
  }

  async initiatePayment(payment: PaymentRequest): Promise<PaymentResult> {
    try {
      // Mercury processes payments in real-time
      const response = await axios.post(
        `https://api.mercury.com/api/v1/accounts/${this.accountId}/payments`,
        {
          amount: payment.amount,
          currency: payment.currency,
          recipient: {
            name: payment.recipient,
            wallet_address: payment.recipientAddress
          },
          reference: payment.reference,
          urgency: payment.urgency,
          metadata: payment.metadata
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Convert to stablecoin and send
      const stablecoinTx = await axios.post(
        `https://api.yourstablecoin.io/v1/treasury/transfer`,
        {
          from_address: this.sweepDestination,
          to_address: payment.recipientAddress,
          amount: payment.amount,
          currency: 'USDX',
          reference: payment.reference,
          esg_compliance_check: true,
          priority: payment.urgency
        },
        {
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        paymentId: response.data.payment_id,
        status: 'processing',
        blockchainTx: stablecoinTx.data.blockchain_hash,
        estimatedCompletion: new Date(stablecoinTx.data.estimated_confirmation),
        fee: stablecoinTx.data.fee
      };
    } catch (error) {
      console.error('Payment initiation failed:', error);
      throw error;
    }
  }

  async getTransactionStatus(txId: string): Promise<TransactionStatus> {
    try {
      const response = await axios.get(
        `https://api.mercury.com/api/v1/payments/${txId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        id: txId,
        status: response.data.status === 'completed' ? 'confirmed' : 'pending',
        timestamp: new Date(response.data.created_at)
      };
    } catch (error) {
      console.error('Failed to get transaction status:', error);
      throw error;
    }
  }

  async reconcile(startDate: Date, endDate: Date): Promise<ReconciliationResult> {
    try {
      // Fetch Mercury transactions
      const mercuryTxs = await axios.get(
        `https://api.mercury.com/api/v1/accounts/${this.accountId}/transactions`,
        {
          params: {
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString()
          },
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Fetch stablecoin transactions
      const stablecoinTxs = await axios.get(
        `https://api.yourstablecoin.io/v1/treasury/transactions`,
        {
          params: {
            wallet_address: this.sweepDestination,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString()
          },
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Match transactions by reference
      const mercuryMap = new Map(
        mercuryTxs.data.transactions.map((tx: any) => [tx.reference, tx])
      );
      const stablecoinMap = new Map(
        stablecoinTxs.data.transactions.map((tx: any) => [tx.metadata?.reference, tx])
      );

      const discrepancies: any[] = [];
      let matched = 0;

      // Check for unmatched Mercury transactions
      for (const [ref, tx] of mercuryMap) {
        if (stablecoinMap.has(ref)) {
          matched++;
        } else {
          discrepancies.push({
            txId: tx.id,
            type: 'unmatched_mercury',
            amount: tx.amount,
            description: `Mercury transaction not found in stablecoin records: ${ref}`
          });
        }
      }

      // Check for unmatched stablecoin transactions
      for (const [ref, tx] of stablecoinMap) {
        if (!mercuryMap.has(ref)) {
          discrepancies.push({
            txId: tx.transaction_id,
            type: 'unmatched_stablecoin',
            amount: tx.amount,
            description: `Stablecoin transaction not found in Mercury records: ${ref}`
          });
        }
      }

      return {
        period: { start: startDate, end: endDate },
        totalTransactions: mercuryMap.size + stablecoinMap.size,
        matched,
        unmatched: discrepancies.length,
        discrepancies
      };
    } catch (error) {
      console.error('Reconciliation failed:', error);
      throw error;
    }
  }

  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }
}

// ============================================================================
// KYRIBA ADAPTER
// ============================================================================

export class KyribaAdapter implements ITreasuryAdapter {
  private username: string;
  private apiKey: string;
  private stablecoinApiKey: string;
  private companyCode: string;
  private batchProcessing: boolean;
  private batchSchedule: string;
  private reconciliationMode: 'auto' | 'manual';

  constructor() {
    this.username = '';
    this.apiKey = '';
    this.stablecoinApiKey = '';
    this.companyCode = '';
    this.batchProcessing = true;
    this.batchSchedule = '0 */6 * * *'; // Every 6 hours
    this.reconciliationMode = 'auto';
  }

  async initialize(config: {
    kyribaUsername: string;
    kyribaApiKey: string;
    stablecoinApiKey: string;
    companyCode: string;
    batchProcessing?: boolean;
    batchSchedule?: string;
    reconciliationMode?: 'auto' | 'manual';
  }): Promise<void> {
    this.username = config.kyribaUsername;
    this.apiKey = config.kyribaApiKey;
    this.stablecoinApiKey = config.stablecoinApiKey;
    this.companyCode = config.companyCode;
    this.batchProcessing = config.batchProcessing ?? true;
    this.batchSchedule = config.batchSchedule || '0 */6 * * *';
    this.reconciliationMode = config.reconciliationMode || 'auto';

    // Schedule batch processing if enabled
    if (this.batchProcessing) {
      this.scheduleBatchProcessing();
    }

    console.log('Kyriba adapter initialized');
  }

  private scheduleBatchProcessing(): void {
    // Use node-cron for scheduling
    const cron = require('node-cron');
    
    cron.schedule(this.batchSchedule, async () => {
      try {
        console.log('Running scheduled batch processing...');
        await this.processPendingBatch();
      } catch (error) {
        console.error('Batch processing failed:', error);
      }
    });
  }

  async syncBalance(): Promise<BalanceSyncResult> {
    try {
      // Fetch Kyriba balance via SOAP/REST API
      const kyribaResponse = await axios.post(
        `https://api.kyriba.com/v1/cash-balances`,
        {
          companyCode: this.companyCode,
          asOfDate: new Date().toISOString().split('T')[0]
        },
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const fiatBalance = kyribaResponse.data.totalBalance;

      // Fetch stablecoin balance
      const cryptoResponse = await axios.get(
        `https://api.yourstablecoin.io/v1/treasury/balance`,
        {
          params: { wallet_address: this.companyCode },
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const cryptoBalance = cryptoResponse.data.balances.available;

      return {
        fiatBalance,
        cryptoBalance,
        lastSync: new Date(),
        discrepancies: []
      };
    } catch (error) {
      console.error('Balance sync failed:', error);
      throw error;
    }
  }

  async processPendingBatch(): Promise<void> {
    try {
      // Fetch pending payments from Kyriba
      const pendingPayments = await axios.get(
        `https://api.kyriba.com/v1/payments`,
        {
          params: {
            companyCode: this.companyCode,
            status: 'pending',
            paymentMethod: 'crypto'
          },
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Process each payment
      for (const payment of pendingPayments.data.payments) {
        try {
          await this.initiatePayment({
            amount: payment.amount,
            currency: 'USDX',
            recipient: payment.beneficiary.name,
            recipientAddress: payment.beneficiary.cryptoAddress,
            reference: payment.referenceNumber,
            urgency: 'standard',
            metadata: {
              kyriba_payment_id: payment.id,
              value_date: payment.valueDate
            }
          });

          // Update payment status in Kyriba
          await axios.patch(
            `https://api.kyriba.com/v1/payments/${payment.id}`,
            {
              status: 'processed',
              processedDate: new Date().toISOString()
            },
            {
              headers: {
                'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (error) {
          console.error(`Failed to process payment ${payment.id}:`, error);
        }
      }

      console.log(`Processed ${pendingPayments.data.payments.length} payments`);
    } catch (error) {
      console.error('Batch processing failed:', error);
      throw error;
    }
  }

  async initiatePayment(payment: PaymentRequest): Promise<PaymentResult> {
    try {
      // Create payment in stablecoin system
      const stablecoinTx = await axios.post(
        `https://api.yourstablecoin.io/v1/treasury/transfer`,
        {
          from_address: this.companyCode,
          to_address: payment.recipientAddress,
          amount: payment.amount,
          currency: 'USDX',
          reference: payment.reference,
          esg_compliance_check: true,
          priority: payment.urgency,
          metadata: payment.metadata
        },
        {
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        paymentId: stablecoinTx.data.transaction_id,
        status: 'processing',
        blockchainTx: stablecoinTx.data.blockchain_hash,
        estimatedCompletion: new Date(stablecoinTx.data.estimated_confirmation),
        fee: stablecoinTx.data.fee
      };
    } catch (error) {
      console.error('Payment initiation failed:', error);
      throw error;
    }
  }

  async getTransactionStatus(txId: string): Promise<TransactionStatus> {
    try {
      // Query stablecoin API for transaction status
      const response = await axios.get(
        `https://api.yourstablecoin.io/v1/treasury/transactions`,
        {
          params: {
            transaction_id: txId
          },
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const tx = response.data.transactions[0];
      return {
        id: txId,
        status: tx.status,
        confirmations: tx.confirmations,
        timestamp: new Date(tx.timestamp)
      };
    } catch (error) {
      console.error('Failed to get transaction status:', error);
      throw error;
    }
  }

  async reconcile(startDate: Date, endDate: Date): Promise<ReconciliationResult> {
    try {
      // Fetch Kyriba transactions
      const kyribaTxs = await axios.get(
        `https://api.kyriba.com/v1/transactions`,
        {
          params: {
            companyCode: this.companyCode,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            transactionType: 'payment'
          },
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Fetch stablecoin transactions
      const stablecoinTxs = await axios.get(
        `https://api.yourstablecoin.io/v1/treasury/transactions`,
        {
          params: {
            wallet_address: this.companyCode,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString()
          },
          headers: {
            'Authorization': `Bearer ${this.stablecoinApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Advanced reconciliation logic
      const kyribaMap = new Map(
        kyribaTxs.data.transactions.map((tx: any) => [tx.referenceNumber, tx])
      );
      const stablecoinMap = new Map(
        stablecoinTxs.data.transactions.map((tx: any) => [
          tx.metadata?.reference || tx.reference,
          tx
        ])
      );

      const discrepancies: any[] = [];
      let matched = 0;

      // Detailed matching with amount verification
      for (const [ref, kyribaTx] of kyribaMap) {
        const stablecoinTx = stablecoinMap.get(ref);
        
        if (stablecoinTx) {
          // Check if amounts match
          if (Math.abs(parseFloat(kyribaTx.amount) - parseFloat(stablecoinTx.amount)) > 0.01) {
            discrepancies.push({
              txId: ref,
              type: 'amount_mismatch',
              amount: kyribaTx.amount,
              description: `Amount mismatch: Kyriba=${kyribaTx.amount}, Stablecoin=${stablecoinTx.amount}`
            });
          } else {
            matched++;
          }
        } else {
          discrepancies.push({
            txId: kyribaTx.id,
            type: 'unmatched_kyriba',
            amount: kyribaTx.amount,
            description: `Kyriba transaction not found in stablecoin records: ${ref}`
          });
        }
      }

      // Check for unmatched stablecoin transactions
      for (const [ref, tx] of stablecoinMap) {
        if (!kyribaMap.has(ref)) {
          discrepancies.push({
            txId: tx.transaction_id,
            type: 'unmatched_stablecoin',
            amount: tx.amount,
            description: `Stablecoin transaction not found in Kyriba records: ${ref}`
          });
        }
      }

      return {
        period: { start: startDate, end: endDate },
        totalTransactions: kyribaMap.size + stablecoinMap.size - matched,
        matched,
        unmatched: discrepancies.length,
        discrepancies
      };
    } catch (error) {
      console.error('Reconciliation failed:', error);
      throw error;
    }
  }

  async exportComplianceReport(startDate: Date, endDate: Date): Promise<Buffer> {
    // Export transactions in Kyriba-compatible format
    const report = await axios.get(
      `https://api.yourstablecoin.io/v1/reports/treasury`,
      {
        params: {
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          format: 'csv',
          include_sections: 'transactions,esg,stability'
        },
        headers: {
          'Authorization': `Bearer ${this.stablecoinApiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    return Buffer.from(report.data);
  }
}

// ============================================================================
// ADAPTER FACTORY
// ============================================================================

export class TreasuryAdapterFactory {
  static create(type: 'mercury' | 'kyriba' | 'custom'): ITreasuryAdapter {
    switch (type) {
      case 'mercury':
        return new MercuryAdapter();
      case 'kyriba':
        return new KyribaAdapter();
      default:
        throw new Error(`Unknown adapter type: ${type}`);
    }
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// Initialize Mercury adapter
const mercuryAdapter = TreasuryAdapterFactory.create('mercury');
await mercuryAdapter.initialize({
  mercuryApiKey: 'merc_live_...',
  stablecoinApiKey: 'sk_live_...',
  accountId: 'acc_123',
  autoSweep: true,
  sweepThreshold: '10000',
  sweepDestination: '0x742d35Cc...',
  balanceSyncInterval: '5m'
});

// Sync balances
const balance = await mercuryAdapter.syncBalance();
console.log('Balances:', balance);

// Initiate payment
const payment = await mercuryAdapter.initiatePayment({
  amount: '5000.00',
  currency: 'USDX',
  recipient: 'Supplier XYZ',
  recipientAddress: '0x8ba1f109...',
  reference: 'INV-2024-001',
  urgency: 'standard'
});
console.log('Payment initiated:', payment);

// Reconcile
const reconciliation = await mercuryAdapter.reconcile(
  new Date('2024-11-01'),
  new Date('2024-11-21')
);
console.log('Reconciliation:', reconciliation);
*/
