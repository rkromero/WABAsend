/**
 * Pantalla de ingreso (admin y vendedores). Mobile-first.
 */
import React, { useState } from 'react';
import { MessageCircle, Eye, EyeOff } from 'lucide-react';
import api from '../lib/api.js';
import { saveSession } from '../lib/auth.js';

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { usuario, password });
      saveSession(res.data.token, res.data.user);
      onLogin(res.data.user);
    } catch (err) {
      setError(err.message || 'No se pudo ingresar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wa fixed inset-0 overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 wa-safe-top wa-safe-bottom">
        <div className="w-20 h-20 rounded-full bg-wa-green flex items-center justify-center text-white shadow-lg">
          <MessageCircle size={40} strokeWidth={2} />
        </div>
        <h1 className="mt-5 text-[24px] font-semibold">Ingresá a tu cuenta</h1>
        <p className="mt-1 text-[14.5px] text-wa-sub text-center">Usá el usuario y contraseña que te dio el administrador.</p>

        <form onSubmit={submit} className="w-full max-w-sm mt-8 space-y-4">
          <label className="block">
            <span className="text-[13px] text-wa-sub pl-1">Usuario</span>
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              className="mt-1 w-full h-12 px-4 rounded-xl bg-wa-panel outline-none text-[16px] border-2 border-transparent focus:border-wa-green"
            />
          </label>
          <label className="block">
            <span className="text-[13px] text-wa-sub pl-1">Contraseña</span>
            <div className="mt-1 flex items-center rounded-xl bg-wa-panel border-2 border-transparent focus-within:border-wa-green">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="flex-1 h-12 px-4 bg-transparent outline-none text-[16px] min-w-0"
              />
              <button type="button" onClick={() => setShow((v) => !v)} className="px-3 text-wa-sub" aria-label="Mostrar contraseña">
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </label>

          {error && <p className="text-[14px] text-red-500 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading || !usuario || !password}
            className="w-full h-12 rounded-full bg-wa-green text-white text-[16px] font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
