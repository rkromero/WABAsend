import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Templates from './pages/Templates.jsx';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import Settings from './pages/Settings.jsx';
import Inbox from './pages/Inbox.jsx';

export default function App() {
  const location = useLocation();
  // El inbox ocupa toda la pantalla — no queremos el padding del layout
  const isInbox = location.pathname === '/inbox';

  return (
    <div className="flex h-screen overflow-hidden bg-base font-body">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        )}
      </main>
    </div>
  );
}
