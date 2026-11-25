/**
 * Lista de chats (pantalla principal del vendedor) — estilo WhatsApp.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowLeft, MoreVertical, LogOut, MessageCircle, Camera, FileText, Mic, Video, Download, Bell, Share, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useInstallState, promptInstall, notificationsState, enableNotifications } from '../lib/pwa.js';
import { logout } from '../lib/auth.js';
import { Avatar, Ticks, BottomNav, Spinner } from './ui.jsx';
import { contactOf, listTime, isOutgoing } from './waUtils.js';

const ATTACH_PREVIEW = {
  image: [Camera, 'Foto'],
  video: [Video, 'Video'],
  audio: [Mic, 'Audio'],
  file: [FileText, 'Documento'],
};

function Preview({ msg, phone }) {
  if (!msg) return <span>{phone}</span>;
  const out = isOutgoing(msg);
  const att = msg.attachments?.[0];
  const [Icon, label] = att ? ATTACH_PREVIEW[att.file_type] || ATTACH_PREVIEW.file : [];
  return (
    <span className="flex items-center gap-1 min-w-0">
      {out && <Ticks status={msg.status} className="shrink-0" />}
      {Icon && <Icon size={15} className="shrink-0" />}
      <span className="truncate">{msg.content || label || ''}</span>
    </span>
  );
}

const DISMISS_KEY = 'wa_install_dismissed';

/** Banner para instalar la app (Android: botón nativo / iOS: instrucciones) */
function InstallBanner() {
  const state = useInstallState();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  if (hidden || (state !== 'prompt' && state !== 'ios')) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
  };
  return (
    <div className="mx-3 mt-1 mb-2 flex items-center gap-3 rounded-xl bg-wa-chipon px-3 py-2.5 text-wa-chiptext">
      <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />
      <div className="flex-1 min-w-0 text-[13.5px] leading-snug">
        <p className="font-semibold">Instalá Ventas en tu teléfono</p>
        {state === 'ios' ? (
          <p className="flex items-center flex-wrap gap-1">
            Tocá <Share size={14} className="inline" /> <b>Compartir</b> y después <b>Agregar a inicio</b>
          </p>
        ) : (
          <p>Abrila como una app, sin entrar al navegador.</p>
        )}
      </div>
      {state === 'prompt' && (
        <button onClick={promptInstall} className="shrink-0 px-3.5 h-9 rounded-full bg-wa-green text-white text-[14px] font-semibold">
          Instalar
        </button>
      )}
      <button onClick={dismiss} className="shrink-0 p-1 opacity-70" aria-label="Cerrar"><X size={18} /></button>
    </div>
  );
}

function ChatRow({ conv, tags, onOpen }) {
  const { name, phone, thumb } = contactOf(conv);
  const unread = conv.unread_count || 0;
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 px-4 active:bg-wa-panel text-left">
      <Avatar name={name} seed={phone} src={thumb} />
      <div className="flex-1 min-w-0 py-3 border-b border-wa-line">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[16.5px] font-medium truncate">{name}</span>
          <span className={`text-[12px] shrink-0 ${unread ? 'text-wa-green font-medium' : 'text-wa-sub'}`}>
            {listTime(conv.last_activity_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[14.5px] text-wa-sub min-w-0 flex-1">
            <Preview msg={conv.last_non_activity_message} phone={phone} />
          </span>
          {unread > 0 && (
            <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-wa-green text-white text-[12px] font-semibold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        {tags?.length > 0 && (
          <div className="flex gap-1 mt-1 overflow-hidden">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[11px] px-2 py-px rounded-full bg-wa-chip text-wa-sub capitalize">
                {t.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

export default function ChatList({ conversations, loading, error, tags, user, unread }) {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const installState = useInstallState();
  const [notifState, setNotifState] = useState(notificationsState);

  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);

  // Chips: Todos / No leídos / etiquetas en uso
  const tagChips = useMemo(() => {
    const set = new Set();
    conversations.forEach((c) => (tags[c.id] || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [conversations, tags]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === 'unread' && !(c.unread_count > 0)) return false;
      if (filter.startsWith('tag:') && !(tags[c.id] || []).includes(filter.slice(4))) return false;
      if (!term) return true;
      const { name, phone } = contactOf(c);
      const last = c.last_non_activity_message?.content || '';
      return `${name} ${phone} ${last}`.toLowerCase().includes(term);
    });
  }, [conversations, q, filter, tags]);

  const chip = (key, label) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`shrink-0 px-3.5 py-1.5 rounded-full text-[14px] capitalize border ${
        filter === key
          ? 'bg-wa-chipon text-wa-chiptext border-transparent font-medium'
          : 'bg-wa-chip text-wa-sub border-transparent'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* Header */}
      <header className="shrink-0 bg-wa-bg wa-safe-top">
        {searching ? (
          <div className="flex items-center gap-2 h-14 px-2">
            <button onClick={() => { setSearching(false); setQ(''); }} className="p-2 rounded-full active:bg-wa-panel">
              <ArrowLeft size={22} />
            </button>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nombre, número o mensaje…"
              className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-wa-sub"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between h-14 pl-4 pr-1">
            <h1 className="text-[22px] font-semibold text-wa-title">Ventas</h1>
            <div className="flex items-center">
              <button onClick={() => setSearching(true)} className="p-2.5 rounded-full active:bg-wa-panel" aria-label="Buscar">
                <Search size={22} />
              </button>
              <button onClick={() => setMenuOpen(true)} className="p-2.5 rounded-full active:bg-wa-panel" aria-label="Menú">
                <MoreVertical size={22} />
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
          {chip('all', 'Todos')}
          {chip('unread', `No leídos${unread ? ` ${unread}` : ''}`)}
          {tagChips.map((t) => chip(`tag:${t}`, t.replace(/_/g, ' ')))}
        </div>
      </header>

      {/* Lista */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex justify-center pt-16"><Spinner /></div>
        ) : null}
        {!loading && <InstallBanner />}
        {loading ? null : visible.length === 0 ? (
          <div className="flex flex-col items-center text-center px-10 pt-20 text-wa-sub">
            <MessageCircle size={48} strokeWidth={1.4} />
            <p className="mt-3 text-[15px]">
              {error ? 'No se pudieron cargar los chats. Reintentando…' : q || filter !== 'all' ? 'No hay chats que coincidan' : 'Todavía no hay conversaciones'}
            </p>
          </div>
        ) : (
          <>
            {visible.map((c) => (
              <ChatRow key={c.id} conv={c} tags={tags[c.id]} onOpen={() => navigate(`/chat/${c.id}`)} />
            ))}
            <p className="text-center text-[12px] text-wa-sub py-6">🔒 Respondés como la cuenta de WhatsApp de la empresa</p>
          </>
        )}
      </main>

      <BottomNav unread={unread} />

      {/* Menú ⋮ */}
      {menuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}>
          <div
            className="absolute right-2 top-2 wa-safe-top min-w-[220px] rounded-xl bg-wa-bg shadow-xl border border-wa-line py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 border-b border-wa-line mb-1">
              <p className="text-[15px] font-medium">{user?.nombre}</p>
              <p className="text-[13px] text-wa-sub">@{user?.usuario} · Vendedor</p>
            </div>
            {installState === 'prompt' && (
              <button onClick={() => { setMenuOpen(false); promptInstall(); }} className="w-full flex items-center gap-3 px-4 py-3 text-[15px] active:bg-wa-panel">
                <Download size={18} /> Instalar app
              </button>
            )}
            {notifState === 'default' && (
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  const r = await enableNotifications();
                  setNotifState(r);
                  if (r === 'granted') toast.success('Notificaciones activadas');
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-[15px] active:bg-wa-panel"
              >
                <Bell size={18} /> Activar notificaciones
              </button>
            )}
            <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 text-[15px] active:bg-wa-panel">
              <LogOut size={18} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </>
  );
}
