/**
 * Type Definitions for Outlook to NetSuite Integration
 *
 * Defines all core types, interfaces, and enums used throughout the application
 */

// ==================== Email Types ====================

export interface Email {
  from: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  timestamp: Date;
  messageId?: string;
  direction?: 'incoming' | 'outgoing';
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  name: string;
  size: number;
  contentType: string;
  data?: Buffer | string;
  url?: string;
}

export interface EmailIdentificationResult {
  isCustomerRelated: boolean;
  shouldSync: boolean;
  matchedCustomer?: string;
  matchedContact?: string;
  customerId?: string;
  contactId?: string;
  confidence?: number;
  exclusionReason?: string;
  requiresManualSelection?: boolean;
  suggestedRecords?: NetSuiteRecord[];
}

export interface EmailSyncResult {
  synced: boolean;
  activityId?: string;
  error?: string;
  status: 'success' | 'failed' | 'pending';
}

// ==================== Contact Types ====================

export interface Contact {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  mobile?: string;
  company?: string;
  title?: string;
  address?: Address;
  customerId?: string;
  lastModified?: Date;
  syncStatus?: SyncStatus;
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

export interface ContactSyncResult {
  success: boolean;
  contactId?: string;
  conflict?: ConflictInfo;
  error?: string;
}

// ==================== Calendar Types ====================

export interface CalendarEvent {
  id?: string;
  subject: string;
  body?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  attendees?: Attendee[];
  organizer?: string;
  timezone?: string;
  isRecurring?: boolean;
  recurrencePattern?: RecurrencePattern;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  cancellationReason?: string;
}

export interface Attendee {
  email: string;
  name?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'none';
  contactId?: string;
}

export interface RecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  endDate?: Date;
  occurrences?: number;
}

// ==================== NetSuite Types ====================

export interface NetSuiteRecord {
  id: string;
  type: 'customer' | 'contact' | 'lead' | 'opportunity' | 'case';
  name: string;
  email?: string;
  domain?: string;
  additionalInfo?: Record<string, any>;
}

export interface NetSuiteActivity {
  id?: string;
  title: string;
  message: string;
  from?: string;
  to?: string;
  startDate: Date;
  endDate?: Date;
  customerId?: string;
  contactId?: string;
  opportunityId?: string;
  caseId?: string;
  attachments?: NetSuiteAttachment[];
  status?: string;
  type: 'email' | 'call' | 'meeting' | 'task';
}

export interface NetSuiteAttachment {
  id?: string;
  name: string;
  fileUrl?: string;
  size?: number;
}

export interface NetSuiteContact {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  customerId?: string;
  title?: string;
  isInactive?: boolean;
  lastModifiedDate?: Date;
}

export interface NetSuiteCustomer {
  id?: string;
  companyName: string;
  email?: string;
  domain?: string;
  isInactive?: boolean;
}

// ==================== Authentication Types ====================

export interface OAuth2Token {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  tokenType: string;
}

export interface EncryptedToken {
  encryptedData: string;
  iv: string;
  tenantId: string;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  responseType: 'code';
}

export interface TokenRefreshResult {
  success: boolean;
  token?: OAuth2Token;
  error?: string;
}

// ==================== Matching Types ====================

export interface MatchingRule {
  id: string;
  name: string;
  type: 'email' | 'domain' | 'keyword';
  pattern: string;
  targetRecordId: string;
  targetRecordType: 'customer' | 'contact';
  priority: number;
  isActive: boolean;
}

export interface MatchResult {
  recordId: string;
  recordType: 'customer' | 'contact' | 'lead';
  recordName: string;
  confidence: number;
  matchReason: string;
  matchedBy: 'exact_email' | 'domain' | 'keyword' | 'custom_rule';
}

export interface DomainMapping {
  domain: string;
  customerId: string;
  customerName: string;
  isGeneric: boolean;
}

// ==================== Conflict Resolution Types ====================

export interface ConflictInfo {
  field: string;
  outlookValue: any;
  netsuiteValue: any;
  outlookLastModified: Date;
  netsuiteLastModified: Date;
  resolution?: 'outlook_wins' | 'netsuite_wins' | 'manual_required';
}

export interface ConflictResolution {
  strategy: 'last_write_wins' | 'manual' | 'outlook_priority' | 'netsuite_priority';
  resolvedValue?: any;
  requiresUserInput: boolean;
}

// ==================== Sync Status Types ====================

export interface SyncStatus {
  lastSyncDate?: Date;
  lastSyncDirection?: 'outlook_to_netsuite' | 'netsuite_to_outlook';
  status: 'synced' | 'pending' | 'failed' | 'conflict';
  error?: string;
}

export interface SyncOperation {
  id: string;
  type: 'email' | 'contact' | 'calendar';
  direction: 'outlook_to_netsuite' | 'netsuite_to_outlook';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  recordId: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

// ==================== RBAC Types ====================

export interface UserRole {
  userId: string;
  role: 'admin' | 'sales_rep' | 'service_rep' | 'manager';
  permissions: Permission[];
}

export interface Permission {
  resource: 'email' | 'contact' | 'calendar' | 'customer' | 'financial';
  action: 'read' | 'write' | 'delete';
  granted: boolean;
}

// ==================== Audit Types ====================

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: Date;
  ipAddress?: string;
  success: boolean;
  details?: Record<string, any>;
}

// ==================== Configuration Types ====================

export interface IntegrationConfig {
  microsoft: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    scopes: string[];
  };
  netsuite: {
    accountId: string;
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  };
  sync: {
    emailSyncEnabled: boolean;
    contactSyncEnabled: boolean;
    calendarSyncEnabled: boolean;
    syncInterval: number; // minutes
    batchSize: number;
  };
  matching: {
    autoLinkThreshold: number; // 0-100
    genericDomains: string[];
  };
}

// ==================== Queue Types ====================

export interface QueueMessage {
  id: string;
  type: 'sync_email' | 'sync_contact' | 'sync_calendar' | 'retry_operation';
  payload: any;
  priority: 'high' | 'normal' | 'low';
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
}

// ==================== GDPR Types ====================

export interface DataExportRequest {
  userId: string;
  requestedAt: Date;
  format: 'json' | 'csv';
  status: 'pending' | 'completed' | 'failed';
}

export interface DataDeletionRequest {
  userId: string;
  requestedAt: Date;
  status: 'pending' | 'completed' | 'failed';
  deletionScope: 'all' | 'sync_data' | 'audit_logs';
}
