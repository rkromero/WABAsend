/**
 * Helpers de la app del vendedor (formato de fechas, avatares, productos).
 */
import { format, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';

const AVATAR_COLORS = ['#25a18e', '#7d5ba6', '#e06b5e', '#3b8fd9', '#d98c3b', '#4aa35a', '#c4527d', '#5c6bc0'];

export function initials(name = '') {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return clean.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '#';
}

export function avatarColor(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function toDate(ts) {
  if (!ts) return null;
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return isNaN(d) ? null : d;
}

/** Hora en la lista de chats: 14:32 / Ayer / lunes / 12/03/26 */
export function listTime(ts) {
  const d = toDate(ts);
  if (!d) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Ayer';
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEEE', { locale: es });
  return format(d, 'dd/MM/yy');
}

export function msgTime(ts) {
  const d = toDate(ts);
  return d ? format(d, 'HH:mm') : '';
}

/** Separador de fecha dentro del chat */
export function dayLabel(ts) {
  const d = toDate(ts);
  if (!d) return '';
  if (isToday(d)) return 'Hoy';
  if (isYesterday(d)) return 'Ayer';
  if (differenceInCalendarDays(new Date(), d) < 7) {
    const w = format(d, 'EEEE', { locale: es });
    return w[0].toUpperCase() + w.slice(1);
  }
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
}

export function dayKey(ts) {
  const d = toDate(ts);
  return d ? format(d, 'yyyy-MM-dd') : '';
}

export function contactOf(conv) {
  const s = conv?.meta?.sender || {};
  return {
    name: s.name || s.phone_number || 'Desconocido',
    phone: s.phone_number || '',
    thumb: s.thumbnail || '',
  };
}

export function isOutgoing(msg) {
  // Chatwoot: 0 entrante, 1 saliente, 2 actividad, 3 plantilla (saliente)
  return [1, 3, 'outgoing', 'template'].includes(msg?.message_type);
}

export function money(n) {
  if (n === null || n === undefined || n === '') return '';
  return `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

/** Texto listo para mandar por WhatsApp con la info del producto */
export function productMessage(p) {
  const lines = [`*${p.nombre}*`];
  if (p.precio_oferta) {
    lines.push(`💲 ${money(p.precio_oferta)} (antes ~${money(p.precio)}~)`);
  } else if (p.precio) {
    lines.push(`💲 ${money(p.precio)}`);
  }
  if (p.variantes) lines.push(`📏 Talles disponibles: ${p.variantes}`);
  if (p.permalink) lines.push(p.permalink);
  return lines.join('\n');
}

/** Beep doble suave para mensajes nuevos (Web Audio, sin archivos) */
export function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[0, 880], [0.2, 1100]].forEach(([t, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      const s = ctx.currentTime + t;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.18, s + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.18);
      osc.start(s);
      osc.stop(s + 0.18);
    });
    navigator.vibrate?.(120);
  } catch { /* noop */ }
}
