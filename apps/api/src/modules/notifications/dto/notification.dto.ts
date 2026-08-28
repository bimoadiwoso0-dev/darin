import { z } from 'zod';
import { booleanQuery, paginationQuery } from '../../../common/dto/query.schema';

const NOTIFICATION_TYPES = [
  'DUE_SOON', 'OVERDUE', 'RESERVATION_READY', 'MEMBERSHIP_EXPIRING',
  'FINE_ISSUED', 'LOST_BOOK', 'SYSTEM',
] as const;

const NOTIFICATION_STATUSES = [
  'PENDING', 'SENT', 'FAILED', 'READ', 'CANCELLED',
] as const;

export const NotificationListSchema = z.object({
  ...paginationQuery,
  type: z.enum(NOTIFICATION_TYPES).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  /** میان‌بر پرکاربرد: فقط کارهای انجام‌نشده. */
  pendingOnly: booleanQuery,
});

export type NotificationListQuery = z.infer<typeof NotificationListSchema>;

export const MarkAllSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
