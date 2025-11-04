/**
 * Contact Sync Service
 *
 * Handles bidirectional synchronization of contacts between Outlook and NetSuite:
 * - Field mapping between Outlook and NetSuite formats
 * - Customer relationship linking
 * - Conflict detection and resolution (last-write-wins by default)
 * - Sync status tracking
 * - Support for 10,000+ contacts per user
 *
 * Performance Requirements:
 * - Contact sync: < 3 seconds per contact
 * - Bulk sync handles large volumes efficiently
 */

import {
  Contact,
  ContactSyncResult,
  NetSuiteContact,
  NetSuiteCustomer,
  ConflictInfo,
  ConflictResolution,
  SyncStatus
} from '../models/types';

export class ContactSyncService {
  private readonly SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes for delta sync

  private outlookContacts: Map<string, Contact>; // email -> Contact
  private netsuiteContacts: Map<string, NetSuiteContact>; // email -> NetSuiteContact
  private syncHistory: Map<string, SyncStatus>; // email -> SyncStatus
  private customerCache: Map<string, NetSuiteCustomer>; // company name -> Customer

  constructor() {
    this.outlookContacts = new Map();
    this.netsuiteContacts = new Map();
    this.syncHistory = new Map();
    this.customerCache = new Map();

    // Initialize with mock data
    this.initializeMockData();
  }

  /**
   * Initialize mock data for testing
   */
  private initializeMockData(): void {
    // Mock NetSuite contacts
    this.netsuiteContacts.set('alice@acmecorp.com', {
      id: 'ns-contact-001',
      firstName: 'Alice',
      lastName: 'Johnson',
      email: 'alice@acmecorp.com',
      phone: '+1-555-1234',
      customerId: 'customer-acme-001',
      title: 'VP of Sales',
      lastModifiedDate: new Date('2025-10-29T10:00:00Z')
    });

    // Mock customers
    this.customerCache.set('Acme Corporation', {
      id: 'customer-acme-001',
      companyName: 'Acme Corporation',
      email: 'info@acmecorp.com',
      domain: 'acmecorp.com',
      isInactive: false
    });
  }

  /**
   * Sync new contact from Outlook to NetSuite
   */
  public async syncToNetSuite(contact: Contact): Promise<ContactSyncResult> {
    try {
      // Map Outlook contact to NetSuite format
      const netsuiteContact = this.mapToNetSuiteContact(contact);

      // Link to customer record
      if (contact.company) {
        const customerId = await this.linkToCustomer(contact.company, contact.email);
        netsuiteContact.customerId = customerId;
      }

      // Generate ID for new contact
      if (!netsuiteContact.id) {
        netsuiteContact.id = this.generateContactId();
      }

      // Store in NetSuite contacts
      this.netsuiteContacts.set(contact.email.toLowerCase(), netsuiteContact);

      // Update sync status
      this.updateSyncStatus(contact.email, 'outlook_to_netsuite', 'synced');

      return {
        success: true,
        contactId: netsuiteContact.id
      };
    } catch (error) {
      this.updateSyncStatus(contact.email, 'outlook_to_netsuite', 'failed', (error as Error).message);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Sync contact update from NetSuite to Outlook
   */
  public async syncToOutlook(netsuiteContact: NetSuiteContact): Promise<ContactSyncResult> {
    try {
      // Map NetSuite contact to Outlook format
      const outlookContact = this.mapToOutlookContact(netsuiteContact);

      // Store in Outlook contacts
      this.outlookContacts.set(outlookContact.email.toLowerCase(), outlookContact);

      // Update sync status
      this.updateSyncStatus(outlookContact.email, 'netsuite_to_outlook', 'synced');

      return {
        success: true,
        contactId: outlookContact.id
      };
    } catch (error) {
      this.updateSyncStatus(netsuiteContact.email, 'netsuite_to_outlook', 'failed', (error as Error).message);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Handle contact deletion (mark as inactive, not delete)
   */
  public async handleDeletion(email: string, source: 'outlook' | 'netsuite'): Promise<ContactSyncResult> {
    try {
      if (source === 'outlook') {
        // Mark NetSuite contact as inactive
        const netsuiteContact = this.netsuiteContacts.get(email.toLowerCase());
        if (netsuiteContact) {
          netsuiteContact.isInactive = true;
          this.updateSyncStatus(email, 'outlook_to_netsuite', 'synced');
        }
      } else {
        // Mark Outlook contact with sync status
        const outlookContact = this.outlookContacts.get(email.toLowerCase());
        if (outlookContact) {
          this.updateSyncStatus(email, 'netsuite_to_outlook', 'synced');
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Detect and resolve conflicts when contact modified in both systems
   */
  public async detectAndResolveConflict(
    outlookContact: Contact,
    netsuiteContact: NetSuiteContact
  ): Promise<ContactSyncResult> {
    const conflicts: ConflictInfo[] = [];

    // Check for field-level conflicts
    if (outlookContact.phone !== netsuiteContact.phone) {
      conflicts.push({
        field: 'phone',
        outlookValue: outlookContact.phone,
        netsuiteValue: netsuiteContact.phone,
        outlookLastModified: outlookContact.lastModified || new Date(),
        netsuiteLastModified: netsuiteContact.lastModifiedDate || new Date()
      });
    }

    if (outlookContact.title !== netsuiteContact.title) {
      conflicts.push({
        field: 'title',
        outlookValue: outlookContact.title,
        netsuiteValue: netsuiteContact.title,
        outlookLastModified: outlookContact.lastModified || new Date(),
        netsuiteLastModified: netsuiteContact.lastModifiedDate || new Date()
      });
    }

    if (conflicts.length === 0) {
      return { success: true };
    }

    // Apply last-write-wins strategy
    const resolvedContact = this.applyLastWriteWins(outlookContact, netsuiteContact, conflicts);

    // Sync resolved contact
    if (resolvedContact.source === 'outlook') {
      return await this.syncToNetSuite(outlookContact);
    } else {
      return await this.syncToOutlook(netsuiteContact);
    }
  }

  /**
   * Apply last-write-wins conflict resolution
   */
  private applyLastWriteWins(
    outlookContact: Contact,
    netsuiteContact: NetSuiteContact,
    conflicts: ConflictInfo[]
  ): { source: 'outlook' | 'netsuite'; resolvedFields: Record<string, any> } {
    const resolvedFields: Record<string, any> = {};

    for (const conflict of conflicts) {
      const outlookTime = conflict.outlookLastModified.getTime();
      const netsuiteTime = conflict.netsuiteLastModified.getTime();

      if (outlookTime > netsuiteTime) {
        resolvedFields[conflict.field] = conflict.outlookValue;
        conflict.resolution = 'outlook_wins';
      } else {
        resolvedFields[conflict.field] = conflict.netsuiteValue;
        conflict.resolution = 'netsuite_wins';
      }
    }

    // Determine which version wins overall
    const source = conflicts.every(c => c.resolution === 'outlook_wins') ? 'outlook' : 'netsuite';

    return { source, resolvedFields };
  }

  /**
   * Map Outlook contact to NetSuite contact format
   */
  private mapToNetSuiteContact(contact: Contact): NetSuiteContact {
    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      customerId: contact.customerId,
      isInactive: false,
      lastModifiedDate: contact.lastModified || new Date()
    };
  }

  /**
   * Map NetSuite contact to Outlook contact format
   */
  private mapToOutlookContact(netsuiteContact: NetSuiteContact): Contact {
    // Look up customer name if customerId is present
    let companyName: string | undefined;
    if (netsuiteContact.customerId) {
      const customer = Array.from(this.customerCache.values())
        .find(c => c.id === netsuiteContact.customerId);
      companyName = customer?.companyName;
    }

    return {
      id: netsuiteContact.id,
      firstName: netsuiteContact.firstName,
      lastName: netsuiteContact.lastName,
      email: netsuiteContact.email,
      phone: netsuiteContact.phone,
      company: companyName,
      title: netsuiteContact.title,
      customerId: netsuiteContact.customerId,
      lastModified: netsuiteContact.lastModifiedDate
    };
  }

  /**
   * Link contact to customer record (create customer if needed)
   */
  private async linkToCustomer(companyName: string, contactEmail: string): Promise<string> {
    // Check if customer already exists
    let customer = this.customerCache.get(companyName);

    if (!customer) {
      // Create new customer
      const domain = this.extractDomain(contactEmail);
      customer = {
        id: this.generateCustomerId(),
        companyName,
        domain: domain || undefined,
        isInactive: false
      };
      this.customerCache.set(companyName, customer);
    }

    return customer.id!;
  }

  /**
   * Extract domain from email
   */
  private extractDomain(email: string): string | null {
    const match = email.match(/@(.+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Update sync status
   */
  private updateSyncStatus(
    email: string,
    direction: 'outlook_to_netsuite' | 'netsuite_to_outlook',
    status: 'synced' | 'failed' | 'conflict',
    error?: string
  ): void {
    const syncStatus: SyncStatus = {
      lastSyncDate: new Date(),
      lastSyncDirection: direction,
      status,
      error
    };

    this.syncHistory.set(email.toLowerCase(), syncStatus);
  }

  /**
   * Get sync status for contact
   */
  public getSyncStatus(email: string): SyncStatus | undefined {
    return this.syncHistory.get(email.toLowerCase());
  }

  /**
   * Bulk sync contacts with optimized performance
   */
  public async bulkSyncToNetSuite(contacts: Contact[]): Promise<{
    successCount: number;
    failureCount: number;
    results: ContactSyncResult[];
  }> {
    const results: ContactSyncResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process contacts in parallel batches
    const batchSize = 50;
    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      const batchPromises = batch.map(contact => this.syncToNetSuite(contact));
      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      }
    }

    return { successCount, failureCount, results };
  }

  /**
   * Generate unique contact ID
   */
  private generateContactId(): string {
    return `contact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique customer ID
   */
  private generateCustomerId(): string {
    return `customer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get contact for testing
   */
  public getContactForTesting(email: string, source: 'outlook' | 'netsuite'): Contact | NetSuiteContact | undefined {
    if (source === 'outlook') {
      return this.outlookContacts.get(email.toLowerCase());
    } else {
      return this.netsuiteContacts.get(email.toLowerCase());
    }
  }

  /**
   * Get customer for testing
   */
  public getCustomerForTesting(companyName: string): NetSuiteCustomer | undefined {
    return this.customerCache.get(companyName);
  }
}
