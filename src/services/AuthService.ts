/**
 * Authentication Service
 *
 * Handles OAuth 2.0 authentication for both Microsoft 365 and NetSuite,
 * secure token management with AES-256 encryption, automatic token refresh,
 * role-based access control (RBAC), audit logging, and GDPR compliance.
 *
 * Design Spec: OAuth 2.0 with short-lived access tokens (1 hour) and secure refresh token storage.
 * Tokens encrypted at rest using AES-256. Proactive token refresh 5 minutes before expiration.
 */

import * as crypto from 'crypto';
import {
  OAuth2Token,
  EncryptedToken,
  AuthorizationRequest,
  TokenRefreshResult,
  UserRole,
  Permission,
  AuditLog,
  DataExportRequest,
  DataDeletionRequest
} from '../models/types';

export class AuthService {
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private readonly TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  private readonly ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
  private readonly REFRESH_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
  private readonly MAX_LOGIN_ATTEMPTS = 5;

  private encryptionKey: Buffer;
  private tokenStore: Map<string, OAuth2Token>; // In-memory store for demo; use database in production
  private loginAttempts: Map<string, number>;
  private auditLogs: AuditLog[];

  constructor(encryptionKey?: string) {
    // Generate or use provided encryption key
    this.encryptionKey = encryptionKey
      ? Buffer.from(encryptionKey, 'hex')
      : crypto.randomBytes(32);

    this.tokenStore = new Map();
    this.loginAttempts = new Map();
    this.auditLogs = [];
  }

  /**
   * Initiate OAuth 2.0 flow for Microsoft 365
   */
  public initiateMicrosoftOAuth(scopes: string[]): string {
    const authRequest: AuthorizationRequest = {
      clientId: process.env.MICROSOFT_CLIENT_ID || 'mock-client-id',
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/callback',
      scope: scopes.join(' '),
      state: crypto.randomBytes(16).toString('hex'),
      responseType: 'code'
    };

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: authRequest.clientId,
      redirect_uri: authRequest.redirectUri,
      scope: authRequest.scope,
      state: authRequest.state,
      response_type: authRequest.responseType
    });

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Initiate OAuth 2.0 flow for NetSuite
   */
  public initiateNetSuiteOAuth(accountId: string): string {
    const authRequest: AuthorizationRequest = {
      clientId: process.env.NETSUITE_CLIENT_ID || 'mock-netsuite-client-id',
      redirectUri: process.env.NETSUITE_REDIRECT_URI || 'http://localhost:3000/netsuite/callback',
      scope: 'restlets rest_webservices',
      state: crypto.randomBytes(16).toString('hex'),
      responseType: 'code'
    };

    const params = new URLSearchParams({
      response_type: authRequest.responseType,
      client_id: authRequest.clientId,
      redirect_uri: authRequest.redirectUri,
      scope: authRequest.scope,
      state: authRequest.state
    });

    return `https://${accountId}.app.netsuite.com/app/login/oauth2/authorize.nl?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  public async exchangeCodeForTokens(
    code: string,
    provider: 'microsoft' | 'netsuite',
    userId: string
  ): Promise<OAuth2Token> {
    // Mock token exchange - in production, call actual OAuth provider
    const now = new Date();
    const token: OAuth2Token = {
      accessToken: `mock-access-token-${code}`,
      refreshToken: `mock-refresh-token-${crypto.randomBytes(16).toString('hex')}`,
      expiresAt: new Date(now.getTime() + this.ACCESS_TOKEN_LIFETIME_MS),
      scope: provider === 'microsoft' ? 'Mail.Read Calendars.ReadWrite Contacts.ReadWrite' : 'restlets rest_webservices',
      tokenType: 'Bearer'
    };

    // Store token
    this.tokenStore.set(`${userId}:${provider}`, token);

    // Log authentication event
    this.logAuditEvent(userId, 'oauth_token_exchange', provider, true);

    return token;
  }

  /**
   * Encrypt token for secure storage
   */
  public encryptToken(token: OAuth2Token, tenantId: string): EncryptedToken {
    // Generate random IV for each encryption
    const iv = crypto.randomBytes(16);

    // Create cipher
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.encryptionKey, iv) as crypto.CipherGCM;

    // Encrypt token data
    const tokenData = JSON.stringify(token);
    let encrypted = cipher.update(tokenData, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag for GCM mode
    const authTag = cipher.getAuthTag();

    return {
      encryptedData: encrypted + ':' + authTag.toString('hex'), // Store encrypted data and auth tag together
      iv: iv.toString('hex'),
      tenantId
    };
  }

  /**
   * Decrypt token from secure storage
   */
  public decryptToken(encryptedToken: EncryptedToken): OAuth2Token {
    // Split encrypted data and auth tag
    const [encryptedData, authTagHex] = encryptedToken.encryptedData.split(':');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Create decipher
    const iv = Buffer.from(encryptedToken.iv, 'hex');
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.encryptionKey, iv) as crypto.DecipherGCM;

    // Set authentication tag for GCM mode
    decipher.setAuthTag(authTag);

    // Decrypt token data
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

  /**
   * Check if token needs refresh (within 5 minutes of expiration)
   */
  public shouldRefreshToken(token: OAuth2Token): boolean {
    const now = new Date();
    const timeUntilExpiry = token.expiresAt.getTime() - now.getTime();
    return timeUntilExpiry <= this.TOKEN_REFRESH_THRESHOLD_MS;
  }

  /**
   * Refresh expired or expiring access token
   */
  public async refreshAccessToken(
    refreshToken: string,
    provider: 'microsoft' | 'netsuite',
    userId: string
  ): Promise<TokenRefreshResult> {
    try {
      // Mock token refresh - in production, call actual OAuth provider
      const now = new Date();
      const newToken: OAuth2Token = {
        accessToken: `refreshed-access-token-${crypto.randomBytes(16).toString('hex')}`,
        refreshToken, // Typically refresh token stays the same or is rotated
        expiresAt: new Date(now.getTime() + this.ACCESS_TOKEN_LIFETIME_MS),
        scope: provider === 'microsoft' ? 'Mail.Read Calendars.ReadWrite Contacts.ReadWrite' : 'restlets rest_webservices',
        tokenType: 'Bearer'
      };

      // Update token store
      this.tokenStore.set(`${userId}:${provider}`, newToken);

      // Log refresh event
      this.logAuditEvent(userId, 'token_refresh', provider, true);

      return {
        success: true,
        token: newToken
      };
    } catch (error) {
      this.logAuditEvent(userId, 'token_refresh', provider, false, { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Proactively refresh token if expiring soon
   */
  public async proactiveTokenRefresh(
    userId: string,
    provider: 'microsoft' | 'netsuite'
  ): Promise<OAuth2Token | null> {
    const token = this.tokenStore.get(`${userId}:${provider}`);

    if (!token) {
      return null;
    }

    if (this.shouldRefreshToken(token)) {
      const result = await this.refreshAccessToken(token.refreshToken, provider, userId);
      return result.success ? result.token! : null;
    }

    return token;
  }

  /**
   * Get valid access token (refresh if needed)
   */
  public async getAccessToken(
    userId: string,
    provider: 'microsoft' | 'netsuite'
  ): Promise<string | null> {
    const token = await this.proactiveTokenRefresh(userId, provider);
    return token ? token.accessToken : null;
  }

  /**
   * Enforce role-based access control
   */
  public hasPermission(userRole: UserRole, resource: string, action: string): boolean {
    const permission = userRole.permissions.find(
      p => p.resource === resource && p.action === action
    );

    return permission?.granted || false;
  }

  /**
   * Check permissions and throw if access denied
   */
  public enforcePermission(userRole: UserRole, resource: string, action: string): void {
    if (!this.hasPermission(userRole, resource, action)) {
      throw new Error(`Access denied: insufficient permissions for ${action} on ${resource}`);
    }
  }

  /**
   * Track failed login attempts and lock account if threshold exceeded
   */
  public recordLoginAttempt(userId: string, success: boolean, ipAddress?: string): boolean {
    if (success) {
      // Reset attempts on successful login
      this.loginAttempts.set(userId, 0);
      this.logAuditEvent(userId, 'login_success', 'auth', true, { ipAddress });
      return true;
    }

    // Increment failed attempts
    const attempts = (this.loginAttempts.get(userId) || 0) + 1;
    this.loginAttempts.set(userId, attempts);
    this.logAuditEvent(userId, 'login_failed', 'auth', false, { ipAddress, attempts });

    // Check if account should be locked
    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      this.logAuditEvent(userId, 'account_locked', 'auth', false, { ipAddress, attempts });
      return false;
    }

    return true;
  }

  /**
   * Check if account is locked due to failed login attempts
   */
  public isAccountLocked(userId: string): boolean {
    const attempts = this.loginAttempts.get(userId) || 0;
    return attempts >= this.MAX_LOGIN_ATTEMPTS;
  }

  /**
   * Log audit event
   */
  private logAuditEvent(
    userId: string,
    action: string,
    resource: string,
    success: boolean,
    details?: Record<string, any>
  ): void {
    const auditLog: AuditLog = {
      id: crypto.randomBytes(16).toString('hex'),
      userId,
      action,
      resource,
      timestamp: new Date(),
      success,
      details,
      ipAddress: details?.ipAddress
    };

    this.auditLogs.push(auditLog);
  }

  /**
   * Get audit logs for user (GDPR compliance)
   */
  public getAuditLogs(userId: string): AuditLog[] {
    return this.auditLogs.filter(log => log.userId === userId);
  }

  /**
   * GDPR: Export user data in portable format
   */
  public async exportUserData(userId: string, format: 'json' | 'csv'): Promise<any> {
    const auditLogs = this.getAuditLogs(userId);
    const tokens = Array.from(this.tokenStore.entries())
      .filter(([key]) => key.startsWith(userId))
      .map(([key, token]) => ({
        provider: key.split(':')[1],
        expiresAt: token.expiresAt,
        scope: token.scope
      }));

    const exportData = {
      userId,
      auditLogs,
      tokens,
      exportedAt: new Date().toISOString()
    };

    if (format === 'json') {
      return exportData;
    }

    // For CSV format, flatten the data
    return {
      ...exportData,
      format: 'csv',
      note: 'CSV conversion would be implemented here'
    };
  }

  /**
   * GDPR: Delete user data (right to be forgotten)
   */
  public async deleteUserData(userId: string, scope: 'all' | 'sync_data' | 'audit_logs'): Promise<void> {
    if (scope === 'all' || scope === 'audit_logs') {
      // Remove audit logs
      this.auditLogs = this.auditLogs.filter(log => log.userId !== userId);
    }

    if (scope === 'all' || scope === 'sync_data') {
      // Remove tokens
      const keysToDelete = Array.from(this.tokenStore.keys()).filter(key => key.startsWith(userId));
      keysToDelete.forEach(key => this.tokenStore.delete(key));

      // Remove login attempts
      this.loginAttempts.delete(userId);
    }

    // Log deletion event before removing (if keeping audit logs)
    if (scope !== 'audit_logs' && scope !== 'all') {
      this.logAuditEvent(userId, 'data_deletion', 'gdpr', true, { scope });
    }
  }

  /**
   * Get current token for testing purposes
   */
  public getTokenForTesting(userId: string, provider: 'microsoft' | 'netsuite'): OAuth2Token | undefined {
    return this.tokenStore.get(`${userId}:${provider}`);
  }
}
