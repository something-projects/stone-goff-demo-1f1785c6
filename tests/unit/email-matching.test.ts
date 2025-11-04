/**
 * Test Suite: Smart Email Matching (REQ-2)
 *
 * Tests the automatic matching of emails to NetSuite records based on
 * email addresses, domains, keywords, and custom rules.
 */

import { EmailMatchingService } from '../../src/services/EmailMatchingService';
import { Email } from '../../src/models/types';

describe('Smart Email Matching (REQ-2)', () => {
  let emailMatchingService: EmailMatchingService;

  beforeEach(() => {
    emailMatchingService = new EmailMatchingService();
  });

  describe('Email Address Matching', () => {
    test('should match email to NetSuite contact by exact email address', async () => {
      // Given: An email from a known contact in NetSuite
      const email: Email = {
        from: 'jane.smith@acmecorp.com',
        to: 'sales@company.com',
        subject: 'Product inquiry',
        body: 'I would like more information',
        timestamp: new Date()
      };

      // When: Matching email to NetSuite records
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should find exact contact match
      expect(result.isCustomerRelated).toBe(true);
      expect(result.confidence).toBe(100);
      expect(result.matchedCustomer).toBe('Jane Smith');
      expect(result.customerId).toBe('contact-12345');
    });

    test('should handle case-insensitive email matching', async () => {
      // Given: Email with different casing than stored in NetSuite
      const email: Email = {
        from: 'JANE.SMITH@ACMECORP.COM',
        to: 'sales@company.com',
        subject: 'Follow-up',
        body: '',
        timestamp: new Date()
      };

      // When: Matching email
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should match regardless of case
      expect(result.isCustomerRelated).toBe(true);
      expect(result.matchedCustomer).toBe('Jane Smith');
    });
  });

  describe('Domain-Based Matching', () => {
    test('should match emails by domain to customer organization', async () => {
      // Given: Email from new contact at known customer domain
      const email: Email = {
        from: 'newperson@acmecorp.com',
        to: 'sales@company.com',
        subject: 'New inquiry',
        body: '',
        timestamp: new Date()
      };

      // When: Matching by domain
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should match to Acme Corp customer
      expect(result.isCustomerRelated).toBe(true);
      expect(result.matchedCustomer).toBe('Acme Corporation');
      expect(result.confidence).toBe(85);
    });

    test('should not match generic email domains (gmail, yahoo, etc.)', async () => {
      // Given: Email from generic domain
      const email: Email = {
        from: 'someone@gmail.com',
        to: 'sales@company.com',
        subject: 'Inquiry',
        body: '',
        timestamp: new Date()
      };

      // When: Attempting domain match
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should not match by domain alone
      expect(result.isCustomerRelated).toBe(false);
      expect(result.shouldSync).toBe(false);
    });
  });

  describe('Keyword-Based Matching', () => {
    test('should match using opportunity or case numbers in subject', async () => {
      // Given: Email referencing specific opportunity number
      const email: Email = {
        from: 'partner@reseller.com',
        to: 'sales@company.com',
        subject: 'Regarding Opportunity #OP-45678',
        body: '',
        timestamp: new Date()
      };

      // When: Matching using reference numbers
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should match to specific opportunity
      expect(result.isCustomerRelated).toBe(true);
      expect(result.confidence).toBe(95);
    });
  });

  describe('Custom Matching Rules', () => {
    test('should support user-defined matching rules', async () => {
      // Given: Email matching custom rule for @partner.com
      const email: Email = {
        from: 'contact@partner.com',
        to: 'sales@company.com',
        subject: 'Partnership inquiry',
        body: '',
        timestamp: new Date()
      };

      // When: Matching with custom rules
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should apply custom rule
      expect(result.isCustomerRelated).toBe(true);
      expect(result.customerId).toBe('customer-partner-123');
      expect(result.confidence).toBe(90);
    });
  });

  describe('Exclusion Rules', () => {
    test('should exclude internal company emails', async () => {
      // Given: Email between internal addresses
      const email: Email = {
        from: 'john@company.com',
        to: 'mary@company.com',
        subject: 'Team meeting',
        body: '',
        timestamp: new Date()
      };

      // When: Checking if should sync
      const shouldExclude = emailMatchingService.shouldExcludeFromSync(email, ['company.com']);

      // Then: Should exclude
      expect(shouldExclude).toBe(true);
    });
  });

  describe('Matching Confidence Scores', () => {
    test('should auto-link when confidence > 90%', async () => {
      // Given: High confidence match (exact email)
      const email: Email = {
        from: 'jane.smith@acmecorp.com',
        to: 'sales@company.com',
        subject: 'Business inquiry',
        body: '',
        timestamp: new Date()
      };

      // When: Processing match
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should auto-link without user confirmation
      expect(result.shouldSync).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
      expect(result.requiresManualSelection).toBeUndefined();
    });

    test('should require user confirmation when confidence < 90%', async () => {
      // Given: Medium confidence match (domain only - 85%)
      const email: Email = {
        from: 'newcontact@acmecorp.com',
        to: 'sales@company.com',
        subject: 'General inquiry',
        body: '',
        timestamp: new Date()
      };

      // When: Processing match
      const result = await emailMatchingService.matchEmail(email);

      // Then: Should require manual selection (confidence = 85)
      expect(result.isCustomerRelated).toBe(true);
      expect(result.requiresManualSelection).toBe(true);
      expect(result.confidence).toBeLessThan(90);
    });
  });
});
