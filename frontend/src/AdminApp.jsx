import React, { useEffect } from 'react';
import { setThemeColor, ensurePushSubscription } from './lib/pwa.js';
import api from './lib/api.js';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Templates from './pages/Templates.jsx';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import Settings from './pages/Settings.jsx';
import Inbox from './pages/Inbox.jsx';
import Bot from './pages/Bot.jsx';
import Products from './pages/Products.jsx';
import Automations from './pages/Automations.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Analytics from './pages/Analytics.jsx';
import Users from './pages/Users.jsx';

export default function AdminApp() {
  const location = useLocation();

  useEffect(() => {
    document.title = 'WABA Sender — Campañas WhatsApp';
    setThemeColor('#0A0A0F');
    ensurePushSubscription(api);
  }, []);
  // El inbox ocupa toda la pantalla — no queremos el padding del layout
  const isInbox = location.pathname === '/inbox';

  return (
    <div className="flex h-screen overflow-hidden bg-base font-body">
      <Sidebar />
      <main className={`flex-1 ${isInbox ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
        {isInbox ? (
          <Routes>
            <Route path="/inbox" element={<Inbox />} />
          </Routes>
        ) : (
          <div className="min-h-full p-6 lg:p-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/campaigns/:id" element={<CampaignDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/bot" element={<Bot />} />
              <Route path="/products" element={<Products />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/users" element={<Users />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        )}
      </main>
    </div>
  );
}
