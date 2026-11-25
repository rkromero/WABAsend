import React, { useState, useEffect, lazy, Suspense } from 'react';
import Login from './pages/Login.jsx';
import api from './lib/api.js';
import { getToken, getStoredUser, saveSession } from './lib/auth.js';

// Carga diferida: el vendedor (celular) no descarga el panel admin y viceversa
const AdminApp = lazy(() => import('./AdminApp.jsx'));
const SellerApp = lazy(() => import('./seller/SellerApp.jsx'));

export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));

  // Revalida la sesión al abrir (rol actualizado, usuario desactivado, etc.)
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.get('/auth/me')
      .then((res) => { saveSession(token, res.data); setUser(res.data); })
      .catch(() => { /* 401 → logout automático en api.js; error de red → sigue con la sesión guardada */ });
  }, []);

  if (!user) return <Login onLogin={setUser} />;
  return (
    <Suspense fallback={null}>
      {user.rol === 'vendedor' ? <SellerApp user={user} /> : <AdminApp />}
    </Suspense>
  );
}
