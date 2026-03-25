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
  Bot,
  UserCheck,
  Zap,
  X,
  Plus,
  Pencil,
  Trash2,
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

// ─── Sonido de notificación (Web Audio API, sin archivo externo) ─────────────

/**
 * Reproduce un doble beep suave usando Web Audio API.
 * No requiere ningún archivo de audio. Funciona en todos los browsers modernos.
 * Los browsers bloquean el audio hasta la primera interacción del usuario
 * con la página — después de eso funciona sin restricciones.
 */
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function beep(startTime, freq = 880) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
      osc.start(startTime);
      osc.stop(startTime + 0.18);
    }

    beep(ctx.currentTime,       880); // primer tono
    beep(ctx.currentTime + 0.2, 1100); // segundo tono más agudo
  } catch {
    // Silencioso si el browser no soporta Web Audio API
  }
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
  const [botPaused, setBotPaused]             = useState(false);
  const [togglingBot, setTogglingBot]         = useState(false);

  // ── Mensajes rápidos ──────────────────────────────────────────────────────
  const [quickReplies, setQuickReplies]       = useState([]);
  const [showQRPanel, setShowQRPanel]         = useState(false);
  const [showQRModal, setShowQRModal]         = useState(false);
  const [qrForm, setQrForm]                   = useState({ titulo: '', mensaje: '' });
  const [qrEditing, setQrEditing]             = useState(null); // id being edited
  const [savingQR, setSavingQR]               = useState(false);

  const messagesEndRef    = useRef(null);
  const inputRef          = useRef(null);
  // Ref para detectar nuevos mensajes sin re-renders: guarda el total de
  // unread_count de la última vez que se cargaron las conversaciones.
  // null = carga inicial (no reproducir sonido la primera vez).
  const prevUnreadTotal   = useRef(null);

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
      const convs = Array.isArray(payload) ? payload : [];

      // Calcular el total de mensajes no leídos en esta carga
      const unreadTotal = convs.reduce((sum, c) => sum + (parseInt(c.unread_count) || 0), 0);

      // Si hay más unreads que antes → llegaron mensajes nuevos → reproducir sonido
      // prevUnreadTotal.current === null significa que es la primera carga (no sonar)
      if (prevUnreadTotal.current !== null && unreadTotal > prevUnreadTotal.current) {
        playNotificationSound();
      }
      prevUnreadTotal.current = unreadTotal;

      setConversations(convs);
    } catch (err) {
      if (loadingConvs) toast.error('Error al cargar conversaciones');
    } finally {
      setLoadingConvs(false);
    }
  }, [loadingConvs]);

  // ── Marcar conversación como leída ────────────────────────────────────────

  /**
   * Al abrir una conversación:
   * 1. Actualización optimista: borra el badge en el estado local inmediatamente.
   * 2. Llama al backend en background para avisar a Chatwoot (no bloqueante).
   */
  function openConversation(convId) {
    setActiveConvId(convId);

    // Optimistic update: zerear unread_count para que el badge desaparezca al instante
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, unread_count: 0 } : c)
    );

    // Avisar a Chatwoot en background — si falla no importa, el polling lo corregirá
    api.post(`/inbox/conversations/${convId}/read`).catch(() => {});
  }

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
      fetchBotStatus();
    }
  }, [activeConvId]); // eslint-disable-line

  // Auto-scroll al último mensaje cuando llegan nuevos
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Estado del bot para la conversación activa ────────────────────────────

  const fetchBotStatus = useCallback(async () => {
    if (!activeConvId) return;
    try {
      const res = await api.get(`/inbox/conversations/${activeConvId}/bot-status`);
      setBotPaused(res.data?.bot_paused ?? false);
    } catch {
      // Si falla, asumimos bot activo (no silenciamos por defecto)
      setBotPaused(false);
    }
  }, [activeConvId]);

  async function handleToggleBot() {
    if (!activeConvId || togglingBot) return;
    setTogglingBot(true);
    try {
      const endpoint = botPaused ? 'release' : 'takeover';
      await api.post(`/inbox/conversations/${activeConvId}/${endpoint}`);
      setBotPaused(!botPaused);
      toast.success(botPaused ? 'Bot reactivado para esta conversación' : 'Tomaste el control — bot pausado');
    } catch (err) {
      toast.error('No se pudo cambiar el modo');
    } finally {
      setTogglingBot(false);
    }
  }

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

  // ── Mensajes rápidos: fetch + CRUD ───────────────────────────────────────

  const fetchQuickReplies = useCallback(async () => {
    try {
      const res = await api.get('/inbox/quick-replies');
      setQuickReplies(res.data?.data || []);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { fetchQuickReplies(); }, [fetchQuickReplies]);

  function openQRCreate() {
    setQrEditing(null);
    setQrForm({ titulo: '', mensaje: '' });
    setShowQRModal(true);
  }

  function openQREdit(qr) {
    setQrEditing(qr.id);
    setQrForm({ titulo: qr.titulo, mensaje: qr.mensaje });
    setShowQRModal(true);
  }

  async function handleSaveQR() {
    if (!qrForm.titulo.trim() || !qrForm.mensaje.trim()) return;
    setSavingQR(true);
    try {
      if (qrEditing) {
        await api.put(`/inbox/quick-replies/${qrEditing}`, qrForm);
      } else {
        await api.post('/inbox/quick-replies', qrForm);
      }
      await fetchQuickReplies();
      setShowQRModal(false);
    } catch (err) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSavingQR(false);
    }
  }

  async function handleDeleteQR(id) {
    if (!window.confirm('¿Eliminar este mensaje rápido?')) return;
    try {
      await api.delete(`/inbox/quick-replies/${id}`);
      setQuickReplies((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      toast.error(err.message || 'Error al eliminar');
    }
  }

  function applyQuickReply(mensaje) {
    setReplyText(mensaje);
    setShowQRPanel(false);
    inputRef.current?.focus();
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
    <div className="h-full flex animate-fade-in overflow-hidden">

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
                onClick={() => openConversation(conv.id)}
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

              {/* Botón takeover / release */}
              <button
                onClick={handleToggleBot}
                disabled={togglingBot}
                title={botPaused ? 'Devolver al bot' : 'Tomar conversación (pausar bot)'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 disabled:opacity-50 ${
                  botPaused
                    ? 'bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20'
                    : 'bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20'
                }`}
              >
                {botPaused ? (
                  <><Bot size={13} /> Devolver al bot</>
                ) : (
                  <><UserCheck size={13} /> Tomar conversación</>
                )}
              </button>
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

              {/* Panel de mensajes rápidos — se muestra sobre el textarea */}
              {showQRPanel && (
                <div className="mb-2 bg-base-elevated border border-base-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-base-border">
                    <span className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                      <Zap size={11} className="text-yellow-400" />
                      Mensajes rápidos
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowQRPanel(false); openQRCreate(); }}
                        className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5"
                      >
                        <Plus size={10} /> Nuevo
                      </button>
                      <button
                        onClick={() => { setShowQRPanel(false); openQRCreate(); }}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        Gestionar
                      </button>
                      <button onClick={() => setShowQRPanel(false)} className="text-gray-600 hover:text-gray-400">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {quickReplies.length === 0 ? (
                      <p className="text-xs text-gray-600 text-center py-4">
                        No hay mensajes rápidos. Creá uno con "+ Nuevo".
                      </p>
                    ) : (
                      quickReplies.map((qr) => (
                        <button
                          key={qr.id}
                          onClick={() => applyQuickReply(qr.mensaje)}
                          className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-base-border/50 last:border-0 group"
                        >
                          <p className="text-xs font-medium text-accent truncate">{qr.titulo}</p>
                          <p className="text-[11px] text-gray-400 truncate mt-0.5 leading-snug">{qr.mensaje}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2">
                {/* Botón de mensajes rápidos */}
                <button
                  onClick={() => setShowQRPanel((v) => !v)}
                  title="Mensajes rápidos"
                  className={`p-2.5 rounded-xl transition-all shrink-0 ${
                    showQRPanel
                      ? 'bg-yellow-400/10 border border-yellow-400/30 text-yellow-400'
                      : 'bg-base-elevated border border-base-border text-gray-500 hover:text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <Zap size={15} />
                </button>

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

      {/* ─── Modal: gestión de mensajes rápidos ──────────────────────────── */}
      {showQRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-base-surface border border-base-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-border shrink-0">
              <h2 className="text-sm font-display font-bold text-white flex items-center gap-2">
                <Zap size={14} className="text-yellow-400" />
                Mensajes rápidos
              </h2>
              <button onClick={() => setShowQRModal(false)} className="text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>

            {/* Formulario crear / editar */}
            <div className="px-5 py-4 border-b border-base-border shrink-0 space-y-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">
                {qrEditing ? 'Editar mensaje' : 'Nuevo mensaje'}
              </p>
              <input
                type="text"
                placeholder="Título (ej: Saludo inicial)"
                value={qrForm.titulo}
                onChange={(e) => setQrForm((f) => ({ ...f, titulo: e.target.value }))}
                className="w-full px-3 py-2 bg-base-elevated border border-base-border rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40"
              />
              <textarea
                rows={3}
                placeholder="Texto del mensaje..."
                value={qrForm.mensaje}
                onChange={(e) => setQrForm((f) => ({ ...f, mensaje: e.target.value }))}
                className="w-full px-3 py-2 bg-base-elevated border border-base-border rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40 resize-none leading-relaxed"
              />
              <div className="flex gap-2 justify-end">
                {qrEditing && (
                  <button
                    onClick={() => { setQrEditing(null); setQrForm({ titulo: '', mensaje: '' }); }}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Cancelar edición
                  </button>
                )}
                <button
                  onClick={handleSaveQR}
                  disabled={savingQR || !qrForm.titulo.trim() || !qrForm.mensaje.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-accent/20 border border-accent/30 text-accent rounded-lg text-xs font-medium hover:bg-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={12} />
                  {qrEditing ? 'Guardar cambios' : 'Agregar'}
                </button>
              </div>
            </div>

            {/* Lista de mensajes rápidos existentes */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {quickReplies.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">
                  Aún no hay mensajes rápidos. Creá el primero arriba.
                </p>
              ) : (
                quickReplies.map((qr) => (
                  <div
                    key={qr.id}
                    className="flex items-start gap-3 p-3 bg-base-elevated border border-base-border rounded-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-accent">{qr.titulo}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 leading-snug whitespace-pre-wrap break-words">
                        {qr.mensaje}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => openQREdit(qr)}
                        className="p-1.5 text-gray-500 hover:text-gray-200 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteQR(qr.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-base-border shrink-0 text-right">
              <button
                onClick={() => setShowQRModal(false)}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
