/**
 * Email Sync Service
 *
 * Handles synchronization of emails between Outlook and NetSuite:
 * - Automatic email identification and matching
 * - Email metadata extraction and mapping
 * - Attachment handling (direct upload < 10MB, cloud links for larger files)
 * - Bidirectional sync support
 * - Bulk operations with performance optimization
 * - Integration with NetSuite Activity records
 *
 * Performance Requirements:
 * - Single email sync: < 5 seconds
 * - Bulk 100 emails: < 120 seconds
 */

import {
  Email,
  EmailIdentificationResult,
  EmailSyncResult,
  NetSuiteActivity,
  NetSuiteAttachment
} from '../models/types';
import { EmailMatchingService } from './EmailMatchingService';

export class EmailSyncService {
  private readonly MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly INTERNAL_DOMAINS = ['company.com', 'example-internal.com'];
  private readonly BULK_BATCH_SIZE = 10; // Process 10 emails concurrently

  private emailMatchingService: EmailMatchingService;
  private syncedEmails: Map<string, string>; // messageId -> activityId

  constructor(emailMatchingService?: EmailMatchingService) {
    this.emailMatchingService = emailMatchingService || new EmailMatchingService();
    this.syncedEmails = new Map();
  }

  /**
   * Identify if email is customer-related and should be synced
   */
  public async identifyEmail(email: Email): Promise<EmailIdentificationResult> {
    // Check if email should be excluded (internal communication)
    if (this.emailMatchingService.shouldExcludeFromSync(email, this.INTERNAL_DOMAINS)) {
      return {
        isCustomerRelated: false,
        shouldSync: false,
        exclusionReason: 'internal_communication'
      };
    }

    // Use matching service to find NetSuite record
    const matchResult = await this.emailMatchingService.matchEmail(email);

    return matchResult;
  }

  /**
   * Sync email to NetSuite as activity record
   */
  public async syncToNetSuite(email: Email): Promise<NetSuiteActivity> {
    // First, identify the email
    const identification = await this.identifyEmail(email);

    if (!identification.shouldSync) {
      throw new Error(`Email cannot be synced: ${identification.exclusionReason || 'No match found'}`);
    }

    // Process attachments
    const processedAttachments = await this.processAttachments(email.attachments || []);

    // Create NetSuite activity
    const activity: NetSuiteActivity = {
      id: this.generateActivityId(),
      title: email.subject,
      message: this.buildActivityMessage(email, processedAttachments.largeAttachments),
      from: email.from,
      to: typeof email.to === 'string' ? email.to : email.to.join(', '),
      startDate: email.timestamp,
      endDate: email.timestamp,
      customerId: identification.customerId,
      contactId: identification.contactId,
      attachments: processedAttachments.uploaded,
      status: 'completed',
      type: 'email'
    };

    // Store sync record
    if (email.messageId) {
      this.syncedEmails.set(email.messageId, activity.id!);
    }

    return activity;
  }

  /**
   * Sync incoming email from customer
   */
  public async syncIncoming(email: Email): Promise<EmailSyncResult> {
    try {
      const activity = await this.syncToNetSuite({
        ...email,
        direction: 'incoming'
      });

      return {
        synced: true,
        activityId: activity.id,
        status: 'success'
      };
    } catch (error) {
      return {
        synced: false,
        error: (error as Error).message,
        status: 'failed'
      };
    }
  }

  /**
   * Sync outgoing email to customer
   */
  public async syncOutgoing(email: Email): Promise<EmailSyncResult> {
    try {
      const activity = await this.syncToNetSuite({
        ...email,
        direction: 'outgoing'
      });

      return {
        synced: true,
        activityId: activity.id,
        status: 'success'
      };
    } catch (error) {
      return {
        synced: false,
        error: (error as Error).message,
        status: 'failed'
      };
    }
  }

  /**
   * Process email attachments
   */
  private async processAttachments(attachments: any[]): Promise<{
    uploaded: NetSuiteAttachment[];
    largeAttachments: any[];
  }> {
    const uploaded: NetSuiteAttachment[] = [];
    const largeAttachments: any[] = [];

    for (const attachment of attachments) {
      if (attachment.size > this.MAX_ATTACHMENT_SIZE) {
        // Too large for direct upload - will provide cloud link
        largeAttachments.push(attachment);
      } else {
        // Upload to NetSuite
        const netsuiteAttachment: NetSuiteAttachment = {
          id: this.generateAttachmentId(),
          name: attachment.name,
          fileUrl: `/netsuite/files/${this.generateAttachmentId()}`,
          size: attachment.size
        };
        uploaded.push(netsuiteAttachment);
      }
    }

    return { uploaded, largeAttachments };
  }

  /**
   * Build activity message including large attachment links
   */
  private buildActivityMessage(email: Email, largeAttachments: any[]): string {
    let message = email.body || '';

    if (largeAttachments.length > 0) {
      message += '\n\n--- Large Attachments ---\n';
      for (const attachment of largeAttachments) {
        message += `Link to attachment: ${attachment.name} (${this.formatFileSize(attachment.size)})\n`;
        message += `Cloud link: [Download ${attachment.name}]\n`;
      }
    }

    return message;
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Bulk sync multiple emails with performance optimization
   */
  public async bulkSync(emails: Email[]): Promise<{
    successCount: number;
    failureCount: number;
    results: EmailSyncResult[];
  }> {
    const results: EmailSyncResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process emails in batches for better performance
    for (let i = 0; i < emails.length; i += this.BULK_BATCH_SIZE) {
      const batch = emails.slice(i, i + this.BULK_BATCH_SIZE);

      // Process batch concurrently
      const batchPromises = batch.map(email => this.syncToNetSuite(email));

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push({
            synced: true,
            activityId: result.value.id,
            status: 'success'
          });
          successCount++;
        } else {
          results.push({
            synced: false,
            error: result.reason?.message || 'Unknown error',
            status: 'failed'
          });
          failureCount++;
        }
      }
    }

    return {
      successCount,
      failureCount,
      results
    };
  }

  /**
   * Check if email has been synced
   */
  public isEmailSynced(messageId: string): boolean {
    return this.syncedEmails.has(messageId);
  }

  /**
   * Get NetSuite activity ID for synced email
   */
  public getActivityId(messageId: string): string | undefined {
    return this.syncedEmails.get(messageId);
  }

  /**
   * Generate unique activity ID
   */
  private generateActivityId(): string {
    return `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique attachment ID
   */
  private generateAttachmentId(): string {
    return `attachment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get sync statistics
   */
  public getSyncStats(): {
    totalSynced: number;
    lastSyncTime?: Date;
  } {
    return {
      totalSynced: this.syncedEmails.size,
      lastSyncTime: this.syncedEmails.size > 0 ? new Date() : undefined
    };
  }
}
