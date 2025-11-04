/**
 * Outlook to NetSuite Integration
 *
 * Main entry point for the integration platform.
 * Exports all services and types for use in the application.
 */

// Export all services
export { AuthService } from './services/AuthService';
export { EmailMatchingService } from './services/EmailMatchingService';
export { EmailSyncService } from './services/EmailSyncService';
export { ContactSyncService } from './services/ContactSyncService';
export { CalendarSyncService } from './services/CalendarSyncService';
export { IntegrationService } from './services/IntegrationService';

// Export all types
export * from './models/types';

// Export version
export const VERSION = '1.0.0';
