/**
 * Rutas de base de conocimiento del bot
 * Autor: Turnio
 * Fecha: 2026-03-23
 *
 * Almacena artículos de conocimiento (políticas, FAQs, info general) que el bot
 * usa como contexto adicional para responder preguntas de clientes.
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/knowledge — lista todos los artículos
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, titulo, tipo, contenido, activo, created_at, updated_at
       FROM waba_knowledge
       ORDER BY tipo ASC, titulo ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Knowledge] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/knowledge/active — solo los activos (usado por el bot)
router.get('/active', async (req, res) => {
  try {
    const result = await query(
      `SELECT titulo, tipo, contenido
       FROM waba_knowledge
       WHERE activo = true
       ORDER BY tipo ASC, titulo ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Knowledge] GET /active error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/knowledge — crear artículo
router.post('/', async (req, res) => {
  const { titulo, tipo, contenido } = req.body;

  if (!titulo?.trim() || !contenido?.trim()) {
    return res.status(400).json({
      success: false,
      error: 'titulo y contenido son requeridos',
    });
  }

  const tiposValidos = ['faq', 'politica', 'info', 'otro'];
  const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'info';

  try {
    const result = await query(
      `INSERT INTO waba_knowledge (titulo, tipo, contenido)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [titulo.trim(), tipoFinal, contenido.trim()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Knowledge] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/knowledge/:id — actualizar artículo
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  const { titulo, tipo, contenido, activo } = req.body;

  try {
    const result = await query(
      `UPDATE waba_knowledge
       SET titulo     = COALESCE($1, titulo),
           tipo       = COALESCE($2, tipo),
           contenido  = COALESCE($3, contenido),
           activo     = COALESCE($4, activo),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        titulo?.trim() || null,
        tipo || null,
        contenido?.trim() || null,
        activo !== undefined ? activo : null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Knowledge] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/knowledge/:id — eliminar artículo
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  try {
    const result = await query(
      'DELETE FROM waba_knowledge WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
    }
    res.json({ success: true, data: { deleted: id } });
  } catch (err) {
    console.error('[Knowledge] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
