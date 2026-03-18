import React from 'react';
import StatusBadge from './StatusBadge.jsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Tabla de contactos con estado de mensaje (usado en el detalle de campaña).
 *
 * @param {Array}   logs     - Array de message_logs
 * @param {boolean} loading  - Mostrar skeleton
 */
export default function ContactsTable({ logs = [], loading = false }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        Sin registros de mensajes
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-border">
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Nombre
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Teléfono
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Estado
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Enviado
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actualizado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-base-border">
          {logs.map((log) => (
            <tr
              key={log.id}
              className="hover:bg-white/[0.02] transition-colors duration-100 group"
            >
              <td className="py-3 px-4 text-gray-200 font-medium">{log.nombre}</td>
              <td className="py-3 px-4 text-gray-400 font-mono text-xs">{log.telefono}</td>
              <td className="py-3 px-4">
                <StatusBadge status={log.status} />
              </td>
              <td className="py-3 px-4 text-gray-500 text-xs">
                {log.sent_at
                  ? format(new Date(log.sent_at), 'dd MMM HH:mm', { locale: es })
                  : '—'}
              </td>
              <td className="py-3 px-4 text-gray-500 text-xs">
                {log.updated_at
                  ? format(new Date(log.updated_at), 'dd MMM HH:mm', { locale: es })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
