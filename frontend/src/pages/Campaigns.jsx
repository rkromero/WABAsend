import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Plus, Trash2, ArrowRight, Calendar, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import CampaignStepper from '../components/CampaignStepper.jsx';
import { usePolling } from '../hooks/usePolling.js';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showNew, setShowNew]     = useState(false);
  const [deleting, setDeleting]   = useState(null);

  async function fetchCampaigns() {
    try {
      const r = await api.get('/campaigns');
      setCampaigns(r.data);
    } catch (err) {
      if (!loading) return; // no mostrar error en polling silencioso
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const hasRunning = campaigns.some((c) => c.status === 'running');
  usePolling(fetchCampaigns, 5000, hasRunning);
  useEffect(() => { fetchCampaigns(); }, []);

  async function handleDelete(e, id) {
    e.preventDefault(); // evitar navegación al link padre
    e.stopPropagation();
    if (!confirm('¿Eliminar esta campaña?')) return;
    setDeleting(id);
    try {
      await api.delete(`/campaigns/${id}`);
      toast.success('Campaña eliminada');
      fetchCampaigns();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Campañas</h1>
          <p className="text-sm text-gray-500 mt-1">{campaigns.length} campaña(s)</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={15} />
          Nueva campaña
        </button>
      </div>

      {/* Stepper modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <CampaignStepper
              onSuccess={() => { setShowNew(false); fetchCampaigns(); }}
              onCancel={() => setShowNew(false)}
            />
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Send size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm mb-4">No hay campañas todavía.</p>
          <button onClick={() => setShowNew(true)} className="btn-primary mx-auto">
            <Plus size={15} /> Crear la primera
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((camp) => (
            <Link
              key={camp.id}
              to={`/campaigns/${camp.id}`}
              className="glass-card flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors group block"
            >
              {/* Icono estado */}
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                camp.status === 'running'   ? 'bg-amber-500/15 border border-amber-500/30' :
                camp.status === 'completed' ? 'bg-accent/15 border border-accent/30' :
                camp.status === 'failed'    ? 'bg-red-500/15 border border-red-500/30' :
                'bg-blue-500/15 border border-blue-500/30'
              }`}>
                <Send size={16} className={
                  camp.status === 'running'   ? 'text-amber-400' :
                  camp.status === 'completed' ? 'text-accent' :
                  camp.status === 'failed'    ? 'text-red-400' :
                  'text-blue-400'
                } />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium text-white truncate">{camp.nombre}</span>
                  <StatusBadge status={camp.status} size="sm" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <ProgressBar
                      value={camp.sent_count}
                      total={camp.total_contacts || 1}
                      showLabel={false}
                    />
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">
                    {camp.sent_count}/{camp.total_contacts} enviados
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Calendar size={10} />
                    {format(new Date(camp.scheduled_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </span>
                  <span className="text-xs text-gray-600">{camp.template_name}</span>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex items-center gap-2 shrink-0">
                {['scheduled', 'completed', 'failed'].includes(camp.status) && (
                  <button
                    onClick={(e) => handleDelete(e, camp.id)}
                    disabled={deleting === camp.id}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400 p-1"
                    title="Eliminar campaña"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <ArrowRight size={14} className="text-gray-600 group-hover:text-gray-300 transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
