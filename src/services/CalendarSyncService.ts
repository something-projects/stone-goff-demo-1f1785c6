/**
 * Calendar Sync Service
 *
 * Handles synchronization of Outlook calendar appointments to NetSuite activities:
 * - Meeting lifecycle management (create, update, cancel)
 * - Attendee matching and synchronization
 * - Timezone conversion (local -> UTC)
 * - Recurring meeting support
 * - Linking meetings to NetSuite records (customers, opportunities, cases)
 *
 * Performance Requirements:
 * - Calendar sync: < 3 seconds per meeting
 */

import {
  CalendarEvent,
  Attendee,
  NetSuiteActivity,
  NetSuiteRecord
} from '../models/types';
import { EmailMatchingService } from './EmailMatchingService';

export class CalendarSyncService {
  private emailMatchingService: EmailMatchingService;
  private syncedEvents: Map<string, string>; // eventId -> activityId
  private netsuiteActivities: Map<string, NetSuiteActivity>; // activityId -> Activity

  constructor(emailMatchingService?: EmailMatchingService) {
    this.emailMatchingService = emailMatchingService || new EmailMatchingService();
    this.syncedEvents = new Map();
    this.netsuiteActivities = new Map();
  }

  /**
   * Sync new calendar appointment to NetSuite as event activity
   */
  public async syncToNetSuite(event: CalendarEvent): Promise<NetSuiteActivity> {
    // Match attendees to NetSuite contacts
    const matchedAttendees = await this.matchAttendees(event.attendees || []);

    // Identify relevant NetSuite record (customer/opportunity)
    const linkedRecord = await this.identifyLinkedRecord(event);

    // Convert times to UTC
    const utcStartTime = this.convertToUTC(event.startTime, event.timezone);
    const utcEndTime = this.convertToUTC(event.endTime, event.timezone);

    // Create NetSuite activity
    const activity: NetSuiteActivity = {
      id: this.generateActivityId(),
      title: event.subject,
      message: this.buildEventMessage(event, matchedAttendees),
      startDate: utcStartTime,
      endDate: utcEndTime,
      customerId: linkedRecord?.customerId,
      opportunityId: linkedRecord?.opportunityId,
      status: event.status || 'confirmed',
      type: 'meeting'
    };

    // Store activity
    this.netsuiteActivities.set(activity.id!, activity);

    // Store sync mapping
    if (event.id) {
      this.syncedEvents.set(event.id, activity.id!);
    }

    return activity;
  }

  /**
   * Handle meeting update (time change, location change, attendee updates)
   */
  public async updateMeeting(event: CalendarEvent): Promise<NetSuiteActivity> {
    if (!event.id || !this.syncedEvents.has(event.id)) {
      throw new Error('Meeting not found in sync records');
    }

    const activityId = this.syncedEvents.get(event.id)!;
    const existingActivity = this.netsuiteActivities.get(activityId);

    if (!existingActivity) {
      throw new Error('NetSuite activity not found');
    }

    // Update activity with new details
    const matchedAttendees = await this.matchAttendees(event.attendees || []);
    const utcStartTime = this.convertToUTC(event.startTime, event.timezone);
    const utcEndTime = this.convertToUTC(event.endTime, event.timezone);

    const updatedActivity: NetSuiteActivity = {
      ...existingActivity,
      title: event.subject,
      message: this.buildEventMessage(event, matchedAttendees),
      startDate: utcStartTime,
      endDate: utcEndTime,
      status: event.status || 'confirmed'
    };

    this.netsuiteActivities.set(activityId, updatedActivity);

    return updatedActivity;
  }

  /**
   * Handle meeting cancellation
   */
  public async cancelMeeting(eventId: string, reason?: string): Promise<NetSuiteActivity> {
    if (!this.syncedEvents.has(eventId)) {
      throw new Error('Meeting not found in sync records');
    }

    const activityId = this.syncedEvents.get(eventId)!;
    const existingActivity = this.netsuiteActivities.get(activityId);

    if (!existingActivity) {
      throw new Error('NetSuite activity not found');
    }

    // Update activity status
    const cancelledActivity: NetSuiteActivity = {
      ...existingActivity,
      status: 'cancelled',
      message: existingActivity.message + `\n\n[CANCELLED]${reason ? ` Reason: ${reason}` : ''}`
    };

    this.netsuiteActivities.set(activityId, cancelledActivity);

    return cancelledActivity;
  }

  /**
   * Match attendees to NetSuite contacts
   */
  private async matchAttendees(attendees: Attendee[]): Promise<Array<Attendee & { contactId?: string }>> {
    const matched: Array<Attendee & { contactId?: string }> = [];

    for (const attendee of attendees) {
      // Try to match attendee email to NetSuite contact
      const mockEmail = {
        from: attendee.email,
        to: '',
        subject: '',
        body: '',
        timestamp: new Date()
      };

      const matchResult = await this.emailMatchingService.matchEmail(mockEmail);

      matched.push({
        ...attendee,
        contactId: matchResult.contactId
      });
    }

    return matched;
  }

  /**
   * Identify NetSuite record to link meeting to (customer/opportunity)
   */
  private async identifyLinkedRecord(event: CalendarEvent): Promise<{
    customerId?: string;
    opportunityId?: string;
  } | null> {
    // Extract opportunity reference from subject
    const oppPattern = /(?:opp|opportunity)\s*#([A-Z]+-\d+)/i;
    const oppMatch = event.subject.match(oppPattern);

    if (oppMatch) {
      return {
        opportunityId: `opportunity-${oppMatch[1]}`
      };
    }

    // Try to match attendees to customers
    if (event.attendees && event.attendees.length > 0) {
      for (const attendee of event.attendees) {
        const mockEmail = {
          from: attendee.email,
          to: '',
          subject: '',
          body: '',
          timestamp: new Date()
        };

        const matchResult = await this.emailMatchingService.matchEmail(mockEmail);
        if (matchResult.customerId) {
          return {
            customerId: matchResult.customerId
          };
        }
      }
    }

    return null;
  }

  /**
   * Build event message including attendee list
   */
  private buildEventMessage(event: CalendarEvent, attendees: Array<Attendee & { contactId?: string }>): string {
    let message = event.body || '';

    if (event.location) {
      message += `\n\nLocation: ${event.location}`;
    }

    if (attendees.length > 0) {
      message += '\n\nAttendees:\n';
      for (const attendee of attendees) {
        const statusIcon = this.getResponseStatusIcon(attendee.responseStatus);
        message += `${statusIcon} ${attendee.name || attendee.email}`;
        if (attendee.responseStatus) {
          message += ` (${attendee.responseStatus})`;
        }
        message += '\n';
      }
    }

    return message;
  }

  /**
   * Get icon for response status
   */
  private getResponseStatusIcon(status?: string): string {
    switch (status) {
      case 'accepted': return '✓';
      case 'declined': return '✗';
      case 'tentative': return '?';
      default: return '○';
    }
  }

  /**
   * Convert local time to UTC
   */
  private convertToUTC(date: Date, timezone?: string): Date {
    // If timezone is provided, we would use a proper timezone library (e.g., moment-timezone)
    // For now, we'll do a simple conversion based on common timezone offsets

    if (!timezone) {
      return date;
    }

    // Get timezone offset in hours
    const offset = this.getTimezoneOffset(timezone);

    // Create new date adjusted to UTC
    const utcTime = new Date(date.getTime() - offset * 60 * 60 * 1000);

    return utcTime;
  }

  /**
   * Get timezone offset in hours (simplified for common timezones)
   */
  private getTimezoneOffset(timezone: string): number {
    const offsets: Record<string, number> = {
      'PST': -8,
      'PDT': -7,
      'MST': -7,
      'MDT': -6,
      'CST': -6,
      'CDT': -5,
      'EST': -5,
      'EDT': -4,
      'UTC': 0,
      'GMT': 0
    };

    return offsets[timezone.toUpperCase()] || 0;
  }

  /**
   * Create recurring meeting series in NetSuite
   */
  public async createRecurringSeries(event: CalendarEvent): Promise<NetSuiteActivity[]> {
    if (!event.isRecurring || !event.recurrencePattern) {
      throw new Error('Event is not a recurring meeting');
    }

    const activities: NetSuiteActivity[] = [];
    const pattern = event.recurrencePattern;

    // Generate occurrences based on pattern
    const occurrences = this.generateOccurrences(event, pattern);

    for (const occurrence of occurrences) {
      const activity = await this.syncToNetSuite(occurrence);
      activities.push(activity);
    }

    return activities;
  }

  /**
   * Generate individual occurrences from recurrence pattern
   */
  private generateOccurrences(event: CalendarEvent, pattern: any): CalendarEvent[] {
    const occurrences: CalendarEvent[] = [];
    const maxOccurrences = pattern.occurrences || 52; // Default to 1 year weekly

    let currentDate = new Date(event.startTime);
    const duration = event.endTime.getTime() - event.startTime.getTime();

    for (let i = 0; i < maxOccurrences; i++) {
      const occurrence: CalendarEvent = {
        ...event,
        id: `${event.id}-occurrence-${i}`,
        startTime: new Date(currentDate),
        endTime: new Date(currentDate.getTime() + duration)
      };

      occurrences.push(occurrence);

      // Advance to next occurrence based on frequency
      switch (pattern.frequency) {
        case 'daily':
          currentDate.setDate(currentDate.getDate() + pattern.interval);
          break;
        case 'weekly':
          currentDate.setDate(currentDate.getDate() + 7 * pattern.interval);
          break;
        case 'monthly':
          currentDate.setMonth(currentDate.getMonth() + pattern.interval);
          break;
        case 'yearly':
          currentDate.setFullYear(currentDate.getFullYear() + pattern.interval);
          break;
      }

      // Stop if we've reached the end date
      if (pattern.endDate && currentDate > pattern.endDate) {
        break;
      }
    }

    return occurrences;
  }

  /**
   * Check if event is synced
   */
  public isEventSynced(eventId: string): boolean {
    return this.syncedEvents.has(eventId);
  }

  /**
   * Get NetSuite activity for event
   */
  public getActivity(eventId: string): NetSuiteActivity | undefined {
    const activityId = this.syncedEvents.get(eventId);
    return activityId ? this.netsuiteActivities.get(activityId) : undefined;
  }

  /**
   * Generate unique activity ID
   */
  private generateActivityId(): string {
    return `meeting-activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get activity for testing
   */
  public getActivityForTesting(activityId: string): NetSuiteActivity | undefined {
    return this.netsuiteActivities.get(activityId);
  }
}
