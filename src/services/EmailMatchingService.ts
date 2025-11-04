/**
 * Email Matching Service
 *
 * Implements intelligent email-to-NetSuite record matching using multiple strategies:
 * - Exact email address matching
 * - Domain-based matching
 * - Keyword/reference number extraction
 * - Custom user-defined rules
 * - Confidence scoring (0-100%)
 *
 * Design Spec: Rule-based matching with user override. Auto-link if confidence > 90%.
 * Provides transparent, predictable behavior that users can understand and customize.
 */

import {
  Email,
  MatchResult,
  MatchingRule,
  DomainMapping,
  NetSuiteRecord,
  EmailIdentificationResult
} from '../models/types';

export class EmailMatchingService {
  private readonly AUTO_LINK_THRESHOLD = 90;
  private readonly GENERIC_DOMAINS = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'aol.com',
    'icloud.com',
    'mail.com',
    'protonmail.com'
  ];

  private netsuiteContacts: Map<string, NetSuiteRecord>; // Email -> Contact mapping
  private domainMappings: Map<string, DomainMapping>;
  private customRules: MatchingRule[];
  private contactCache: Map<string, { record: NetSuiteRecord; cachedAt: Date }>;

  constructor() {
    this.netsuiteContacts = new Map();
    this.domainMappings = new Map();
    this.customRules = [];
    this.contactCache = new Map();

    // Initialize with mock data for testing
    this.initializeMockData();
  }

  /**
   * Initialize mock NetSuite contact data for testing
   */
  private initializeMockData(): void {
    // Mock contacts
    this.netsuiteContacts.set('jane.smith@acmecorp.com', {
      id: 'contact-12345',
      type: 'contact',
      name: 'Jane Smith',
      email: 'jane.smith@acmecorp.com',
      domain: 'acmecorp.com',
      additionalInfo: { customerId: 'customer-acme-001' }
    });

    this.netsuiteContacts.set('john.doe@example.com', {
      id: 'contact-67890',
      type: 'contact',
      name: 'John Doe',
      email: 'john.doe@example.com',
      domain: 'example.com'
    });

    // Mock domain mappings
    this.domainMappings.set('acmecorp.com', {
      domain: 'acmecorp.com',
      customerId: 'customer-acme-001',
      customerName: 'Acme Corporation',
      isGeneric: false
    });

    this.domainMappings.set('example.com', {
      domain: 'example.com',
      customerId: 'customer-example-001',
      customerName: 'Example Inc',
      isGeneric: false
    });

    // Mock custom rules
    this.customRules.push({
      id: 'rule-001',
      name: 'Partner Email Rule',
      type: 'domain',
      pattern: '@partner.com',
      targetRecordId: 'customer-partner-123',
      targetRecordType: 'customer',
      priority: 1,
      isActive: true
    });
  }

  /**
   * Main matching function - finds best NetSuite record match for email
   */
  public async matchEmail(email: Email): Promise<EmailIdentificationResult> {
    const matches: MatchResult[] = [];

    // Step 1: Try exact email address match
    const exactMatch = this.matchByExactEmail(email.from);
    if (exactMatch) {
      matches.push(exactMatch);
    }

    // Step 2: Try domain-based match if no exact match or low confidence
    if (!exactMatch || exactMatch.confidence < 100) {
      const domainMatch = this.matchByDomain(email.from);
      if (domainMatch) {
        matches.push(domainMatch);
      }
    }

    // Step 3: Try keyword/reference matching in subject and body
    const keywordMatch = this.matchByKeywords(email);
    if (keywordMatch) {
      matches.push(keywordMatch);
    }

    // Step 4: Apply custom rules
    const customMatch = this.matchByCustomRules(email);
    if (customMatch) {
      matches.push(customMatch);
    }

    // Sort matches by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    // Determine result based on best match
    if (matches.length === 0) {
      return {
        isCustomerRelated: false,
        shouldSync: false,
        exclusionReason: 'no_match_found'
      };
    }

    const bestMatch = matches[0];

    // Auto-link if confidence is high enough
    if (bestMatch.confidence >= this.AUTO_LINK_THRESHOLD) {
      return {
        isCustomerRelated: true,
        shouldSync: true,
        matchedCustomer: bestMatch.recordName,
        customerId: bestMatch.recordId,
        contactId: bestMatch.recordType === 'contact' ? bestMatch.recordId : undefined,
        confidence: bestMatch.confidence
      };
    }

    // Suggest manual selection for lower confidence matches
    return {
      isCustomerRelated: true,
      shouldSync: false,
      matchedCustomer: bestMatch.recordName,
      customerId: bestMatch.recordId,
      requiresManualSelection: true,
      suggestedRecords: matches.map(m => ({
        id: m.recordId,
        type: m.recordType as any,
        name: m.recordName,
        additionalInfo: { confidence: m.confidence, matchReason: m.matchReason }
      })),
      confidence: bestMatch.confidence
    };
  }

  /**
   * Match by exact email address (100% confidence)
   */
  private matchByExactEmail(email: string): MatchResult | null {
    const normalizedEmail = email.toLowerCase().trim();

    const contact = this.netsuiteContacts.get(normalizedEmail);
    if (contact) {
      return {
        recordId: contact.id,
        recordType: 'contact',
        recordName: contact.name,
        confidence: 100,
        matchReason: `Exact email match: ${email}`,
        matchedBy: 'exact_email'
      };
    }

    return null;
  }

  /**
   * Match by email domain (confidence varies based on domain specificity)
   */
  private matchByDomain(email: string): MatchResult | null {
    const domain = this.extractDomain(email);

    if (!domain) {
      return null;
    }

    // Check if domain is generic
    if (this.isGenericDomain(domain)) {
      return null; // Don't match on generic domains
    }

    const domainMapping = this.domainMappings.get(domain);
    if (domainMapping) {
      return {
        recordId: domainMapping.customerId,
        recordType: 'customer',
        recordName: domainMapping.customerName,
        confidence: 85, // Domain matches have 85% confidence
        matchReason: `Domain match: ${domain}`,
        matchedBy: 'domain'
      };
    }

    return null;
  }

  /**
   * Match by keywords in email subject or body (e.g., opportunity numbers, case IDs)
   */
  private matchByKeywords(email: Email): MatchResult | null {
    // Extract opportunity references like "Opportunity #OP-45678" or "Opp #OP-45678"
    const oppPattern = /(?:opportunity|opp)\s*#([A-Z]+-\d+)/i;
    const oppMatch = email.subject.match(oppPattern) || email.body?.match(oppPattern);

    if (oppMatch) {
      const oppNumber = oppMatch[1];
      return {
        recordId: `opportunity-${oppNumber}`,
        recordType: 'lead', // Using 'lead' as proxy for opportunity
        recordName: `Opportunity ${oppNumber}`,
        confidence: 95,
        matchReason: `Found opportunity reference: ${oppNumber}`,
        matchedBy: 'keyword'
      };
    }

    // Extract case references like "Case #CASE-12345"
    const casePattern = /case\s*#([A-Z]+-\d+)/i;
    const caseMatch = email.subject.match(casePattern) || email.body?.match(casePattern);

    if (caseMatch) {
      const caseNumber = caseMatch[1];
      return {
        recordId: `case-${caseNumber}`,
        recordType: 'customer',
        recordName: `Case ${caseNumber}`,
        confidence: 95,
        matchReason: `Found case reference: ${caseNumber}`,
        matchedBy: 'keyword'
      };
    }

    return null;
  }

  /**
   * Match using custom user-defined rules
   */
  private matchByCustomRules(email: Email): MatchResult | null {
    // Sort rules by priority
    const activeRules = this.customRules
      .filter(rule => rule.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      let matched = false;

      switch (rule.type) {
        case 'email':
          matched = email.from.toLowerCase().includes(rule.pattern.toLowerCase());
          break;
        case 'domain':
          const domain = this.extractDomain(email.from);
          matched = domain ? domain.includes(rule.pattern.replace('@', '')) : false;
          break;
        case 'keyword':
          matched = email.subject.toLowerCase().includes(rule.pattern.toLowerCase()) ||
                   email.body?.toLowerCase().includes(rule.pattern.toLowerCase()) || false;
          break;
      }

      if (matched) {
        return {
          recordId: rule.targetRecordId,
          recordType: rule.targetRecordType === 'customer' ? 'customer' : 'contact',
          recordName: `Record matched by rule: ${rule.name}`,
          confidence: 90, // Custom rules get 90% confidence
          matchReason: `Matched by custom rule: ${rule.name}`,
          matchedBy: 'custom_rule'
        };
      }
    }

    return null;
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string | null {
    const match = email.match(/@(.+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Check if domain is generic (e.g., gmail.com)
   */
  private isGenericDomain(domain: string): boolean {
    return this.GENERIC_DOMAINS.includes(domain.toLowerCase());
  }

  /**
   * Check if email should be excluded from sync (e.g., internal emails)
   */
  public shouldExcludeFromSync(email: Email, internalDomains: string[]): boolean {
    const fromDomain = this.extractDomain(email.from);
    const toDomain = typeof email.to === 'string'
      ? this.extractDomain(email.to)
      : email.to.length > 0 ? this.extractDomain(email.to[0]) : null;

    // Exclude if both sender and receiver are internal
    if (fromDomain && toDomain) {
      const fromInternal = internalDomains.some(d => fromDomain.includes(d));
      const toInternal = internalDomains.some(d => toDomain.includes(d));

      if (fromInternal && toInternal) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add or update contact in cache
   */
  public cacheContact(email: string, record: NetSuiteRecord): void {
    const normalizedEmail = email.toLowerCase().trim();
    this.netsuiteContacts.set(normalizedEmail, record);
    this.contactCache.set(normalizedEmail, {
      record,
      cachedAt: new Date()
    });
  }

  /**
   * Add or update domain mapping
   */
  public addDomainMapping(domain: string, customerId: string, customerName: string): void {
    this.domainMappings.set(domain.toLowerCase(), {
      domain: domain.toLowerCase(),
      customerId,
      customerName,
      isGeneric: false
    });
  }

  /**
   * Add custom matching rule
   */
  public addCustomRule(rule: MatchingRule): void {
    this.customRules.push(rule);
  }

  /**
   * Get all custom rules
   */
  public getCustomRules(): MatchingRule[] {
    return this.customRules;
  }

  /**
   * Remove custom rule
   */
  public removeCustomRule(ruleId: string): void {
    this.customRules = this.customRules.filter(rule => rule.id !== ruleId);
  }

  /**
   * Clear expired cache entries (older than 4 hours)
   */
  public clearExpiredCache(): void {
    const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
    const now = new Date();

    for (const [email, cached] of this.contactCache.entries()) {
      if (now.getTime() - cached.cachedAt.getTime() > CACHE_TTL_MS) {
        this.contactCache.delete(email);
      }
    }
  }

  /**
   * Get NetSuite contact for testing
   */
  public getContactForTesting(email: string): NetSuiteRecord | undefined {
    return this.netsuiteContacts.get(email.toLowerCase());
  }
}
