/**
 * Bandeja de entrada — Inbox
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * Interfaz de dos columnas para gestionar conversaciones de WhatsApp
 * sincronizadas con Chatwoot. Polling cada 4 segundos para actualizaciones.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Search,
  Send,
  Inbox as InboxIcon,
  Phone,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Genera las iniciales del nombre (máx. 2 letras) */
function getInitials(name = '') {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';
}

/** Formatea un timestamp Unix o ISO string para mostrar en la lista */
function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    // Chatwoot puede devolver timestamp Unix (número) o ISO string
    const date = typeof ts === 'number' ? new Date(ts * 1000) : parseISO(ts);
    return formatDistanceToNow(date, { addSuffix: false, locale: es });
  } catch {
    return '';
  }
}

/** Formatea un timestamp de mensaje para mostrar en el chat */
function formatMessageTime(ts) {
  if (!ts) return '';
  try {
    const date = typeof ts === 'number' ? new Date(ts * 1000) : parseISO(ts);
    return format(date, 'HH:mm', { locale: es });
  } catch {
    return '';
  }
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="skeleton w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-3 w-48 rounded" />
      </div>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
          <div className={`skeleton h-10 rounded-2xl ${i % 2 === 0 ? 'w-48' : 'w-40'}`} />
        </div>
      ))}
    </div>
  );
}

/** Una fila en la lista de conversaciones */
function ConversationItem({ conversation, isActive, onClick }) {
  const contact = conversation.meta?.sender || {};
  const name = contact.name || contact.phone_number || 'Desconocido';
  const phone = contact.phone_number || '';
  const lastMessage = conversation.last_activity_at;
  const unreadCount = conversation.unread_count || 0;

  // Último mensaje del preview
  const preview = conversation.last_non_activity_message?.content || '';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] ${
        isActive ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent'
      }`}
    >
      {/* Avatar con iniciales */}
      <div className="w-10 h-10 rounded-full bg-base-elevated border border-base-border flex items-center justify-center shrink-0">
        <span className="text-xs font-medium text-gray-300">{getInitials(name)}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-sm font-medium text-white truncate">{name}</span>
          <span className="text-[10px] text-gray-600 shrink-0">{formatTimestamp(lastMessage)}</span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs text-gray-500 truncate">{preview || phone}</span>
          {unreadCount > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-accent text-[10px] font-bold text-base flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Burbuja de mensaje individual */
function MessageBubble({ message }) {
  // message_type: 0 = incoming (del cliente), 1 = outgoing (del agente)
  const isOutgoing = message.message_type === 1 || message.message_type === 'outgoing';
  const time = formatMessageTime(message.created_at);

  if (!message.content) return null; // ignorar mensajes de actividad sin contenido visible

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isOutgoing
            ? 'bg-accent/20 border border-accent/30 text-white rounded-br-sm'
            : 'bg-base-elevated border border-base-border text-gray-200 rounded-bl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p className={`text-[10px] mt-1 ${isOutgoing ? 'text-accent/60 text-right' : 'text-gray-600'}`}>
          {time}
        </p>
      </div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function Inbox() {
  const [conversations, setConversations]     = useState([]);
  const [activeConvId, setActiveConvId]       = useState(null);
  const [messages, setMessages]               = useState([]);
  const [search, setSearch]                   = useState('');
  const [loadingConvs, setLoadingConvs]       = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending]                 = useState(false);
  const [replyText, setReplyText]             = useState('');

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  // Conversación activa completa
  const activeConversation = conversations.find((c) => c.id === activeConvId) || null;
  const activeContact = activeConversation?.meta?.sender || {};
  const activeName = activeContact.name || activeContact.phone_number || 'Conversación';
  const activePhone = activeContact.phone_number || '';

  // ── Fetch conversaciones ──────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/inbox/conversations?page=1');
      // Chatwoot devuelve { data: { payload: [...] } } o similar
      const payload = res.data?.payload || res.data || [];
      setConversations(Array.isArray(payload) ? payload : []);
    } catch (err) {
      if (loadingConvs) toast.error('Error al cargar conversaciones');
    } finally {
      setLoadingConvs(false);
    }
  }, [loadingConvs]);

  usePolling(fetchConversations, 4000, true);
  useEffect(() => { fetchConversations(); }, []); // eslint-disable-line

  // ── Fetch mensajes de la conversación activa ──────────────────────────────

  const fetchMessages = useCallback(async () => {
    if (!activeConvId) return;
    try {
      const res = await api.get(`/inbox/conversations/${activeConvId}/messages`);
      // Chatwoot: { payload: [...messages...] }
      const payload = res.data?.payload || res.data || [];
      const msgs = Array.isArray(payload) ? payload : [];
      // Ordenar por created_at ascendente (más antiguos primero)
      msgs.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      setMessages(msgs);
    } catch {
      // silencioso en polling
    } finally {
      setLoadingMessages(false);
    }
  }, [activeConvId]);

  usePolling(fetchMessages, 4000, !!activeConvId);

  useEffect(() => {
    if (activeConvId) {
      setLoadingMessages(true);
      setMessages([]);
      fetchMessages();
    }
  }, [activeConvId]); // eslint-disable-line

  // Auto-scroll al último mensaje cuando llegan nuevos
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Enviar respuesta ──────────────────────────────────────────────────────

  async function handleSend() {
    const text = replyText.trim();
    if (!text || !activeConvId || sending) return;

    setSending(true);
    try {
      await api.post(`/inbox/conversations/${activeConvId}/messages`, { message: text });
      setReplyText('');
      // Refrescar mensajes de inmediato tras enviar
      await fetchMessages();
    } catch (err) {
      toast.error(err.message || 'Error al enviar el mensaje');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Filtro de búsqueda ────────────────────────────────────────────────────

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const name = conv.meta?.sender?.name || '';
    const phone = conv.meta?.sender?.phone_number || '';
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || phone.includes(q);
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // El inbox ocupa toda la pantalla restante — sobreescribe el padding del layout
    <div className="-m-6 lg:-m-8 h-screen flex animate-fade-in overflow-hidden">

      {/* ─── Sidebar izquierdo: lista de conversaciones ─────────────────── */}
      <div className="w-[320px] shrink-0 flex flex-col border-r border-base-border bg-base-surface">

        {/* Header del sidebar */}
        <div className="px-4 py-4 border-b border-base-border">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <InboxIcon size={18} className="text-accent" />
              Bandeja
            </h1>
            <button
              onClick={fetchConversations}
              className="text-gray-500 hover:text-gray-300 transition-colors p-1"
              title="Actualizar"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Búsqueda */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar contacto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-base-elevated border border-base-border rounded-lg text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent/40"
            />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            Array.from({ length: 6 }).map((_, i) => <ConversationSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare size={28} className="mx-auto text-gray-700 mb-2" />
              <p className="text-sm text-gray-600">
                {search ? 'Sin resultados' : 'No hay conversaciones'}
              </p>
            </div>
          ) : (
            filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConvId}
                onClick={() => setActiveConvId(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ─── Panel derecho: conversación activa ─────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-base">

        {activeConvId ? (
          <>
            {/* Header de la conversación */}
            <div className="px-5 py-4 border-b border-base-border bg-base-surface flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-base-elevated border border-base-border flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-gray-300">{getInitials(activeName)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{activeName}</p>
                {activePhone && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Phone size={10} />
                    {activePhone}
                  </p>
                )}
              </div>
            </div>

            {/* Área de mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMessages ? (
                <MessageSkeleton />
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <MessageSquare size={28} className="text-gray-700 mb-2" />
                  <p className="text-sm text-gray-600">No hay mensajes aún</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de respuesta */}
            <div className="px-4 py-3 border-t border-base-border bg-base-surface shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Escribí tu respuesta... (Enter para enviar)"
                  className="flex-1 px-4 py-2.5 bg-base-elevated border border-base-border rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40 resize-none leading-relaxed"
                  style={{ maxHeight: '120px', overflowY: 'auto' }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !replyText.trim()}
                  className={`p-2.5 rounded-xl transition-all shrink-0 ${
                    sending || !replyText.trim()
                      ? 'bg-base-elevated text-gray-600 cursor-not-allowed'
                      : 'bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30'
                  }`}
                  title="Enviar (Enter)"
                >
                  <Send size={16} className={sending ? 'animate-pulse' : ''} />
                </button>
              </div>
              <p className="text-[10px] text-gray-700 mt-1.5 pl-1">
                El mensaje se envía por WhatsApp y se registra en Chatwoot
              </p>
            </div>
          </>
        ) : (
          /* Estado vacío: ninguna conversación seleccionada */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-accent" />
            </div>
            <h2 className="text-lg font-display font-bold text-white mb-2">
              Bandeja de entrada
            </h2>
            <p className="text-sm text-gray-500 max-w-xs">
              Seleccioná una conversación de la izquierda para ver los mensajes y responder.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
