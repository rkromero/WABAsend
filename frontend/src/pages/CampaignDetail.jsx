import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import DonutChart from '../components/DonutChart.jsx';
import ContactsTable from '../components/ContactsTable.jsx';
import { usePolling } from '../hooks/usePolling.js';

export default function CampaignDetail() {
  const { id } = useParams();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchDetail() {
    try {
      const r = await api.get(`/campaigns/${id}`);
      setData(r.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isRunning = data?.campaign?.status === 'running';
  usePolling(fetchDetail, 5000, isRunning);
  useEffect(() => { fetchDetail(); }, [id]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="skeleton h-8 w-48 rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="skeleton h-48 rounded-xl" />
          <div className="skeleton h-48 rounded-xl" />
        </div>
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const { campaign, logs } = data;
  const chartData = {
    pending:   logs.filter((l) => l.status === 'pending').length,
    sent:      logs.filter((l) => l.status === 'sent').length,
    delivered: logs.filter((l) => l.status === 'delivered').length,
    read:      logs.filter((l) => l.status === 'read').length,
    failed:    logs.filter((l) => l.status === 'failed').length,
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link to="/campaigns" className="text-gray-500 hover:text-gray-300 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold text-white">{campaign.nombre}</h1>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Programada: {format(new Date(campaign.scheduled_at), "dd MMM yyyy 'a las' HH:mm", { locale: es })}
          </p>
        </div>
        {isRunning && (
          <div className="ml-auto flex items-center gap-2 text-amber-400 text-xs">
            <RefreshCw size={12} className="animate-spin" />
            Actualizando en tiempo real...
          </div>
        )}
      </div>

      {/* Métricas superiores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total contactos', value: campaign.total_contacts },
          { label: 'Enviados',        value: campaign.sent_count },
          { label: 'Entregados',      value: campaign.delivered_count },
          { label: 'Leídos',          value: campaign.read_count },
        ].map(({ label, value }) => (
          <div key={label} className="glass-card p-4 text-center">
            <p className="text-2xl font-display font-bold text-white">{value?.toLocaleString() || 0}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Progreso + Donut */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
            Progreso de envío
          </h2>
          <ProgressBar value={campaign.sent_count} total={campaign.total_contacts} />

          <div className="grid grid-cols-3 gap-3 mt-5">
            {[
              { label: 'Entregados', value: campaign.delivered_count, color: 'text-amber-400' },
              { label: 'Leídos',     value: campaign.read_count,      color: 'text-accent' },
              { label: 'Fallidos',   value: campaign.failed_count,    color: 'text-red-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-3 rounded-lg bg-base-elevated">
                <p className={`text-xl font-display font-bold ${color}`}>{value?.toLocaleString() || 0}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-base-border space-y-1 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Plantilla</span>
              <span className="text-gray-300">{campaign.template_name}</span>
            </div>
            <div className="flex justify-between">
              <span>Idioma</span>
              <span className="text-gray-300">{campaign.template_language}</span>
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            Distribución de estados
          </h2>
          <DonutChart data={chartData} />
        </div>
      </div>

      {/* Tabla de mensajes */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-base-border">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Detalle por contacto ({logs.length})
          </h2>
        </div>
        <ContactsTable logs={logs} />
      </div>
    </div>
  );
}
