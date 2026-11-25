/**
 * Reproductor de notas de voz estilo WhatsApp: play/pausa, onda, tiempo y velocidad.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Play, Pause, Mic } from 'lucide-react';

const BARS = 36;
const SPEEDS = [1, 1.5, 2];

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Alturas pseudoaleatorias pero estables por URL (parece una onda real) */
function useBars(seed) {
  return useMemo(() => {
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return Array.from({ length: BARS }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0;
      const base = 0.25 + ((h >>> 16) % 1000) / 1000 * 0.75;
      return Math.max(0.18, base * (0.6 + 0.4 * Math.sin(i / 3)));
    });
  }, [seed]);
}

export default function AudioPlayer({ url, out }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);
  const bars = useBars(url);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => {
      if (isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    const onErr = () => { setError(true); setPlaying(false); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onErr);
    };
  }, []);

  async function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    // Pausar cualquier otro audio que esté sonando (como WhatsApp)
    document.querySelectorAll('audio[data-wa]').forEach((el) => { if (el !== a) el.pause(); });
    try {
      a.playbackRate = speed;
      await a.play();
      setPlaying(true);
    } catch {
      setError(true);
    }
  }

  function seek(e) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(a.currentTime);
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const progress = duration ? current / duration : 0;

  return (
    <div className="flex items-center gap-2 w-[250px] max-w-full py-1">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        data-wa
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />

      {/* Ícono de micrófono / velocidad, como en WhatsApp */}
      {playing || current > 0 ? (
        <button
          onClick={cycleSpeed}
          className="shrink-0 w-11 h-7 rounded-full bg-black/10 dark:bg-white/15 text-[13px] font-semibold"
        >
          {speed}×
        </button>
      ) : (
        <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white ${out ? 'bg-[#4fb38c]' : 'bg-[#f39c4a]'}`}>
          <Mic size={22} />
        </div>
      )}

      <button onClick={toggle} className="shrink-0 text-wa-sub p-0.5" aria-label={playing ? 'Pausar' : 'Reproducir'} disabled={error}>
        {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="relative h-7 flex items-center gap-[2px] cursor-pointer" onClick={seek}>
          {bars.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${h * 100}%`,
                background: i / BARS < progress ? 'var(--wa-blue)' : 'var(--wa-sub)',
                opacity: i / BARS < progress ? 1 : 0.55,
              }}
            />
          ))}
          <span
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-wa-blue shadow"
            style={{ left: `calc(${progress * 100}% - 6px)` }}
          />
        </div>
        <p className="text-[11px] text-wa-sub mt-0.5">
          {error ? 'No se pudo reproducir' : fmt(playing || current > 0 ? current : duration)}
        </p>
      </div>
    </div>
  );
}
