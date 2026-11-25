/**
 * Suscripción de dispositivos a notificaciones push.
 * GET  /api/push/public-key   — clave VAPID pública
 * POST /api/push/subscribe    — Body: PushSubscription (JSON del navegador)
 * POST /api/push/unsubscribe  — Body: { endpoint }
 */
import { Router } from 'express';
import { getPublicKey, saveSubscription, deleteSubscription } from '../services/push.js';

const router = Router();

router.get('/public-key', (req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ success: false, error: 'Push no disponible' });
  res.json({ success: true, data: { publicKey: key } });
});

router.post('/subscribe', async (req, res) => {
  try {
    await saveSubscription(req.user.id, req.body, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/unsubscribe', async (req, res) => {
  try {
    await deleteSubscription(req.user.id, req.body?.endpoint);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
