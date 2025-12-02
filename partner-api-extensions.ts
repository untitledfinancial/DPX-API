// Partner API Extensions - Add these to api-server.ts
// Handles payment sessions for DPX Connect widget

import crypto from 'crypto';

// ============================================================================
// PARTNER SESSION MANAGEMENT
// ============================================================================

interface PaymentSession {
  id: string;
  partner_api_key: string;
  amount: string;
  recipient: string;
  recipient_address?: string;
  reference?: string;
  metadata?: Record<string, any>;
  status: 'created' | 'pending' | 'completed' | 'failed';
  esg_validation?: ESGValidation;
  transaction_id?: string;
  created_at: Date;
  expires_at: Date;
}

// In-memory session store (use Redis in production)
const sessionStore = new Map<string, PaymentSession>();

// Session expiry: 30 minutes
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// ============================================================================
// POST /v1/payments/sessions
// Create payment session for DPX Connect widget
// ============================================================================

app.post('/v1/payments/sessions',
  authenticateApiKey,
  [
    body('amount').isDecimal(),
    body('recipient').notEmpty(),
    body('recipient_address').optional().isEthereumAddress(),
    body('reference').optional().isString(),
    body('metadata').optional().isObject(),
    body('esg_compliance_check').optional().isBoolean(),
    body('return_url').optional().isURL()
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Generate unique session ID
      const sessionId = `sess_${crypto.randomBytes(24).toString('hex')}`;
      
      // Get partner API key from auth
      const partnerApiKey = req.user.api_key; // From authenticateApiKey middleware
      
      // Pre-validate ESG if requested
      let esgValidation = null;
      if (req.body.esg_compliance_check && req.body.recipient_address) {
        try {
          esgValidation = await validateESGCompliance(
            req.user.default_wallet, // Partner's default wallet
            req.body.recipient_address,
            req.body.amount
          );
        } catch (error) {
          console.warn('Pre-validation ESG check failed:', error);
          // Don't fail session creation, just note it
        }
      }
      
      // Create session
      const session: PaymentSession = {
        id: sessionId,
        partner_api_key: partnerApiKey,
        amount: req.body.amount,
        recipient: req.body.recipient,
        recipient_address: req.body.recipient_address,
        reference: req.body.reference,
        metadata: {
          ...req.body.metadata,
          return_url: req.body.return_url,
          user_agent: req.headers['user-agent'],
          ip_address: req.ip
        },
        status: 'created',
        esg_validation: esgValidation,
        created_at: new Date(),
        expires_at: new Date(Date.now() + SESSION_EXPIRY_MS)
      };
      
      // Store session
      sessionStore.set(sessionId, session);
      
      // Schedule cleanup
      setTimeout(() => {
        if (sessionStore.has(sessionId)) {
          const sess = sessionStore.get(sessionId);
          if (sess.status === 'created' || sess.status === 'pending') {
            sess.status = 'failed';
            sessionStore.delete(sessionId);
          }
        }
      }, SESSION_EXPIRY_MS);
      
      // Return session details
      res.status(201).json({
        id: sessionId,
        status: session.status,
        amount: session.amount,
        recipient: session.recipient,
        esg_validation: esgValidation ? {
          passed: esgValidation.passed,
          score: esgValidation.score
        } : null,
        expires_at: session.expires_at.toISOString(),
        connect_url: `https://connect.dpx.io/payment/${sessionId}`
      });
      
      // Track analytics
      await logAudit({
        organization_id: req.user.organization_id,
        action: 'payment_session_created',
        resource_type: 'payment_session',
        resource_id: sessionId,
        metadata: {
          amount: session.amount,
          recipient: session.recipient
        }
      });
      
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to create payment session',
          request_id: req.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// ============================================================================
// GET /v1/payments/sessions/:id
// Get payment session details
// ============================================================================

app.get('/v1/payments/sessions/:id',
  authenticateApiKey,
  async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    
    if (!sessionStore.has(sessionId)) {
      return res.status(404).json({
        error: {
          code: 'session_not_found',
          message: 'Payment session not found or expired',
          request_id: req.id,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    const session = sessionStore.get(sessionId);
    
    // Verify ownership
    if (session.partner_api_key !== req.user.api_key) {
      return res.status(403).json({
        error: {
          code: 'forbidden',
          message: 'Not authorized to access this session',
          request_id: req.id,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    res.json({
      id: session.id,
      status: session.status,
      amount: session.amount,
      recipient: session.recipient,
      recipient_address: session.recipient_address,
      reference: session.reference,
      transaction_id: session.transaction_id,
      esg_validation: session.esg_validation ? {
        passed: session.esg_validation.passed,
        score: session.esg_validation.score
      } : null,
      created_at: session.created_at.toISOString(),
      expires_at: session.expires_at.toISOString()
    });
  }
);

// ============================================================================
// POST /v1/payments/sessions/:id/execute
// Execute payment from session (called by iframe)
// ============================================================================

app.post('/v1/payments/sessions/:id/execute',
  authenticateApiKey,
  [
    body('from_address').isEthereumAddress(),
    body('confirm').equals(true)
  ],
  async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    
    if (!sessionStore.has(sessionId)) {
      return res.status(404).json({
        error: {
          code: 'session_not_found',
          message: 'Payment session not found or expired'
        }
      });
    }
    
    const session = sessionStore.get(sessionId);
    
    // Check if already processed
    if (session.status !== 'created') {
      return res.status(400).json({
        error: {
          code: 'session_already_processed',
          message: `Session is already ${session.status}`
        }
      });
    }
    
    // Mark as pending
    session.status = 'pending';
    
    try {
      // Ensure recipient address is set
      if (!session.recipient_address) {
        throw new Error('Recipient address is required');
      }
      
      // Execute ESG validation
      const esgValidation = await validateESGCompliance(
        req.body.from_address,
        session.recipient_address,
        session.amount
      );
      
      if (!esgValidation.passed) {
        session.status = 'failed';
        return res.status(400).json({
          error: {
            code: 'esg_validation_failed',
            message: 'Transaction failed ESG compliance check',
            details: esgValidation
          }
        });
      }
      
      // Check balance
      const balance = await getWalletBalance(req.body.from_address);
      if (parseFloat(balance.available) < parseFloat(session.amount)) {
        session.status = 'failed';
        return res.status(400).json({
          error: {
            code: 'insufficient_balance',
            message: 'Insufficient DPX balance',
            details: {
              available: balance.available,
              required: session.amount
            }
          }
        });
      }
      
      // Execute transfer
      const decimals = await dpxToken.decimals();
      const amountWei = ethers.parseUnits(session.amount, decimals);
      
      const tx = await dpxToken.transfer(
        session.recipient_address,
        amountWei
      );
      
      // Generate transaction ID
      const transactionId = `txn_${crypto.randomBytes(16).toString('hex')}`;
      session.transaction_id = transactionId;
      
      // Store in database
      // TODO: Add to transactions table
      
      res.status(200).json({
        session_id: sessionId,
        transaction_id: transactionId,
        status: 'pending',
        blockchain_hash: tx.hash,
        estimated_confirmation: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        esg_validation: {
          passed: true,
          score: esgValidation.score
        }
      });
      
      // Send webhook to partner
      const webhookUrl = session.metadata?.webhook_url || req.user.webhook_url;
      if (webhookUrl) {
        await sendWebhook(webhookUrl, req.user.webhook_secret, 'payment.created', {
          session_id: sessionId,
          transaction_id: transactionId,
          amount: session.amount,
          recipient: session.recipient,
          status: 'pending'
        });
      }
      
      // Wait for confirmation in background
      tx.wait().then(async (receipt) => {
        session.status = 'completed';
        
        // Send confirmation webhook
        if (webhookUrl) {
          await sendWebhook(webhookUrl, req.user.webhook_secret, 'payment.completed', {
            session_id: sessionId,
            transaction_id: transactionId,
            blockchain_hash: receipt.hash,
            confirmations: receipt.confirmations
          });
        }
        
        // Clean up session after 1 hour
        setTimeout(() => {
          sessionStore.delete(sessionId);
        }, 60 * 60 * 1000);
      }).catch(error => {
        session.status = 'failed';
        console.error('Transaction confirmation failed:', error);
      });
      
    } catch (error) {
      session.status = 'failed';
      console.error('Payment execution error:', error);
      
      res.status(500).json({
        error: {
          code: 'execution_failed',
          message: 'Payment execution failed',
          details: error.message
        }
      });
    }
  }
);

// ============================================================================
// POST /v1/partners/authorize
// Generate partner API key for new treasury system
// ============================================================================

app.post('/v1/partners/authorize',
  // Admin authentication required
  authenticateAdmin,
  [
    body('partner_name').notEmpty(),
    body('partner_type').isIn(['mercury', 'kyriba', 'ramp', 'custom']),
    body('webhook_url').isURL(),
    body('email').isEmail()
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Generate partner API key
      const apiKey = `pk_live_${crypto.randomBytes(32).toString('hex')}`;
      const apiSecret = crypto.randomBytes(32).toString('hex');
      const webhookSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;
      
      // Hash secrets before storing
      const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const apiSecretHash = crypto.createHash('sha256').update(apiSecret).digest('hex');
      const webhookSecretHash = crypto.createHash('sha256').update(webhookSecret).digest('hex');
      
      // Store in database
      // TODO: Insert into partners table
      
      res.status(201).json({
        partner_name: req.body.partner_name,
        partner_type: req.body.partner_type,
        api_key: apiKey,
        api_secret: apiSecret,
        webhook_secret: webhookSecret,
        webhook_url: req.body.webhook_url,
        created_at: new Date().toISOString(),
        documentation_url: 'https://docs.dpx.io/partners/integration',
        test_mode: false
      });
      
      // Send welcome email with credentials
      await sendPartnerWelcomeEmail({
        email: req.body.email,
        partner_name: req.body.partner_name,
        api_key: apiKey,
        documentation_url: 'https://docs.dpx.io/partners/integration'
      });
      
    } catch (error) {
      console.error('Partner authorization error:', error);
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to authorize partner'
        }
      });
    }
  }
);

// ============================================================================
// POST /v1/analytics/track
// Track widget analytics events
// ============================================================================

app.post('/v1/analytics/track',
  authenticateApiKey,
  [
    body('event').notEmpty(),
    body('data').optional().isObject()
  ],
  async (req: Request, res: Response) => {
    // Simple analytics endpoint
    // TODO: Send to analytics service (Mixpanel, Segment, etc.)
    
    console.log('Analytics event:', {
      partner: req.user.organization_name,
      event: req.body.event,
      data: req.body.data,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({ received: true });
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function sendPartnerWelcomeEmail(details: {
  email: string;
  partner_name: string;
  api_key: string;
  documentation_url: string;
}) {
  // TODO: Implement email sending
  console.log('Welcome email sent to:', details.email);
}

async function logAudit(audit: {
  organization_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: any;
}) {
  // TODO: Insert into audit_logs table
  console.log('Audit log:', audit);
}

function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  // TODO: Implement admin authentication
  // For now, check for admin API key
  const adminKey = req.headers['x-admin-key'];
  
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({
      error: {
        code: 'forbidden',
        message: 'Admin access required'
      }
    });
  }
  
  next();
}

// ============================================================================
// CLEANUP JOB - Remove expired sessions
// ============================================================================

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.expires_at.getTime() < now) {
      sessionStore.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes
