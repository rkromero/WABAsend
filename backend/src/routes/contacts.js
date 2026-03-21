/**
 * Rutas de gestión de contactos
 * Autor: Turnio
 * Fecha: 2026-03-18
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/contacts/segments — lista de segmentos únicos existentes
router.get('/segments', async (req, res) => {
  try {
    const result = await query(
      `SELECT segmento, COUNT(*) AS total
       FROM waba_contacts
       WHERE segmento IS NOT NULL AND segmento != ''
       GROUP BY segmento
       ORDER BY segmento ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
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

// GET /api/contacts — lista contactos con paginación, búsqueda y filtro de segmento
router.get('/', async (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const limit    = Math.min(10000, Math.max(1, parseInt(req.query.limit) || 20));
  const search   = req.query.search  ? String(req.query.search).trim()  : '';
  const segmento = req.query.segmento ? String(req.query.segmento).trim() : '';
  const offset   = (page - 1) * limit;

  try {
    const conditions = ['1=1'];
    const dataParams  = [limit, offset];
    const countParams = [];

    if (search) {
      const idx = dataParams.length + 1;
      conditions.push(`(nombre ILIKE $${idx} OR telefono ILIKE $${idx} OR email ILIKE $${idx} OR segmento ILIKE $${idx})`);
      dataParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    if (segmento) {
      const dataIdx  = dataParams.length + 1;
      const countIdx = countParams.length + 1;
      conditions.push(`segmento = $${dataIdx}`);
      dataParams.push(segmento);
      // Para el count, el índice puede ser diferente si también hay search
      countParams.push(segmento);
    }

    const whereStr = `WHERE ${conditions.join(' AND ')}`;

    // Reconstruir los índices del count correctamente
    let countWhere = 'WHERE 1=1';
    const cleanCountParams = [];
    if (search) {
      cleanCountParams.push(`%${search}%`);
      countWhere += ` AND (nombre ILIKE $${cleanCountParams.length} OR telefono ILIKE $${cleanCountParams.length} OR email ILIKE $${cleanCountParams.length} OR segmento ILIKE $${cleanCountParams.length})`;
    }
    if (segmento) {
      cleanCountParams.push(segmento);
      countWhere += ` AND segmento = $${cleanCountParams.length}`;
    }

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, nombre, telefono, email, segmento, created_at
         FROM waba_contacts
         ${whereStr}
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        dataParams
      ),
      query(
        `SELECT COUNT(*) as total FROM waba_contacts ${countWhere}`,
        cleanCountParams
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        contacts: dataResult.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error('[Contacts] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contacts/bulk — importar múltiples contactos desde Excel
router.post('/bulk', async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ success: false, error: 'Se requiere un array de contactos' });
  }
  if (contacts.length > 10000) {
    return res.status(400).json({ success: false, error: 'Máximo 10.000 contactos por importación' });
  }

  let imported = 0, skipped = 0;
  const errors = [];

  for (const contact of contacts) {
    const nombre   = String(contact.nombre   || '').trim();
    const telefono = String(contact.telefono || '').replace(/\D/g, '');
    const email    = contact.email    ? String(contact.email).trim().toLowerCase()    : null;
    const segmento = contact.segmento ? String(contact.segmento).trim()               : null;

    if (!nombre) {
      errors.push({ telefono, error: 'Nombre vacío' }); skipped++; continue;
    }
    if (telefono.length < 10 || telefono.length > 15) {
      errors.push({ nombre, telefono: telefono || '(vacío)', error: `Teléfono inválido: "${telefono}" (${telefono.length} dígitos)` });
      skipped++; continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ nombre, telefono, error: `Email inválido: "${email}"` }); skipped++; continue;
    }

    try {
      const existing = await query('SELECT id FROM waba_contacts WHERE telefono = $1', [telefono]);
      if (existing.rows.length > 0) {
        await query(
          `UPDATE waba_contacts
           SET nombre = $1, email = COALESCE($2, email), segmento = COALESCE($3, segmento)
           WHERE telefono = $4`,
          [nombre, email, segmento, telefono]
        );
      } else {
        await query(
          'INSERT INTO waba_contacts (nombre, telefono, email, segmento) VALUES ($1, $2, $3, $4)',
          [nombre, telefono, email, segmento]
        );
      }
      imported++;
    } catch (rowErr) {
      errors.push({ nombre, telefono, error: rowErr.message }); skipped++;
    }
  }

  res.json({ success: true, data: { imported, skipped, errors: errors.slice(0, 50) } });
});

// PUT /api/contacts/:id — editar teléfono (y opcionalmente nombre, email, segmento)
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  const { nombre, telefono, email, segmento } = req.body;

  if (telefono !== undefined) {
    const telLimpio = String(telefono).replace(/\D/g, '');
    if (telLimpio.length < 10 || telLimpio.length > 15) {
      return res.status(400).json({
        success: false,
        error: `Teléfono inválido: "${telLimpio}" — debe tener entre 10 y 15 dígitos`,
      });
    }
  }

  try {
    const result = await query(
      `UPDATE waba_contacts
       SET nombre   = COALESCE($1, nombre),
           telefono = COALESCE($2, telefono),
           email    = COALESCE($3, email),
           segmento = COALESCE($4, segmento)
       WHERE id = $5
       RETURNING *`,
      [
        nombre   || null,
        telefono ? String(telefono).replace(/\D/g, '') : null,
        email    || null,
        segmento || null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Contacts] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
  try {
    const result = await query('DELETE FROM waba_contacts WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    res.json({ success: true, data: { deleted: id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contacts — eliminar todos
router.delete('/', async (req, res) => {
  try {
    const result = await query('DELETE FROM waba_contacts RETURNING id');
    res.json({ success: true, data: { deleted: result.rowCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
