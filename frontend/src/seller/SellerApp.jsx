/**
 * App del vendedor — pensada 100% para celular, con look & feel de WhatsApp.
 * Solo expone la bandeja de entrada (chats) y el catálogo de productos.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import api from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { playNotificationSound } from './waUtils.js';
import { setAppBadge, ensurePushSubscription } from '../lib/pwa.js';
import ChatList from './ChatList.jsx';
import ChatView from './ChatView.jsx';
import ProductsView from './ProductsView.jsx';

export default function SellerApp({ user }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tags, setTags] = useState({});
  const prevUnread = useRef(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/inbox/conversations?page=1');
      const payload = res.data?.payload || res.data?.data?.payload || [];
      const convs = Array.isArray(payload) ? payload : [];
      convs.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));

      const unread = convs.reduce((s, c) => s + (parseInt(c.unread_count) || 0), 0);
      if (prevUnread.current !== null && unread > prevUnread.current) {
        // Con la app abierta suena adentro; con la app cerrada avisa el push del servidor
        playNotificationSound();
      }
      prevUnread.current = unread;

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
  // Mantener registrada la suscripción push de este dispositivo
  useEffect(() => { ensurePushSubscription(api); }, []);

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
