/**
 * Grabación de notas de voz con MediaRecorder.
 * onRecorded(blob, mimeType) se llama al confirmar el envío.
 */
import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';

const MAX_RECORD_SECONDS = 10 * 60;

/** Formato de grabación soportado por el navegador (el backend lo convierte para WhatsApp) */
function pickAudioMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return opts.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

export function fmtSeconds(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export default function useVoiceRecorder(onRecorded) {
  const [recording, setRecording] = useState(null); // null | segundos grabados
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const sendOnStopRef = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  function stopTracks() {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => () => {
    sendOnStopRef.current = false;
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    stopTracks();
  }, []);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return toast.error('Este navegador no permite grabar audio');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = pickAudioMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stopTracks();
        const type = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        setRecording(null);
        if (sendOnStopRef.current && blob.size > 0) onRecordedRef.current(blob, type);
      };
      recorderRef.current = rec;
      sendOnStopRef.current = false;
      rec.start(250);
      navigator.vibrate?.(40);
      setRecording(0);
      const started = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - started) / 1000);
        setRecording(secs);
        if (secs >= MAX_RECORD_SECONDS) finishRecording(true);
      }, 250);
    } catch (err) {
      stopTracks();
      toast.error(err?.name === 'NotAllowedError'
        ? 'Necesitás permitir el micrófono para grabar audios'
        : 'No se pudo acceder al micrófono');
    }
  }

  function finishRecording(send) {
    sendOnStopRef.current = send;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else { stopTracks(); setRecording(null); }
  }

  return { recording, startRecording, finishRecording };
}
