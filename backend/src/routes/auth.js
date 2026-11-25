/**
 * Rutas de autenticación y gestión de usuarios
 *
 * POST   /api/auth/login        — público
 * GET    /api/auth/me           — usuario logueado
 * GET    /api/auth/users        — admin
 * POST   /api/auth/users        — admin
 * PUT    /api/auth/users/:id    — admin
 * DELETE /api/auth/users/:id    — admin
 */

import { Router } from 'express';
import { query } from '../db/index.js';
import {
  ROLES, hashPassword, verifyPassword, createToken, requireAuth, requireAdmin,
} from '../services/auth.js';

const router = Router();

const USER_RE = /^[a-z0-9._-]{3,50}$/;

// Rate limit simple en memoria para el login: 10 intentos fallidos / 15 min por IP
const failedLogins = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) return false;
  return entry.count >= 10;
}
function registerFailure(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failedLogins.set(ip, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

function publicUser(u) {
  return { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, activo: u.activo };
}

router.post('/login', async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ success: false, error: 'Demasiados intentos. Probá en unos minutos.' });
  }

  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!usuario || !password) {
    return res.status(400).json({ success: false, error: 'Usuario y contraseña son requeridos' });
  }

  try {
    const result = await query('SELECT * FROM waba_users WHERE usuario = $1', [usuario]);
    const user = result.rows[0];
    if (!user || !user.activo || !verifyPassword(password, user.password_hash)) {
      registerFailure(ip);
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }
    failedLogins.delete(ip);
    res.json({ success: true, data: { token: createToken(user), user: publicUser(user) } });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    res.status(500).json({ success: false, error: 'Error al iniciar sesión' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
});

// ── Gestión de usuarios (solo admin) ────────────────────────────────────────

router.use('/users', requireAuth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, nombre, usuario, rol, activo, created_at FROM waba_users ORDER BY rol, nombre'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/users', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim().substring(0, 100);
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const rol = ROLES.includes(req.body?.rol) ? req.body.rol : 'vendedor';

  if (!nombre) return res.status(400).json({ success: false, error: 'El nombre es requerido' });
  if (!USER_RE.test(usuario)) {
    return res.status(400).json({
      success: false,
      error: 'Usuario inválido: 3-50 caracteres, solo letras minúsculas, números, punto, guion',
    });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const result = await query(
      `INSERT INTO waba_users (nombre, usuario, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, usuario, rol, activo, created_at`,
      [nombre, usuario, hashPassword(password), rol]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Ese usuario ya existe' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (req.body?.nombre !== undefined) {
    const nombre = String(req.body.nombre).trim().substring(0, 100);
    if (!nombre) return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    add('nombre', nombre);
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    add('password_hash', hashPassword(req.body.password));
  }
  if (req.body?.rol !== undefined) {
    if (!ROLES.includes(req.body.rol)) return res.status(400).json({ success: false, error: 'Rol inválido' });
    add('rol', req.body.rol);
  }
  if (req.body?.activo !== undefined) add('activo', !!req.body.activo);

  if (sets.length === 0) return res.status(400).json({ success: false, error: 'Nada para actualizar' });

  // Evitar que un admin se quite a sí mismo el acceso de admin
  if (id === req.user.id && (req.body?.rol === 'vendedor' || req.body?.activo === false)) {
    return res.status(400).json({ success: false, error: 'No podés quitarte tu propio acceso de admin' });
  }

  try {
    params.push(id);
    const result = await query(
      `UPDATE waba_users SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, nombre, usuario, rol, activo, created_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
  if (id === req.user.id) {
    return res.status(400).json({ success: false, error: 'No podés eliminar tu propio usuario' });
  }
  try {
    await query('DELETE FROM waba_users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
