import { useEffect, useRef } from 'react';

/**
 * Hook para polling: llama a `fn` cada `interval` ms mientras `active` sea true.
 * Se limpia automáticamente al desmontar el componente.
 *
 * @param {Function} fn       - Función a ejecutar periódicamente
 * @param {number}   interval - Intervalo en milisegundos (default: 5000)
 * @param {boolean}  active   - Si false, el polling está pausado
 */
export function usePolling(fn, interval = 5000, active = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!active) return;

    // Ejecutar inmediatamente al montar
    fnRef.current();

    const id = setInterval(() => {
      fnRef.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, active]);
}
