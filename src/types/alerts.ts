export interface AlertZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  magnitudeThreshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface AlertSettings {
  notificationsEnabled: boolean;
  defaultMagnitudeThreshold: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  playSound: boolean;
}

export interface NotifiedEvent {
  key: string;
  timestamp: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  notificationsEnabled: false,
  defaultMagnitudeThreshold: 4.5,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  playSound: true,
};
