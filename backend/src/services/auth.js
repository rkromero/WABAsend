/**
 * Autenticación y roles — usuarios admin / vendedor
 *
 * - Passwords hasheadas con scrypt (crypto nativo, sin dependencias).
 * - Tokens firmados con HMAC-SHA256 (formato payload.firma en base64url).
 * - Secreto: env AUTH_SECRET, o uno aleatorio persistido en `config` (_AUTH_SECRET).
 * - El primer admin se crea desde env ADMIN_USER / ADMIN_PASSWORD.
 */

import crypto from 'crypto';
import { query } from '../db/index.js';

export const ROLES = ['admin', 'vendedor'];
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — el vendedor usa el celular todo el día

let authSecret = null;

// ── Passwords ────────────────────────────────────────────────────────────────

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

// ── Tokens ───────────────────────────────────────────────────────────────────

function sign(data) {
  return crypto.createHmac('sha256', authSecret).update(data).digest('base64url');
}

export function createToken(user) {
  const payload = {
    uid: user.id,
    role: user.rol,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

function verifyToken(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Esquema + bootstrap ──────────────────────────────────────────────────────

export async function initAuth() {
  await query(`
    CREATE TABLE IF NOT EXISTS waba_users (
      id            SERIAL PRIMARY KEY,
      nombre        VARCHAR(100) NOT NULL,
      usuario       VARCHAR(50)  NOT NULL UNIQUE,
      password_hash TEXT         NOT NULL,
      rol           VARCHAR(20)  NOT NULL DEFAULT 'vendedor',
      activo        BOOLEAN      NOT NULL DEFAULT true,
      created_at    TIMESTAMP DEFAULT NOW(),
      updated_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  // Secreto de firma
  if (process.env.AUTH_SECRET) {
    authSecret = process.env.AUTH_SECRET;
  } else {
    const existing = await query(`SELECT value FROM config WHERE key = '_AUTH_SECRET'`);
    if (existing.rows[0]?.value) {
      authSecret = existing.rows[0].value;
    } else {
      authSecret = crypto.randomBytes(48).toString('hex');
      await query(
        `INSERT INTO config (key, value) VALUES ('_AUTH_SECRET', $1) ON CONFLICT (key) DO NOTHING`,
        [authSecret]
      );
    }
  }

  // Admin inicial desde env (solo si no existe ese usuario)
  const adminUser = process.env.ADMIN_USER?.trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminUser && adminPass) {
    const res = await query(
      `INSERT INTO waba_users (nombre, usuario, password_hash, rol)
       VALUES ('Administrador', $1, $2, 'admin')
       ON CONFLICT (usuario) DO NOTHING RETURNING id`,
      [adminUser, hashPassword(adminPass)]
    );
    if (res.rows.length) console.log(`[Auth] Admin inicial "${adminUser}" creado`);
  }

  const admins = await query(`SELECT COUNT(*)::int AS n FROM waba_users WHERE rol = 'admin' AND activo`);
  if (admins.rows[0].n === 0) {
    console.warn('[Auth] ⚠ No hay ningún admin. Definí ADMIN_USER y ADMIN_PASSWORD y reiniciá el servidor.');
  }
}

// ── Middlewares ──────────────────────────────────────────────────────────────

/** Verifica el token Bearer y carga req.user (consulta la DB para respetar bajas). */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Sesión inválida o vencida' });
  }

  try {
    const result = await query(
      'SELECT id, nombre, usuario, rol, activo FROM waba_users WHERE id = $1',
      [payload.uid]
    );
    const user = result.rows[0];
    if (!user || !user.activo) {
      return res.status(401).json({ success: false, error: 'Usuario deshabilitado' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Permisos del vendedor: solo bandeja (sin borrar conversaciones ni editar
 * respuestas rápidas) y lectura del catálogo de productos.
 */
const VENDEDOR_ALLOWED = [
  { method: 'GET', re: /^\/inbox\/conversations\/?$/ },
  { method: 'GET', re: /^\/inbox\/conversations\/\d+\/(messages|bot-status)$/ },
  { method: 'POST', re: /^\/inbox\/conversations\/\d+\/(messages|media|audio|template|read|takeover|release|tags)$/ },
  { method: 'DELETE', re: /^\/inbox\/conversations\/\d+\/tags\/[^/]+$/ },
  { method: 'GET', re: /^\/inbox\/(tags|quick-replies|templates)$/ },
  { method: 'GET', re: /^\/products\/?$/ },
  { method: 'GET', re: /^\/push\/public-key$/ },
  { method: 'POST', re: /^\/push\/(subscribe|unsubscribe)$/ },
];

/** Se monta en /api — req.path es relativo (ej: /inbox/conversations). */
export function enforceRole(req, res, next) {
  if (req.user?.rol === 'admin') return next();
  if (req.user?.rol === 'vendedor') {
    const ok = VENDEDOR_ALLOWED.some((r) => r.method === req.method && r.re.test(req.path));
    if (ok) return next();
  }
  return res.status(403).json({ success: false, error: 'No tenés permiso para esta acción' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.rol === 'admin') return next();
  return res.status(403).json({ success: false, error: 'Solo administradores' });
}
