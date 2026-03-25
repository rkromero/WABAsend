/**
 * Analytics — página de métricas avanzadas
 * Autor: Turnio
 * Fecha: 2026-03-25
 *
 * Secciones:
 * - Selector de período (7d / 30d / 90d / personalizado)
 * - KPI cards: enviados, entrega, lectura, respuesta, conversiones, revenue
 * - Funnel visual: barras horizontales proporcionales
 * - Gráfico de revenue mensual (Recharts BarChart)
 * - Tabla de campañas ordenable por cualquier métrica
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  TrendingUp, Send, CheckCircle2, Eye, MessageCircle, ShoppingCart,
  DollarSign, ChevronUp, ChevronDown, RefreshCw, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-AR');
}

function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return `${n}%`;
}

function fmtRevenue(n) {
  if (!n) return '$0';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd MMM yyyy', { locale: es });
  } catch {
    return iso;
  }
}

function mesPretty(mesStr) {
  if (!mesStr) return '';
  try {
    const [y, m] = mesStr.split('-');
    return format(new Date(parseInt(y), parseInt(m) - 1, 1), 'MMM yy', { locale: es });
  } catch {
    return mesStr;
  }
}

// ─── sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'accent', loading }) {
  const colorMap = {
    accent:  'text-accent bg-accent/10 border-accent/20',
    emerald: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    blue:    'text-blue-400 bg-blue-400/10 border-blue-400/20',
    amber:   'text-amber-400 bg-amber-400/10 border-amber-400/20',
    purple:  'text-purple-400 bg-purple-400/10 border-purple-400/20',
    green:   'text-green-400 bg-green-400/10 border-green-400/20',
  };

  return (
    <div className="glass-card p-5 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
          {loading ? (
            <div className="skeleton h-8 w-20 rounded mt-1" />
          ) : (
            <p className="text-2xl font-display font-bold text-white">{value}</p>
          )}
          {sub && !loading && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg border ${colorMap[color]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

/** Barra de funnel horizontal con etiqueta y porcentaje */
function FunnelBar({ label, value, max, pct, color, loading }) {
  const width = max > 0 ? Math.max((value / max) * 100, 2) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="font-medium text-white">
          {loading ? <span className="skeleton inline-block h-3 w-12 rounded" /> : fmt(value)}
          {!loading && pct !== null && (
            <span className="text-gray-500 ml-1.5">({fmtPct(pct)})</span>
          )}
        </span>
      </div>
      <div className="h-2.5 bg-base-elevated rounded-full overflow-hidden">
        {!loading && (
          <div
            className={`h-full rounded-full transition-all duration-500 ${color}`}
            style={{ width: `${width}%` }}
          />
        )}
        {loading && <div className="skeleton h-full w-3/4 rounded-full" />}
      </div>
    </div>
  );
}

/** Encabezado de columna con flecha de ordenamiento */
function ThSort({ children, field, sortBy, dir, onChange }) {
  const isActive = sortBy === field;
  return (
    <th
      className="text-left text-[10px] text-gray-500 uppercase tracking-wider pb-3 pr-4 cursor-pointer select-none hover:text-gray-300 transition-colors"
      onClick={() => onChange(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {isActive ? (
          dir === 'desc' ? <ChevronDown size={11} className="text-accent" /> : <ChevronUp size={11} className="text-accent" />
        ) : (
          <ChevronDown size={11} className="opacity-20" />
        )}
      </span>
    </th>
  );
}

// ─── Custom tooltip para el gráfico de barras ─────────────────────────────────

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-base-surface border border-base-border rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-white mb-1">{label}</p>
      <p className="text-accent">{fmtRevenue(payload[0]?.value)}</p>
      <p className="text-gray-500">{fmt(payload[1]?.value)} conversión(es)</p>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

const PRESET_RANGES = [
  { label: 'Últimos 7 días',  days: 7  },
  { label: 'Últimos 30 días', days: 30 },
  { label: 'Últimos 90 días', days: 90 },
];

export default function Analytics() {
  const [period, setPeriod]         = useState(30);
  const [overview, setOverview]     = useState(null);
  const [campaigns, setCampaigns]   = useState([]);
  const [revenue, setRevenue]       = useState([]);
  const [loadingOv, setLoadingOv]   = useState(true);
  const [loadingCamp, setLoadingCamp] = useState(true);
  const [loadingRev, setLoadingRev] = useState(true);
  const [sortBy, setSortBy]         = useState('scheduled_at');
  const [sortDir, setSortDir]       = useState('desc');

  const desde = subDays(new Date(), period).toISOString().split('T')[0];
  const hasta = new Date().toISOString().split('T')[0];

  const fetchAll = useCallback(async () => {
    setLoadingOv(true);
    setLoadingCamp(true);
    setLoadingRev(true);

    try {
      const [ovRes, campRes, revRes] = await Promise.all([
        api.get(`/analytics/overview?desde=${desde}&hasta=${hasta}`),
        api.get('/analytics/campaigns'),
        api.get('/analytics/revenue'),
      ]);
      setOverview(ovRes.data?.data || null);
      setCampaigns(campRes.data?.data || []);
      setRevenue(revRes.data?.data || []);
    } catch (err) {
      toast.error('Error al cargar analytics');
    } finally {
      setLoadingOv(false);
      setLoadingCamp(false);
      setLoadingRev(false);
    }
  }, [desde, hasta]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Ordenamiento de la tabla ──────────────────────────────────────────────

  function handleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    if (typeof av === 'string') {
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  // ── Datos del gráfico de revenue ─────────────────────────────────────────

  const chartData = revenue.map((r) => ({
    mes:         mesPretty(r.mes),
    revenue:     parseFloat(r.revenue) || 0,
    conversiones: parseInt(r.conversiones) || 0,
  }));

  const maxFunnel = overview?.enviados || 1;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2.5">
            <TrendingUp size={22} className="text-accent" />
            Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">Métricas de rendimiento de tus campañas</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Selector de período */}
          <div className="flex items-center bg-base-elevated border border-base-border rounded-xl overflow-hidden">
            {PRESET_RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setPeriod(r.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === r.days
                    ? 'bg-accent/20 text-accent border-r border-accent/20'
                    : 'text-gray-500 hover:text-gray-300 border-r border-base-border'
                } last:border-0`}
              >
                {r.label.replace('Últimos ', '').replace(' días', 'd')}
              </button>
            ))}
          </div>
          <button
            onClick={fetchAll}
            className="p-2 text-gray-500 hover:text-gray-300 transition-colors"
            title="Actualizar"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          icon={Send}
          label="Enviados"
          value={fmt(overview?.enviados)}
          sub={`${fmtDate(overview?.desde)} — ${fmtDate(overview?.hasta)}`}
          color="accent"
          loading={loadingOv}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Entregados"
          value={fmtPct(overview?.tasa_entrega)}
          sub={fmt(overview?.entregados) + ' mensajes'}
          color="emerald"
          loading={loadingOv}
        />
        <KpiCard
          icon={Eye}
          label="Leídos"
          value={fmtPct(overview?.tasa_lectura)}
          sub={fmt(overview?.leidos) + ' mensajes'}
          color="blue"
          loading={loadingOv}
        />
        <KpiCard
          icon={MessageCircle}
          label="Respondieron"
          value={fmtPct(overview?.tasa_respuesta)}
          sub={fmt(overview?.respondieron) + ' contactos'}
          color="purple"
          loading={loadingOv}
        />
        <KpiCard
          icon={ShoppingCart}
          label="Conversiones"
          value={fmt(overview?.conversiones)}
          sub={fmtPct(overview?.tasa_conversion) + ' del total'}
          color="amber"
          loading={loadingOv}
        />
        <KpiCard
          icon={DollarSign}
          label="Revenue"
          value={fmtRevenue(overview?.revenue)}
          sub="en el período"
          color="green"
          loading={loadingOv}
        />
      </div>

      {/* Funnel + Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Funnel */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-display font-semibold text-white mb-4 flex items-center gap-2">
            <ArrowRight size={14} className="text-accent" />
            Funnel del período
          </h2>
          <div className="space-y-4">
            <FunnelBar label="Enviados"    value={overview?.enviados}     max={maxFunnel} pct={null}                        color="bg-accent"          loading={loadingOv} />
            <FunnelBar label="Entregados"  value={overview?.entregados}   max={maxFunnel} pct={overview?.tasa_entrega}      color="bg-emerald-500"     loading={loadingOv} />
            <FunnelBar label="Leídos"      value={overview?.leidos}       max={maxFunnel} pct={overview?.tasa_lectura}      color="bg-blue-500"        loading={loadingOv} />
            <FunnelBar label="Respondieron" value={overview?.respondieron} max={maxFunnel} pct={overview?.tasa_respuesta}   color="bg-purple-500"      loading={loadingOv} />
            <FunnelBar label="Conversiones" value={overview?.conversiones} max={maxFunnel} pct={overview?.tasa_conversion}  color="bg-amber-500"       loading={loadingOv} />
          </div>

          {!loadingOv && overview?.enviados === 0 && (
            <p className="text-xs text-gray-600 text-center mt-4">Sin datos en el período seleccionado</p>
          )}
        </div>

        {/* Revenue mensual */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-display font-semibold text-white mb-4 flex items-center gap-2">
            <DollarSign size={14} className="text-accent" />
            Revenue mensual (últimos 6 meses)
          </h2>

          {loadingRev ? (
            <div className="h-48 flex items-center justify-center">
              <div className="skeleton h-32 w-full rounded-xl" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center">
              <DollarSign size={24} className="text-gray-700 mb-2" />
              <p className="text-xs text-gray-600">Sin conversiones registradas aún</p>
              <p className="text-[11px] text-gray-700 mt-1">Las conversiones se registran desde WooCommerce</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="revenue" fill="rgba(var(--color-accent-raw, 99,102,241),0.7)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversiones" fill="rgba(245,158,11,0.4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tabla de campañas */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-base-border flex items-center justify-between">
          <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
            <Send size={14} className="text-accent" />
            Campañas
            {!loadingCamp && (
              <span className="text-[11px] text-gray-500 font-normal">({campaigns.length})</span>
            )}
          </h2>
          <p className="text-[11px] text-gray-600">Clic en una columna para ordenar · "Respondieron" = respuesta en 48h</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-base-border px-5">
                <th className="text-left text-[10px] text-gray-500 uppercase tracking-wider pb-3 pl-5 pr-4">Campaña</th>
                <ThSort field="scheduled_at"      sortBy={sortBy} dir={sortDir} onChange={handleSort}>Fecha</ThSort>
                <ThSort field="sent_count"         sortBy={sortBy} dir={sortDir} onChange={handleSort}>Enviados</ThSort>
                <ThSort field="delivered_count"    sortBy={sortBy} dir={sortDir} onChange={handleSort}>Entregados</ThSort>
                <ThSort field="read_count"         sortBy={sortBy} dir={sortDir} onChange={handleSort}>Leídos</ThSort>
                <ThSort field="tasa_lectura"       sortBy={sortBy} dir={sortDir} onChange={handleSort}>% Lectura</ThSort>
                <ThSort field="replied_count"      sortBy={sortBy} dir={sortDir} onChange={handleSort}>Respondieron</ThSort>
                <ThSort field="tasa_respuesta"     sortBy={sortBy} dir={sortDir} onChange={handleSort}>% Resp.</ThSort>
                <ThSort field="conversions_count"  sortBy={sortBy} dir={sortDir} onChange={handleSort}>Conv.</ThSort>
                <ThSort field="conversions_revenue" sortBy={sortBy} dir={sortDir} onChange={handleSort}>Revenue</ThSort>
              </tr>
            </thead>
            <tbody>
              {loadingCamp ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-base-border/50">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="py-3 pr-4 first:pl-5">
                        <div className="skeleton h-3 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center text-sm text-gray-600 py-10">
                    No hay campañas aún
                  </td>
                </tr>
              ) : (
                sortedCampaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-base-border/50 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 pl-5 pr-4">
                      <p className="text-sm text-white font-medium truncate max-w-[180px]">{c.nombre}</p>
                      <p className="text-[10px] text-gray-600 truncate max-w-[180px]">{c.template_name}</p>
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-400 whitespace-nowrap">{fmtDate(c.scheduled_at)}</td>
                    <td className="py-3 pr-4 text-xs text-gray-300">{fmt(c.sent_count)}</td>
                    <td className="py-3 pr-4 text-xs text-emerald-400">{fmt(c.delivered_count)}</td>
                    <td className="py-3 pr-4 text-xs text-blue-400">{fmt(c.read_count)}</td>
                    <td className="py-3 pr-4 text-xs">
                      <span className={`font-medium ${c.tasa_lectura >= 50 ? 'text-emerald-400' : c.tasa_lectura >= 25 ? 'text-amber-400' : 'text-gray-400'}`}>
                        {fmtPct(c.tasa_lectura)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-purple-400">{fmt(c.replied_count)}</td>
                    <td className="py-3 pr-4 text-xs">
                      <span className={`font-medium ${c.tasa_respuesta >= 10 ? 'text-emerald-400' : c.tasa_respuesta >= 5 ? 'text-amber-400' : 'text-gray-400'}`}>
                        {fmtPct(c.tasa_respuesta)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-amber-400">{fmt(c.conversions_count)}</td>
                    <td className="py-3 pr-4 text-xs text-green-400 font-medium">{fmtRevenue(c.conversions_revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
