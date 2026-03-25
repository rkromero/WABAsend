/**
 * Rutas de gestión de opt-outs (bajas voluntarias)
 * Autor: Turnio
 * Fecha: 2026-03-24
 *
 * Los contactos en waba_optouts son excluidos de:
 *  - Campañas masivas (scheduler)
 *  - Follow-ups de conversación
 *  - Automatizaciones WooCommerce
 *
 * El opt-out se puede registrar de dos formas:
 *  1. Automáticamente: cuando el usuario escribe STOP/baja/etc. en el webhook
 *  2. Manualmente: desde esta API (ej: solicitud por otro canal)
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/optouts — lista todos los opt-outs
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT telefono, motivo, created_at FROM waba_optouts ORDER BY created_at DESC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/optouts — registrar opt-out manualmente
router.post('/', async (req, res) => {
  const { telefono, motivo } = req.body;
  if (!telefono || typeof telefono !== 'string' || !telefono.trim()) {
    return res.status(400).json({ success: false, error: 'telefono es requerido' });
  }
  try {
    await query(
      `INSERT INTO waba_optouts (telefono, motivo)
       VALUES ($1, $2)
       ON CONFLICT (telefono) DO UPDATE SET motivo = EXCLUDED.motivo`,
      [telefono.trim(), motivo?.trim() || 'manual']
    );
    console.log(`[Optouts] Opt-out manual registrado: ${telefono.trim()}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/optouts/:telefono — reactivar contacto (eliminar de la lista)
router.delete('/:telefono', async (req, res) => {
  try {
    await query('DELETE FROM waba_optouts WHERE telefono = $1', [req.params.telefono]);
    console.log(`[Optouts] Reactivado: ${req.params.telefono}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
