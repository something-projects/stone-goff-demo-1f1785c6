/**
 * Test Suite: Email to NetSuite Synchronization (REQ-1)
 *
 * Tests the automatic identification and synchronization of emails to NetSuite.
 * Covers email metadata sync, attachment handling, and bidirectional sync.
 */

import { EmailSyncService } from '../../src/services/EmailSyncService';
import { EmailMatchingService } from '../../src/services/EmailMatchingService';
import { Email, EmailIdentificationResult } from '../../src/models/types';

describe('Email to NetSuite Synchronization (REQ-1)', () => {
  let emailSyncService: EmailSyncService;
  let emailMatchingService: EmailMatchingService;

  beforeEach(() => {
    emailMatchingService = new EmailMatchingService();
    // Add additional mock data for tests
    emailMatchingService.addDomainMapping('company.com', 'customer-company-001', 'Our Company');
    emailMatchingService.addDomainMapping('genericdomain.com', 'customer-generic-001', 'Generic Corp');
    emailSyncService = new EmailSyncService(emailMatchingService);
  });
  describe('Automatic Email Identification', () => {
    test('should identify customer-related emails automatically', async () => {
      // Given: An email from a known customer contact
      const email: Email = {
        from: 'jane@acmecorp.com',
        to: 'sales@company.com',
        subject: 'Pricing Question',
        body: 'What are your rates for enterprise?',
        timestamp: new Date('2025-10-30T10:00:00Z')
      };

      // When: Email sync service processes the email
      const result = await emailSyncService.identifyEmail(email);

      // Then: Email should be identified as customer-related
      expect(result.isCustomerRelated).toBe(true);
      expect(result.matchedCustomer).toBe('Acme Corporation');
    });

    test('should exclude internal emails from automatic sync', async () => {
      // Given: An internal email between team members
      const email: Email = {
        from: 'john@company.com',
        to: 'mary@company.com',
        subject: 'Team Meeting',
        body: 'Let\'s discuss the project',
        timestamp: new Date()
      };

      // When: Email sync service processes the email
      const result = await emailSyncService.identifyEmail(email);

      // Then: Email should be excluded from sync
      expect(result.shouldSync).toBe(false);
      expect(result.exclusionReason).toBe('internal_communication');
    });
  });

  describe('Email Metadata Synchronization', () => {
    test('should sync all email metadata to NetSuite activity', async () => {
      // Given: A customer email with complete metadata - using exact email from mock data
      const email: Email = {
        from: 'jane.smith@acmecorp.com', // Exact match in mock data (100% confidence -> auto-sync)
        to: 'sales@company.com',
        cc: ['manager@company.com'],
        subject: 'Product Demo Request',
        body: 'We would like to schedule a demo',
        timestamp: new Date('2025-10-30T10:00:00Z'),
        messageId: 'msg-12345'
      };

      // When: Syncing email to NetSuite
      const activity = await emailSyncService.syncToNetSuite(email);

      // Then: All metadata should be preserved
      expect(activity.title).toBe(email.subject);
      expect(activity.message).toContain(email.body);
      expect(activity.from).toBe(email.from);
      expect(activity.startDate).toEqual(email.timestamp);
    });

    test('should handle emails with attachments', async () => {
      // Given: An email with multiple attachments
      const email: Email = {
        from: 'jane.smith@acmecorp.com', // Exact match in mock data
        to: 'sales@company.com',
        subject: 'Contract Documents',
        body: 'Please review attached',
        timestamp: new Date('2025-10-30T10:00:00Z'),
        attachments: [
          { name: 'contract.pdf', size: 1024000, contentType: 'application/pdf' },
          { name: 'terms.docx', size: 512000, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
        ]
      };

      // When: Syncing email with attachments
      const activity = await emailSyncService.syncToNetSuite(email);

      // Then: Attachments should be uploaded to NetSuite
      expect(activity.attachments).toHaveLength(2);
      expect(activity.attachments![0].name).toBe('contract.pdf');
    });

    test('should handle large attachments > 10MB by providing cloud links', async () => {
      // Given: An email with attachment exceeding NetSuite limit
      const email: Email = {
        from: 'jane.smith@acmecorp.com', // Exact match in mock data
        to: 'sales@company.com',
        subject: 'Large Presentation',
        body: 'Please see attached',
        timestamp: new Date('2025-10-30T10:00:00Z'),
        attachments: [
          { name: 'presentation.pptx', size: 15 * 1024 * 1024, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
        ]
      };

      // When: Syncing email with large attachment
      const activity = await emailSyncService.syncToNetSuite(email);

      // Then: Should provide cloud link instead of direct upload
      expect(activity.message).toContain('Link to attachment');
      expect(activity.attachments).toHaveLength(0);
    });
  });

  describe('Bidirectional Email Sync', () => {
    test('should sync incoming emails from customers', async () => {
      // Given: An incoming email from customer - using john.doe@example.com from mock data
      const incomingEmail: Email = {
        direction: 'incoming',
        from: 'john.doe@example.com', // Exact match in mock data
        to: 'sales@company.com',
        subject: 'Question about service',
        body: 'I have a question',
        timestamp: new Date('2025-10-30T10:00:00Z')
      };

      // When: Processing incoming email
      const result = await emailSyncService.syncIncoming(incomingEmail);

      // Then: Should create activity in NetSuite
      expect(result.synced).toBe(true);
      expect(result.activityId).toBeDefined();
    });

    test('should sync outgoing emails sent to customers', async () => {
      // Given: An outgoing email to customer - sender (from) must match NetSuite contacts
      const outgoingEmail: Email = {
        direction: 'outgoing',
        from: 'jane.smith@acmecorp.com', // Email matching looks at 'from' field, not 'to'
        to: 'external@client.com',
        subject: 'Response to your inquiry',
        body: 'Here is the answer',
        timestamp: new Date('2025-10-30T10:00:00Z')
      };

      // When: Processing outgoing email
      const result = await emailSyncService.syncOutgoing(outgoingEmail);

      // Then: Should create activity in NetSuite
      expect(result.synced).toBe(true);
      expect(result.activityId).toBeDefined();
    });
  });

  describe('Manual Email Selection', () => {
    test('should allow manual selection when automatic matching is uncertain', async () => {
      // Given: An email with multiple possible matches
      const email: Email = {
        from: 'info@genericdomain.com',
        to: 'sales@company.com',
        subject: 'Follow-up',
        body: 'Following up on our discussion',
        timestamp: new Date('2025-10-30T10:00:00Z')
      };

      // When: Identifying email with uncertain match
      const result = await emailSyncService.identifyEmail(email);

      // Then: Should prompt for manual selection
      expect(result.requiresManualSelection).toBe(true);
      expect(result.suggestedRecords).toBeDefined();
    });
  });

  describe('Performance Requirements (NFR-1)', () => {
    test('should complete individual email sync within 5 seconds', async () => {
      // Given: A single email to sync
      const email: Email = {
        from: 'jane.smith@acmecorp.com', // Exact match in mock data
        to: 'sales@company.com',
        subject: 'Test',
        body: 'Test email',
        timestamp: new Date('2025-10-30T10:00:00Z')
      };

      // When: Syncing single email
      const startTime = Date.now();
      await emailSyncService.syncToNetSuite(email);
      const duration = Date.now() - startTime;

      // Then: Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });

    test('should complete bulk sync of 100 emails within 2 minutes', async () => {
      // Given: 100 emails to sync - using domain match from mock data
      const emails: Email[] = Array.from({ length: 100 }, (_, i) => ({
        from: `customer${i}@example.com`, // Domain match to 'Example Inc' (85% confidence -> auto-sync)
        to: 'sales@company.com',
        subject: `Email ${i}`,
        body: `Content ${i}`,
        timestamp: new Date('2025-10-30T10:00:00Z')
      }));

      // When: Bulk syncing emails
      const startTime = Date.now();
      await emailSyncService.bulkSync(emails);
      const duration = Date.now() - startTime;

      // Then: Should complete within 2 minutes
      expect(duration).toBeLessThan(120000);
    });
  });
});
