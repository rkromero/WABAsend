/**
 * Gestión de usuarios (solo admin): alta de vendedores, cambio de contraseña,
 * activar / desactivar y eliminar.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { UserCog, Plus, Trash2, KeyRound, X, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import { getStoredUser } from '../lib/auth.js';

const EMPTY = { nombre: '', usuario: '', password: '', rol: 'vendedor' };

export default function Users() {
  const me = getStoredUser();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null | objeto de alta
  const [pwdFor, setPwdFor] = useState(null); // usuario al que se le cambia la contraseña
  const [newPwd, setNewPwd] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/auth/users', form);
      toast.success('Usuario creado');
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function update(id, body, msg) {
    try {
      await api.put(`/auth/users/${id}`, body);
      toast.success(msg);
      load();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    }
  }

  async function remove(u) {
    if (!window.confirm(`¿Eliminar a ${u.nombre}? No podrá volver a ingresar.`)) return;
    try {
      await api.delete(`/auth/users/${u.id}`);
      toast.success('Usuario eliminado');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function savePwd(e) {
    e.preventDefault();
    setSaving(true);
    if (await update(pwdFor.id, { password: newPwd }, 'Contraseña actualizada')) {
      setPwdFor(null);
      setNewPwd('');
    }
    setSaving(false);
  }

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <UserCog className="text-accent" size={24} /> Usuarios
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Los vendedores solo ven la bandeja de entrada y los productos, en una vista para celular estilo WhatsApp.
          </p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setForm({ ...EMPTY })}>
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      {form && (
        <form onSubmit={create} className="glass-card p-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="form-label">Nombre</label>
            <input className="input-field" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Juana Pérez" required />
          </div>
          <div>
            <label className="form-label">Usuario</label>
            <input
              className="input-field"
              value={form.usuario}
              onChange={(e) => setForm({ ...form, usuario: e.target.value.toLowerCase().replace(/\s/g, '') })}
              placeholder="ej: juana"
              autoCapitalize="none"
              required
            />
          </div>
          <div>
            <label className="form-label">Contraseña</label>
            <input className="input-field" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" minLength={6} required />
          </div>
          <div>
            <label className="form-label">Rol</label>
            <select className="input-field" value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
              <option value="vendedor">Vendedor (bandeja + productos)</option>
              <option value="admin">Administrador (acceso total)</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</button>
          </div>
        </form>
      )}

      <div className="glass-card divide-y divide-white/5">
        {loading && <div className="p-6 text-sm text-gray-500">Cargando…</div>}
        {!loading && users.length === 0 && <div className="p-6 text-sm text-gray-500">No hay usuarios.</div>}
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${u.activo ? 'text-white' : 'text-gray-500 line-through'}`}>{u.nombre}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  u.rol === 'admin' ? 'text-purple-400 bg-purple-400/10 border-purple-400/30' : 'text-accent bg-accent/10 border-accent/30'
                }`}>
                  {u.rol === 'admin' ? 'Admin' : 'Vendedor'}
                </span>
                {!u.activo && <span className="text-[10px] text-gray-500">desactivado</span>}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">@{u.usuario}</p>
            </div>
            <button className="btn-secondary !px-3" title="Cambiar contraseña" onClick={() => { setPwdFor(u); setNewPwd(''); }}>
              <KeyRound size={15} />
            </button>
            {u.id !== me?.id && (
              <>
                <button
                  className="btn-secondary !px-3"
                  title={u.activo ? 'Desactivar' : 'Activar'}
                  onClick={() => update(u.id, { activo: !u.activo }, u.activo ? 'Usuario desactivado' : 'Usuario activado')}
                >
                  <Power size={15} className={u.activo ? 'text-accent' : 'text-gray-500'} />
                </button>
                <button className="btn-danger !px-3" title="Eliminar" onClick={() => remove(u)}>
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {pwdFor && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPwdFor(null)}>
          <form onSubmit={savePwd} onClick={(e) => e.stopPropagation()} className="glass-card w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-white">Nueva contraseña</h2>
              <button type="button" onClick={() => setPwdFor(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-400">Para <span className="text-white">{pwdFor.nombre}</span> (@{pwdFor.usuario})</p>
            <input className="input-field" type="text" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} required autoFocus />
            <button type="submit" className="btn-primary w-full" disabled={saving}>Guardar</button>
          </form>
        </div>
      )}
    </div>
  );
}
