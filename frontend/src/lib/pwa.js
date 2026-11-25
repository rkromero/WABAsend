/**
 * Soporte PWA: service worker, instalación, badge del ícono y notificaciones locales.
 */
import { useEffect, useState } from 'react';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function registerPWA() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
  // Android/Chrome: guardamos el evento para mostrar nuestro botón "Instalar app"
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Estado de instalación: 'installed' | 'prompt' (Android) | 'ios' (instrucciones) | 'none' */
export function useInstallState() {
  const calc = () => (isStandalone() ? 'installed' : deferredPrompt ? 'prompt' : isIOS() ? 'ios' : 'none');
  const [state, setState] = useState(calc);
  useEffect(() => {
    const fn = () => setState(calc());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return state;
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome === 'accepted';
}

/** Número sobre el ícono de la app instalada (Android / iOS 16.4+ / desktop) */
export function setAppBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch { /* no soportado */ }
}

export function notificationsState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function enableNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

/** Notificación del sistema (solo si la app está en segundo plano y hay permiso) */
export async function showLocalNotification(title, body, url = '/') {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: url, renotify: true, data: { url } };
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* noop */ }
}

/** Ajusta el color de la barra de estado (el panel admin es oscuro) */
export function setThemeColor(color) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}
