import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Send, CheckCircle, Clock, AlertTriangle,
  MessageSquare, Eye, Truck, XCircle, ArrowRight, Zap,
  TrendingUp, ShoppingBag,
} from 'lucide-react';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { usePolling } from '../hooks/usePolling.js';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

function KpiCard({ icon: Icon, label, value, sub, color = 'accent' }) {
  const colorMap = {
    accent:  'text-accent bg-accent/10 border-accent/20',
    amber:   'text-amber-400 bg-amber-400/10 border-amber-400/20',
    red:     'text-red-400 bg-red-400/10 border-red-400/20',
    blue:    'text-blue-400 bg-blue-400/10 border-blue-400/20',
    gray:    'text-gray-400 bg-gray-400/10 border-gray-400/20',
    purple:  'text-purple-400 bg-purple-400/10 border-purple-400/20',
    emerald: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  };

  return (
    <div className="glass-card p-5 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
          <p className="text-3xl font-display font-bold text-white">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg border ${colorMap[color]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

/** Scorecard chico para mostrar dentro de la fila de campaña */
function MiniScore({ label, value, color = 'text-gray-400' }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 bg-white/[0.03] border border-base-border rounded-lg shrink-0">
      <span className={`text-sm font-bold font-display ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-600 mt-0.5">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats]         = useState(null);
  const [contacts, setContacts]   = useState(0);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);

  async function fetchData() {
    try {
      const [statsRes, contactsRes, campaignsRes] = await Promise.all([
        api.get('/campaigns/stats'),
        api.get('/contacts/count'),
        api.get('/campaigns'),
      ]);
      setStats(statsRes.data);
      setContacts(contactsRes.data.total);
      setCampaigns(campaignsRes.data.slice(0, 5));
    } catch {
      // Silencioso en polling
    } finally {
      setLoading(false);
    }
  }

  const hasRunning = campaigns.some((c) => c.status === 'running');
  usePolling(fetchData, 5000, hasRunning);
  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="skeleton h-8 w-48 rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const m  = stats?.messages;
  const c  = stats?.campaigns;
  const cv = stats?.conversions;

  // Tasa de conversión: null si no hay emails cargados aún
  const convRate    = cv?.conversion_rate;
  const hasConvData = cv?.total_with_email > 0;

  return (
    <div className="space-y-8 animate-slide-up">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen general de tus campañas</p>
      </div>

      {/* KPIs — Resumen general */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Resumen general
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Users}       label="Contactos"          value={contacts}          color="blue" />
          <KpiCard icon={Send}        label="Camp. programadas"  value={c?.scheduled || 0} color="blue" />
          <KpiCard icon={Zap}         label="Camp. ejecutando"   value={c?.running || 0}   color="amber" />
          <KpiCard icon={CheckCircle} label="Camp. completadas"  value={c?.completed || 0} color="accent" />
        </div>
      </div>

      {/* KPIs — Mensajes */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Mensajes totales
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Send}    label="Enviados"   value={m?.sent || 0}      color="gray" />
          <KpiCard icon={Truck}   label="Entregados" value={m?.delivered || 0} color="amber" />
          <KpiCard icon={Eye}     label="Leídos"     value={m?.read || 0}      color="accent" />
          <KpiCard icon={XCircle} label="Fallidos"   value={m?.failed || 0}    color="red" />
        </div>
      </div>

      {/* KPI — Conversiones */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Conversiones
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Tasa de conversión global */}
          <div className="glass-card p-5 animate-fade-in lg:col-span-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Tasa de conversión
                </p>
                {hasConvData ? (
                  <>
                    <p className="text-3xl font-display font-bold text-emerald-400">
                      {convRate}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {cv.total_conversions} compras de {cv.total_with_email} contactos con email
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-display font-bold text-gray-600">—</p>
                    <p className="text-xs text-gray-600 mt-1">
                      Importá contactos con email y ejecutá "Verificar conversiones" en una campaña
                    </p>
                  </>
                )}
              </div>
              <div className="p-2.5 rounded-lg border text-emerald-400 bg-emerald-400/10 border-emerald-400/20">
                <TrendingUp size={18} />
              </div>
            </div>
          </div>

          {/* Revenue atribuido */}
          <KpiCard
            icon={ShoppingBag}
            label="Revenue atribuido"
            value={hasConvData ? `$${Number(cv.total_revenue).toLocaleString('es-AR')}` : '—'}
            sub={hasConvData ? `${cv.total_conversions} órdenes detectadas` : 'Sin datos aún'}
            color="emerald"
          />

          {/* Compras totales detectadas */}
          <KpiCard
            icon={CheckCircle}
            label="Compras detectadas"
            value={cv?.total_conversions || 0}
            sub={hasConvData ? `En ventana de atribución configurada` : 'Ejecutá check-conversions'}
            color="purple"
          />
        </div>
      </div>

      {/* Campañas recientes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Campañas recientes
          </h2>
          <Link to="/campaigns" className="text-xs text-accent hover:text-accent/80 flex items-center gap-1">
            Ver todas <ArrowRight size={12} />
          </Link>
        </div>

        {campaigns.length === 0 ? (
          <div className="glass-card p-8 text-center text-gray-500 text-sm">
            No hay campañas aún.{' '}
            <Link to="/campaigns" className="text-accent hover:underline">
              Crear la primera
            </Link>
          </div>
        ) : (
          <div className="glass-card divide-y divide-base-border">
            {campaigns.map((camp) => {
              const conversions = parseInt(camp.conversions_count) || 0;
              const recipients  = parseInt(camp.total_contacts) || 0;
              const convPct     = recipients > 0
                ? ((conversions / recipients) * 100).toFixed(1)
                : null;

              return (
                <Link
                  key={camp.id}
                  to={`/campaigns/${camp.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Info campaña */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white truncate">{camp.nombre}</span>
                      <StatusBadge status={camp.status} size="sm" />
                    </div>
                    <div className="flex items-center gap-4">
                      <ProgressBar
                        value={camp.sent_count}
                        total={camp.total_contacts}
                        showLabel={false}
                      />
                      <span className="text-xs text-gray-500 shrink-0">
                        {camp.sent_count}/{camp.total_contacts}
                      </span>
                    </div>
                  </div>

                  {/* Scorecards de conversión */}
                  <div className="hidden lg:flex items-center gap-2">
                    <MiniScore
                      label="Conversiones"
                      value={conversions}
                      color={conversions > 0 ? 'text-emerald-400' : 'text-gray-600'}
                    />
                    <MiniScore
                      label="% Conv."
                      value={convPct !== null ? `${convPct}%` : '—'}
                      color={convPct > 0 ? 'text-emerald-400' : 'text-gray-600'}
                    />
                  </div>

                  {/* Fecha */}
                  <div className="text-xs text-gray-600 shrink-0 hidden xl:block">
                    {format(new Date(camp.scheduled_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </div>

                  <ArrowRight
                    size={14}
                    className="text-gray-600 group-hover:text-gray-300 transition-colors shrink-0"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
