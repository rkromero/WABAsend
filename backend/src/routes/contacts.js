/**
 * Rutas de gestión de contactos
 * Autor: Turnio
 * Fecha: 2026-03-18
 *
 * NOTA: La tabla se llama `waba_contacts` (no `contacts`) para evitar colisión
 * con la tabla `contacts` que Chatwoot crea en la misma base de datos.
 * El email se usa para tracking de conversiones contra WooCommerce.
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/contacts — lista contactos con paginación y búsqueda
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = req.query.search ? String(req.query.search).trim() : '';
  const offset = (page - 1) * limit;

  try {
    let dataWhere  = '';
    let countWhere = '';
    const dataParams  = [limit, offset];
    const countParams = [];

    if (search) {
      dataWhere  = ' WHERE nombre ILIKE $3 OR telefono ILIKE $3 OR email ILIKE $3';
      countWhere = ' WHERE nombre ILIKE $1 OR telefono ILIKE $1 OR email ILIKE $1';
      dataParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, nombre, telefono, email, created_at
         FROM waba_contacts${dataWhere}
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        dataParams
      ),
      query(
        `SELECT COUNT(*) as total FROM waba_contacts${countWhere}`,
        countParams
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        contacts: dataResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('[Contacts] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/contacts/count — total de contactos (para el dashboard)
router.get('/count', async (req, res) => {
  try {
    const result = await query('SELECT COUNT(*) as total FROM waba_contacts');
    res.json({ success: true, data: { total: parseInt(result.rows[0].total) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contacts/bulk — importar múltiples contactos desde Excel
// Body: { contacts: [{ nombre, telefono, email? }] }
router.post('/bulk', async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ success: false, error: 'Se requiere un array de contactos' });
  }

  if (contacts.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Máximo 10.000 contactos por importación',
    });
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  try {
    for (const contact of contacts) {
      const nombre   = String(contact.nombre || '').trim();
      const telefono = String(contact.telefono || '').replace(/\D/g, '');
      // Email es opcional — lo normalizamos a null si viene vacío
      const email    = contact.email ? String(contact.email).trim().toLowerCase() : null;

      if (!nombre) {
        errors.push({ telefono, error: 'Nombre vacío' });
        skipped++;
        continue;
      }

      if (telefono.length < 10 || telefono.length > 15) {
        errors.push({
          nombre,
          telefono: telefono || '(vacío)',
          error: `Teléfono inválido: "${telefono}" (${telefono.length} dígitos, se esperan 10-15)`,
        });
        skipped++;
        continue;
      }

      // Validación básica de email si se proporcionó
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ nombre, telefono, error: `Email inválido: "${email}"` });
        skipped++;
        continue;
      }

      try {
        const existing = await query(
          'SELECT id FROM waba_contacts WHERE telefono = $1',
          [telefono]
        );

        if (existing.rows.length > 0) {
          // Actualizar nombre y email (si vino con email)
          await query(
            'UPDATE waba_contacts SET nombre = $1, email = COALESCE($2, email) WHERE telefono = $3',
            [nombre, email, telefono]
          );
        } else {
          await query(
            'INSERT INTO waba_contacts (nombre, telefono, email) VALUES ($1, $2, $3)',
            [nombre, telefono, email]
          );
        }
        imported++;
      } catch (rowErr) {
        errors.push({ nombre, telefono, error: rowErr.message });
        skipped++;
      }
    }

    res.json({
      success: true,
      data: { imported, skipped, errors: errors.slice(0, 50) },
    });
  } catch (err) {
    console.error('[Contacts] Bulk import error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contacts/:id — eliminar un contacto
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  try {
    const result = await query('DELETE FROM waba_contacts WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    }
    res.json({ success: true, data: { deleted: id } });
  } catch (err) {
    console.error('[Contacts] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contacts — eliminar todos los contactos
router.delete('/', async (req, res) => {
  try {
    const result = await query('DELETE FROM waba_contacts RETURNING id');
    res.json({ success: true, data: { deleted: result.rowCount } });
  } catch (err) {
    console.error('[Contacts] DELETE all error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
