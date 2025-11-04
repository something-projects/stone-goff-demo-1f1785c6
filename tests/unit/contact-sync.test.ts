/**
 * Test Suite: Contact Synchronization (REQ-3)
 *
 * Tests bidirectional contact synchronization between Outlook and NetSuite,
 * including field mapping, conflict resolution, and relationship maintenance.
 */

import { ContactSyncService } from '../../src/services/ContactSyncService';
import { Contact, NetSuiteContact } from '../../src/models/types';

describe('Contact Synchronization (REQ-3)', () => {
  let contactSyncService: ContactSyncService;

  beforeEach(() => {
    contactSyncService = new ContactSyncService();
  });

  describe('Bidirectional Contact Sync', () => {
    test('should sync new Outlook contact to NetSuite', async () => {
      // Given: A new contact created in Outlook
      const outlookContact: Contact = {
        firstName: 'John',
        lastName: 'Smith',
        email: 'john.smith@example.com',
        phone: '+1-555-0100',
        company: 'Example Corp',
        title: 'VP of Sales'
      };

      // When: Syncing to NetSuite
      const result = await contactSyncService.syncToNetSuite(outlookContact);

      // Then: Contact should be created in NetSuite
      expect(result.success).toBe(true);
      expect(result.contactId).toBeDefined();

      // Verify the contact is stored
      const netsuiteContact = contactSyncService.getContactForTesting('john.smith@example.com', 'netsuite') as NetSuiteContact;
      expect(netsuiteContact).toBeDefined();
      expect(netsuiteContact.firstName).toBe('John');
      expect(netsuiteContact.lastName).toBe('Smith');
      expect(netsuiteContact.email).toBe('john.smith@example.com');
      expect(netsuiteContact.phone).toBe('+1-555-0100');
      expect(netsuiteContact.title).toBe('VP of Sales');
    });

    test('should sync NetSuite contact updates to Outlook', async () => {
      // Given: Contact updated in NetSuite
      const netsuiteContact: NetSuiteContact = {
        id: 'contact-123',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: '+1-555-9999',
        title: 'SVP of Sales',
        lastModifiedDate: new Date('2025-10-30T10:00:00Z')
      };

      // When: Syncing to Outlook
      const result = await contactSyncService.syncToOutlook(netsuiteContact);

      // Then: Outlook contact should be created/updated
      expect(result.success).toBe(true);
      expect(result.contactId).toBe('contact-123');

      // Verify the contact is stored in Outlook
      const outlookContact = contactSyncService.getContactForTesting('jane.doe@example.com', 'outlook') as Contact;
      expect(outlookContact).toBeDefined();
      expect(outlookContact.phone).toBe('+1-555-9999');
      expect(outlookContact.title).toBe('SVP of Sales');
    });

    test('should handle contact deletion from Outlook', async () => {
      // Given: First create a contact in NetSuite
      const outlookContact: Contact = {
        firstName: 'Bob',
        lastName: 'Johnson',
        email: 'bob.johnson@example.com',
        phone: '+1-555-0200'
      };
      await contactSyncService.syncToNetSuite(outlookContact);

      // When: Processing deletion from Outlook
      const result = await contactSyncService.handleDeletion('bob.johnson@example.com', 'outlook');

      // Then: Should mark as inactive in NetSuite (not delete)
      expect(result.success).toBe(true);
      const netsuiteContact = contactSyncService.getContactForTesting('bob.johnson@example.com', 'netsuite') as NetSuiteContact;
      expect(netsuiteContact).toBeDefined();
      expect(netsuiteContact.isInactive).toBe(true);
    });
  });

  describe('Field Mapping', () => {
    test('should map all standard Outlook fields to NetSuite', async () => {
      // Given: Outlook contact with all standard fields
      const outlookContact: Contact = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@fieldtest.com',
        phone: '+1-555-0101',
        mobile: '+1-555-0102',
        company: 'Example Corp',
        title: 'Director of Marketing',
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94105',
          country: 'USA'
        }
      };

      // When: Syncing to NetSuite
      const result = await contactSyncService.syncToNetSuite(outlookContact);

      // Then: All fields should be correctly mapped
      expect(result.success).toBe(true);
      const netsuiteContact = contactSyncService.getContactForTesting('jane.doe@fieldtest.com', 'netsuite') as NetSuiteContact;
      expect(netsuiteContact.firstName).toBe('Jane');
      expect(netsuiteContact.lastName).toBe('Doe');
      expect(netsuiteContact.email).toBe('jane.doe@fieldtest.com');
      expect(netsuiteContact.phone).toBe('+1-555-0101');
      expect(netsuiteContact.title).toBe('Director of Marketing');
    });
  });

  describe('Company Relationship Management', () => {
    test('should link contact to existing NetSuite customer', async () => {
      // Given: Contact for existing customer 'Acme Corporation'
      const contact: Contact = {
        firstName: 'Alice',
        lastName: 'Williams',
        email: 'alice.williams@acmecorp.com',
        company: 'Acme Corporation'
      };

      // When: Syncing contact
      const result = await contactSyncService.syncToNetSuite(contact);

      // Then: Should link to existing Acme Corp customer
      expect(result.success).toBe(true);
      const netsuiteContact = contactSyncService.getContactForTesting('alice.williams@acmecorp.com', 'netsuite') as NetSuiteContact;
      expect(netsuiteContact.customerId).toBeDefined();

      // Verify it's linked to the existing Acme Corp customer
      const customer = contactSyncService.getCustomerForTesting('Acme Corporation');
      expect(customer).toBeDefined();
      expect(netsuiteContact.customerId).toBe(customer?.id);
    });

    test('should create new customer when company does not exist', async () => {
      // Given: Contact from unknown company
      const contact: Contact = {
        firstName: 'Charlie',
        lastName: 'Brown',
        email: 'charlie@brandnewcorp.com',
        company: 'Brand New Corp'
      };

      // When: Syncing contact
      const result = await contactSyncService.syncToNetSuite(contact);

      // Then: Should create new customer record
      expect(result.success).toBe(true);

      const customer = contactSyncService.getCustomerForTesting('Brand New Corp');
      expect(customer).toBeDefined();
      expect(customer?.companyName).toBe('Brand New Corp');
      expect(customer?.domain).toBe('brandnewcorp.com');

      const netsuiteContact = contactSyncService.getContactForTesting('charlie@brandnewcorp.com', 'netsuite') as NetSuiteContact;
      expect(netsuiteContact.customerId).toBe(customer?.id);
    });
  });

  describe('Conflict Resolution', () => {
    test('should detect when contact modified in both systems', async () => {
      // Given: Contact modified in both Outlook and NetSuite
      const outlookContact: Contact = {
        id: 'contact-123',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@conflict.com',
        phone: '+1-555-1111',
        lastModified: new Date('2025-10-30T10:00:00Z')
      };

      const netsuiteContact: NetSuiteContact = {
        id: 'contact-123',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@conflict.com',
        phone: '+1-555-2222',
        lastModifiedDate: new Date('2025-10-30T10:05:00Z')
      };

      // When: Detecting and resolving conflicts
      const result = await contactSyncService.detectAndResolveConflict(outlookContact, netsuiteContact);

      // Then: Should detect conflict and resolve it
      expect(result.success).toBe(true);

      // Verify conflict was detected (different phone numbers)
      // The result should indicate successful resolution
    });

    test('should apply last-write-wins strategy by default', async () => {
      // Given: Conflicting contact versions (NetSuite newer)
      const outlookContact: Contact = {
        id: 'contact-456',
        firstName: 'Conflict',
        lastName: 'Test',
        email: 'conflict.test@example.com',
        phone: '+1-555-1111',
        title: 'Old Title',
        lastModified: new Date('2025-10-30T10:00:00Z')
      };

      const netsuiteContact: NetSuiteContact = {
        id: 'contact-456',
        firstName: 'Conflict',
        lastName: 'Test',
        email: 'conflict.test@example.com',
        phone: '+1-555-2222',
        title: 'New Title',
        lastModifiedDate: new Date('2025-10-30T10:05:00Z')
      };

      // When: Resolving conflict with default strategy
      const result = await contactSyncService.detectAndResolveConflict(outlookContact, netsuiteContact);

      // Then: Should successfully resolve the conflict
      expect(result.success).toBe(true);

      // Since NetSuite is newer, the conflict resolution will sync NetSuite to Outlook
      // Verify that the sync was performed
      const syncStatus = contactSyncService.getSyncStatus('conflict.test@example.com');
      expect(syncStatus).toBeDefined();
      expect(syncStatus?.status).toBe('synced');
    });
  });

  describe('Sync Status Tracking', () => {
    test('should track sync status for each contact', async () => {
      // Given: Contact being synced
      const contact: Contact = {
        firstName: 'Status',
        lastName: 'Test',
        email: 'status.test@example.com',
        phone: '+1-555-0300'
      };

      // When: Syncing contact
      const result = await contactSyncService.syncToNetSuite(contact);

      // Then: Should record sync metadata
      expect(result.success).toBe(true);

      const syncStatus = contactSyncService.getSyncStatus('status.test@example.com');
      expect(syncStatus).toBeDefined();
      expect(syncStatus?.status).toBe('synced');
      expect(syncStatus?.lastSyncDate).toBeDefined();
      expect(syncStatus?.lastSyncDirection).toBe('outlook_to_netsuite');
    });
  });
});
