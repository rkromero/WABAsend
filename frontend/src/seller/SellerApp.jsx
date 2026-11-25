/**
 * App del vendedor — pensada 100% para celular, con look & feel de WhatsApp.
 * Solo expone la bandeja de entrada (chats) y el catálogo de productos.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import api from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { playNotificationSound, contactOf } from './waUtils.js';
import { setAppBadge, showLocalNotification } from '../lib/pwa.js';
import ChatList from './ChatList.jsx';
import ChatView from './ChatView.jsx';
import ProductsView from './ProductsView.jsx';

export default function SellerApp({ user }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tags, setTags] = useState({});
  const prevUnread = useRef(null);
  const prevByConv = useRef({});

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/inbox/conversations?page=1');
      const payload = res.data?.payload || res.data?.data?.payload || [];
      const convs = Array.isArray(payload) ? payload : [];
      convs.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));

      const unread = convs.reduce((s, c) => s + (parseInt(c.unread_count) || 0), 0);
      if (prevUnread.current !== null && unread > prevUnread.current) {
        playNotificationSound();
        // Notificación del sistema por cada chat con mensajes nuevos (si la app está en segundo plano)
        convs
          .filter((c) => (c.unread_count || 0) > (prevByConv.current[c.id] || 0))
          .forEach((c) => {
            const msg = c.last_non_activity_message;
            const body = msg?.content || (msg?.attachments?.length ? '📎 Archivo adjunto' : 'Mensaje nuevo');
            showLocalNotification(contactOf(c).name, body, `/chat/${c.id}`);
          });
      }
      prevUnread.current = unread;
      prevByConv.current = Object.fromEntries(convs.map((c) => [c.id, c.unread_count || 0]));

      setConversations(convs);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.get('/inbox/tags');
      setTags(res.data || {});
    } catch { /* noop */ }
  }, []);

  usePolling(fetchConversations, 4000, true);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  const totalUnread = conversations.reduce((s, c) => s + (parseInt(c.unread_count) || 0), 0);
  const chatsWithUnread = conversations.filter((c) => c.unread_count > 0).length;

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Ventas` : 'Ventas';
    setAppBadge(totalUnread);
  }, [totalUnread]);

  // Marca como leído de forma optimista
  const markRead = useCallback((convId) => {
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)));
    api.post(`/inbox/conversations/${convId}/read`).catch(() => {});
  }, []);

  const shared = { conversations, loading, error, tags, setTags, user, unread: chatsWithUnread };

  return (
    <div className="wa fixed inset-0 flex flex-col overflow-hidden">
      <Routes>
        <Route path="/" element={<ChatList {...shared} />} />
        <Route
          path="/chat/:id"
          element={<ChatView {...shared} markRead={markRead} refreshList={fetchConversations} />}
        />
        <Route path="/productos" element={<ProductsView {...shared} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
