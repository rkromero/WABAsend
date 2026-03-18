import React from 'react';

/**
 * Barra de progreso animada para el estado de envío de campañas.
 *
 * @param {number} value    - Valor actual
 * @param {number} total    - Valor máximo
 * @param {string} [color]  - Color de la barra (default: accent verde)
 * @param {boolean} [showLabel] - Mostrar porcentaje y conteo
 */
export default function ProgressBar({ value = 0, total = 0, color = 'accent', showLabel = true }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  const colorClasses = {
    accent: 'bg-accent shadow-[0_0_8px_rgba(37,211,102,0.4)]',
    amber:  'bg-amber-400',
    red:    'bg-red-400',
    blue:   'bg-blue-400',
  };

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-gray-400">
            {value.toLocaleString()} / {total.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-gray-300">{pct}%</span>
        </div>
      )}
      <div className="h-1.5 w-full bg-base-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${colorClasses[color] || colorClasses.accent}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
