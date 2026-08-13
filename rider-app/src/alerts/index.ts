export {
  DEFAULT_ALERT_PREFERENCES,
  loadAlertPreferences,
  saveAlertPreferences,
  type AlertPreferences,
} from '@/src/alerts/preferences';

export {
  notifyRider,
  requestNotificationPermission,
  getNotificationPermissionStatus,
  preloadAlertSounds,
  canUseOsNotifications,
  type RiderAlertEvent,
  type RiderAlertMeta,
} from '@/src/alerts/riderAlerts';

export { AlertProvider, useAlerts } from '@/src/alerts/AlertProvider';

export {
  registerForPushNotifications,
  parsePushPayload,
} from '@/src/alerts/pushStub';
