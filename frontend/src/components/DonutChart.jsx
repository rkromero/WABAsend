import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = {
  sent:      '#6B7280',
  delivered: '#F59E0B',
  read:      '#25D366',
  failed:    '#EF4444',
  pending:   '#374151',
};

const LABELS = {
  sent:      'Enviado',
  delivered: 'Entregado',
  read:      'Leído',
  failed:    'Fallido',
  pending:   'Pendiente',
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="glass-card px-3 py-2 text-sm">
      <span className="text-gray-300">{LABELS[name] || name}: </span>
      <span className="font-semibold text-white">{value.toLocaleString()}</span>
    </div>
  );
};

/**
 * Gráfico de dona con el breakdown de estados de una campaña.
 *
 * @param {Object} data - { sent, delivered, read, failed, pending }
 */
export default function DonutChart({ data }) {
  const chartData = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ name: key, value }));

  const total = Object.values(data).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Sin datos aún
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map(({ name }) => (
              <Cell key={name} fill={COLORS[name] || '#6B7280'} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#9CA3AF', fontSize: '12px' }}>
                {LABELS[value] || value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Total en el centro */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-display font-bold text-white">
          {total.toLocaleString()}
        </span>
        <span className="text-xs text-gray-500 mt-0.5">mensajes</span>
      </div>
    </div>
  );
}
