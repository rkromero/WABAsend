import React from 'react';

const STATUS_CONFIG = {
  // Estados de mensaje
  pending:   { label: 'Pendiente',  className: 'bg-gray-500/15 text-gray-400  border-gray-500/20' },
  sent:      { label: 'Enviado',    className: 'bg-gray-400/15 text-gray-300  border-gray-400/20' },
  delivered: { label: 'Entregado',  className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  read:      { label: 'Leído',      className: 'bg-accent/15   text-accent     border-accent/20' },
  failed:    { label: 'Fallido',    className: 'bg-red-500/15  text-red-400   border-red-500/20' },

  // Estados de campaña
  scheduled: { label: 'Programada', className: 'bg-blue-500/15  text-blue-400   border-blue-500/20' },
  running:   { label: 'Ejecutando', className: 'bg-amber-500/15 text-amber-400  border-amber-500/20' },
  completed: { label: 'Completada', className: 'bg-accent/15   text-accent      border-accent/20' },

  // Estados de plantilla
  APPROVED:  { label: 'Aprobada',  className: 'bg-accent/15   text-accent     border-accent/20' },
  PENDING:   { label: 'Pendiente', className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  REJECTED:  { label: 'Rechazada', className: 'bg-red-500/15  text-red-400   border-red-500/20' },
  PAUSED:    { label: 'Pausada',   className: 'bg-gray-500/15 text-gray-400  border-gray-500/20' },
};

/**
 * Badge de estado con colores semánticos.
 *
 * @param {string} status - Clave del estado (pending, sent, delivered, read, failed, ...)
 * @param {string} [size] - 'sm' | 'md' (default: 'md')
 */
export default function StatusBadge({ status, size = 'md' }) {
  const config = STATUS_CONFIG[status] || {
    label: status,
    className: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
  };

  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizeClass} ${config.className}`}
    >
      {config.label}
    </span>
  );
}
