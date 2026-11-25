/**
 * Componentes visuales compartidos de la app del vendedor.
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { MessageCircle, ShoppingBag, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { initials, avatarColor } from './waUtils.js';

export function Avatar({ name, seed, src, size = 48 }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (src) {
    return <img src={src} alt="" style={style} className="rounded-full object-cover shrink-0" />;
  }
  return (
    <div
      style={{ ...style, background: avatarColor(seed || name) }}
      className="rounded-full shrink-0 flex items-center justify-center text-white font-medium select-none"
    >
      {initials(name)}
    </div>
  );
}

/** Ticks de estado de un mensaje saliente */
export function Ticks({ status, className = '' }) {
  if (status === 'failed') return <AlertCircle size={15} className={`text-red-500 ${className}`} />;
  if (status === 'progress') return <Clock size={13} className={`text-wa-sub ${className}`} />;
  if (status === 'read') return <CheckCheck size={16} className={`text-wa-blue ${className}`} />;
  if (status === 'delivered') return <CheckCheck size={16} className={`text-wa-sub ${className}`} />;
  return <Check size={16} className={`text-wa-sub ${className}`} />;
}

export function BottomNav({ unread }) {
  const item = (to, Icon, label, badge) => (
    <NavLink
      to={to}
      end
      className="flex-1 flex flex-col items-center gap-1 pt-2 pb-1.5 active:opacity-70"
    >
      {({ isActive }) => (
        <>
          <span
            className={`relative px-5 py-1 rounded-full transition-colors ${
              isActive ? 'bg-wa-chipon text-wa-chiptext' : 'text-wa-text'
            }`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} />
            {badge > 0 && (
              <span className="absolute -top-1 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-wa-green text-white text-[11px] font-semibold flex items-center justify-center">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className={`text-[12px] ${isActive ? 'font-semibold text-wa-text' : 'text-wa-sub'}`}>{label}</span>
        </>
      )}
    </NavLink>
  );

  return (
    <nav className="shrink-0 flex border-t border-wa-line bg-wa-bg wa-safe-bottom">
      {item('/', MessageCircle, 'Chats', unread)}
      {item('/productos', ShoppingBag, 'Productos', 0)}
    </nav>
  );
}

/** Hoja inferior modal (bottom sheet) */
export function Sheet({ open, onClose, children, full = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full bg-wa-bg rounded-t-2xl wa-sheet-in wa-safe-bottom flex flex-col ${
          full ? 'h-[92dvh]' : 'max-h-[85dvh]'
        }`}
      >
        <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-wa-line shrink-0" />
        {children}
      </div>
    </div>
  );
}

export function Spinner({ className = '' }) {
  return (
    <div className={`w-7 h-7 rounded-full border-[3px] border-wa-line border-t-wa-green animate-spin ${className}`} />
  );
}
