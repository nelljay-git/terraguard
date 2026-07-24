export function isQuietHours(start: number, end: number): boolean {
  const hour = new Date().getHours();
  if (start <= end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

export function sendNotification(title: string, options?: NotificationOptions): void {
  if (Notification.permission !== 'granted') return;

  const merged = {
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    ...options,
  };

  try {
    new Notification(title, merged as NotificationOptions);
  } catch {
    // Mobile / restricted contexts require ServiceWorker
    navigator.serviceWorker?.ready?.then(reg => {
      reg.showNotification(title, merged as NotificationOptions);
    }).catch(() => { /* silently fail */ });
  }
}
