import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Users,
  Send,
  Settings,
  MessageSquareMore,
  MessageSquare,
  Bot,
  ShoppingBag,
  Zap,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Send, label: 'Campañas' },
  { to: '/automations', icon: Zap, label: 'Automatizaciones' },
  { to: '/inbox', icon: MessageSquare, label: 'Bandeja' },
  { to: '/bot', icon: Bot, label: 'Bot' },
  { to: '/products', icon: ShoppingBag, label: 'Productos' },
  { to: '/contacts', icon: Users, label: 'Contactos' },
  { to: '/templates', icon: FileText, label: 'Plantillas' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

export default function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r border-base-border bg-base-surface">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-base-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
            <MessageSquareMore size={16} className="text-accent" />
          </div>
          <div>
            <span className="font-display font-bold text-white text-sm tracking-wide">
              WABA Sender
            </span>
            <p className="text-[10px] text-gray-500 leading-none mt-0.5">Campañas WhatsApp</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-accent/10 text-accent border border-accent/20 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`
            }
          >
            <Icon size={16} strokeWidth={isActive => (isActive ? 2.5 : 2)} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-base-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse-subtle" />
          <span className="text-xs text-gray-500">Sistema activo</span>
        </div>
      </div>
    </aside>
  );
}
