/**
 * Respaldo para notas de voz: Meta a veces rechaza el ogg/opus de forma
 * asincrónica (error 131053 "Media file scrutiny"). Guardamos el audio original
 * unos minutos y, si llega ese rechazo, lo reenviamos como MP3.
 */
import { toMp3 } from './audio.js';
import { uploadMediaToMeta, sendMediaMessage } from './whatsapp.js';

const TTL_MS = 15 * 60 * 1000;
const pending = new Map(); // wamid → { telefono, buffer, at }

function cleanup() {
  const now = Date.now();
  for (const [id, v] of pending) if (now - v.at > TTL_MS) pending.delete(id);
}

export function rememberVoiceNote(waMessageId, telefono, buffer) {
  if (!waMessageId) return;
  cleanup();
  pending.set(waMessageId, { telefono, buffer, at: Date.now() });
}

/** Llamado desde el webhook de estados. Devuelve true si reintentó. */
export async function retryVoiceNoteIfRejected(waMessageId, errors = []) {
  const entry = pending.get(waMessageId);
  if (!entry) return false;
  pending.delete(waMessageId);
  if (!errors.some((e) => e.code === 131053)) return false;

  try {
    const mp3 = await toMp3(entry.buffer);
    const mediaId = await uploadMediaToMeta(mp3, 'audio/mpeg', 'nota_de_voz.mp3');
    const newId = await sendMediaMessage(entry.telefono, 'audio', mediaId);
    console.log(`[AudioRetry] Nota de voz reenviada como MP3 a ${entry.telefono} (msgId: ${newId})`);
    return true;
  } catch (err) {
    console.error('[AudioRetry] Falló el reenvío como MP3:', JSON.stringify(err.response?.data?.error || err.message));
    return false;
  }
}
