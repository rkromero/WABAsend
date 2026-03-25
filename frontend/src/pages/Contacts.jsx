import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Trash2, Upload, ChevronLeft, ChevronRight, Tag, Edit2, Check, X, AlertTriangle, Wand2, History, MessageSquare, Megaphone, Zap, ArrowDownLeft, Loader2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import api from '../lib/api.js';
import ExcelUploader from '../components/ExcelUploader.jsx';

export default function Contacts() {
  const [contacts, setContacts]   = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState('');
  const [segmento, setSegmento]   = useState('');   // '' = todos
  const [segments, setSegments]   = useState([]);    // lista de segmentos únicos
  const [loading, setLoading]     = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting]         = useState(null);
  const [normalizing, setNormalizing]   = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [editingPhone, setEditingPhone] = useState(null); // id del contacto en edición
  const [phoneValue, setPhoneValue]     = useState('');
  const [savingPhone, setSavingPhone]   = useState(false);

  // Historial por contacto
  const [historyContact, setHistoryContact] = useState(null); // contacto seleccionado
  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);

  // Cargar segmentos al montar
  useEffect(() => {
    api.get('/contacts/segments')
      .then((r) => setSegments(r.data || []))
      .catch(() => {}); // silencioso — si falla no rompemos la página
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/contacts', {
        params: {
          page,
          limit: LIMIT,
          search:   search   || undefined,
          segmento: segmento || undefined,
        },
      });
      setContacts(r.data.contacts);
      setTotal(r.data.pagination.total);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, segmento]);

  // Resetear página al cambiar filtros
  useEffect(() => { setPage(1); }, [search, segmento]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  function handleSegmento(seg) {
    setSegmento((prev) => (prev === seg ? '' : seg));
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Traer todos los contactos respetando el filtro activo (sin paginación)
      const r = await api.get('/contacts', {
        params: {
          limit: 10000,
          search:   search   || undefined,
          segmento: segmento || undefined,
        },
      });

      const rows = r.data.contacts.map((c) => ({
        nombre:    c.nombre,
        telefono:  c.telefono,
        email:     c.email    || '',
        segmento:  c.segmento || '',
        importado: format(new Date(c.created_at), 'dd/MM/yyyy', { locale: es }),
      }));

      const ws = XLSX.utils.json_to_sheet(rows, {
        header: ['nombre', 'telefono', 'email', 'segmento', 'importado'],
      });

      // Encabezados legibles en la primera fila
      ws['A1'].v = 'Nombre';
      ws['B1'].v = 'Teléfono';
      ws['C1'].v = 'Email';
      ws['D1'].v = 'Segmento';
      ws['E1'].v = 'Importado';

      // Anchos de columna
      ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 35 }, { wch: 20 }, { wch: 14 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Contactos');

      const filename = segmento
        ? `contactos_${segmento.replace(/\s+/g, '_')}.xlsx`
        : 'contactos.xlsx';

      XLSX.writeFile(wb, filename);
      toast.success(`${rows.length} contacto${rows.length !== 1 ? 's' : ''} exportado${rows.length !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err.message || 'Error al exportar');
    } finally {
      setExporting(false);
    }
  }

  async function handleNormalize() {
    if (!window.confirm('¿Normalizar todos los teléfonos al formato internacional (549XXXXXXXXXX)? Se actualizarán los que no estén en formato correcto.')) return;
    setNormalizing(true);
    try {
      const r = await api.post('/contacts/normalize-phones');
      const { updated, already_valid, failed } = r.data;
      if (updated > 0) {
        toast.success(`✓ ${updated} teléfono${updated !== 1 ? 's' : ''} normalizado${updated !== 1 ? 's' : ''} · ${already_valid} ya estaban bien${failed > 0 ? ` · ${failed} sin resolver` : ''}`);
        fetchContacts();
      } else if (failed > 0) {
        toast.error(`${already_valid} ya estaban correctos · ${failed} no se pudieron normalizar`);
      } else {
        toast.success(`Todos los teléfonos (${already_valid}) ya están en formato correcto`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setNormalizing(false);
    }
  }

  async function handleDelete(id, nombre) {
    if (!confirm(`¿Eliminar a ${nombre}?`)) return;
    setDeleting(id);
    try {
      await api.delete(`/contacts/${id}`);
      toast.success('Contacto eliminado');
      fetchContacts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  }

  // Color cíclico para los badges de segmento
  const SEGMENT_COLORS = [
    'text-accent/80 bg-accent/8 border-accent/20',
    'text-purple-400 bg-purple-400/8 border-purple-400/20',
    'text-amber-400 bg-amber-400/8 border-amber-400/20',
    'text-emerald-400 bg-emerald-400/8 border-emerald-400/20',
    'text-blue-400 bg-blue-400/8 border-blue-400/20',
    'text-rose-400 bg-rose-400/8 border-rose-400/20',
  ];

  function startEditPhone(c) {
    setEditingPhone(c.id);
    setPhoneValue(c.telefono);
  }

  function cancelEditPhone() {
    setEditingPhone(null);
    setPhoneValue('');
  }

  async function savePhone(id) {
    const limpio = phoneValue.replace(/\D/g, '');
    if (limpio.length < 10 || limpio.length > 15) {
      toast.error('Teléfono inválido — debe tener entre 10 y 15 dígitos');
      return;
    }
    setSavingPhone(true);
    try {
      await api.put(`/contacts/${id}`, { telefono: limpio });
      toast.success('Teléfono actualizado');
      setEditingPhone(null);
      fetchContacts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingPhone(false);
    }
  }

  // Teléfono válido para WhatsApp: 549 + 10 dígitos (ej: 5491134866718)
  function isPhoneValid(tel) {
    return /^549\d{10}$/.test(tel);
  }

  async function openHistory(c) {
    setHistoryContact(c);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const r = await api.get(`/contacts/${c.telefono}/history`);
      setHistory(r.data || []);
    } catch (err) {
      toast.error('No se pudo cargar el historial');
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryContact(null);
    setHistory([]);
  }

  function segmentColor(seg) {
    const idx = segments.findIndex((s) => s.segmento === seg);
    return SEGMENT_COLORS[(idx >= 0 ? idx : 0) % SEGMENT_COLORS.length];
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Contactos</h1>
          <p className="text-sm text-gray-500 mt-1">{total.toLocaleString()} contacto(s){segmento ? ` en "${segmento}"` : ' en total'}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleNormalize}
            disabled={normalizing}
            className="btn-secondary"
            title="Normaliza todos los teléfonos al formato 549XXXXXXXXXX requerido por WhatsApp"
          >
            <Wand2 size={14} className={normalizing ? 'animate-spin' : ''} />
            {normalizing ? 'Normalizando...' : 'Normalizar teléfonos'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="btn-secondary"
            title={segmento ? `Exportar contactos del segmento "${segmento}"` : 'Exportar todos los contactos a Excel'}
          >
            <Download size={14} className={exporting ? 'animate-bounce' : ''} />
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <button
            onClick={() => setShowUpload((v) => !v)}
            className="btn-primary"
          >
            <Upload size={15} />
            {showUpload ? 'Ocultar' : 'Importar Excel'}
          </button>
        </div>
      </div>

      {/* Uploader */}
      {showUpload && (
        <div className="animate-slide-up">
          <ExcelUploader onImported={() => {
            setShowUpload(false);
            fetchContacts();
            // Refrescar segmentos también
            api.get('/contacts/segments').then((r) => setSegments(r.data || [])).catch(() => {});
          }} />
        </div>
      )}

      {/* Filtros de segmento */}
      {segments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSegmento('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              segmento === ''
                ? 'bg-white/10 border-white/20 text-white'
                : 'border-base-border text-gray-500 hover:border-white/20 hover:text-gray-300'
            }`}
          >
            Todos
          </button>
          {segments.map((s, idx) => {
            const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
            const isActive = segmento === s.segmento;
            return (
              <button
                key={s.segmento}
                onClick={() => handleSegmento(s.segmento)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${
                  isActive
                    ? color
                    : 'border-base-border text-gray-500 hover:border-white/20 hover:text-gray-300'
                }`}
              >
                <Tag size={10} />
                {s.segmento}
                <span className="opacity-60">({s.total})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Búsqueda */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input-field pl-9"
          placeholder="Buscar por nombre, teléfono, email o segmento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tabla */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={32} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-500 text-sm">
              {search || segmento
                ? 'No se encontraron resultados para los filtros aplicados'
                : 'No hay contactos. Importá un Excel para comenzar.'}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-border">
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Teléfono
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                    Email
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                    Segmento
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">
                    Importado
                  </th>
                  <th className="py-3 px-5 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-base-border">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="py-3 px-5 text-gray-200 font-medium">{c.nombre}</td>
                    <td className="py-3 px-5">
                      {editingPhone === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            className="input-field py-1 text-xs font-mono w-40"
                            value={phoneValue}
                            onChange={(e) => setPhoneValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') savePhone(c.id);
                              if (e.key === 'Escape') cancelEditPhone();
                            }}
                          />
                          <button
                            onClick={() => savePhone(c.id)}
                            disabled={savingPhone}
                            className="text-green-400 hover:text-green-300 p-0.5"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={cancelEditPhone}
                            className="text-gray-500 hover:text-gray-300 p-0.5"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/phone">
                          <span className={`font-mono text-xs ${isPhoneValid(c.telefono) ? 'text-gray-400' : 'text-orange-400'}`}>
                            {c.telefono}
                          </span>
                          {!isPhoneValid(c.telefono) && (
                            <AlertTriangle
                              size={11}
                              className="text-orange-400 shrink-0"
                              title="Teléfono no normalizado — puede fallar al enviar por WhatsApp"
                            />
                          )}
                          <button
                            onClick={() => startEditPhone(c)}
                            className="opacity-0 group-hover/phone:opacity-100 transition-opacity text-gray-600 hover:text-gray-300 ml-0.5"
                            title="Editar teléfono"
                          >
                            <Edit2 size={11} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-5 text-gray-400 text-xs hidden md:table-cell">
                      {c.email || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-3 px-5 hidden lg:table-cell">
                      {c.segmento ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${segmentColor(c.segmento)}`}>
                          {c.segmento}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-gray-500 text-xs hidden xl:table-cell">
                      {format(new Date(c.created_at), 'dd MMM yyyy', { locale: es })}
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openHistory(c)}
                          className="text-gray-600 hover:text-accent"
                          title="Ver historial"
                        >
                          <History size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id, c.nombre)}
                          disabled={deleting === c.id}
                          className="text-gray-600 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-base-border">
                <span className="text-xs text-gray-500">
                  Página {page} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="btn-secondary py-1.5 px-3 text-xs"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="btn-secondary py-1.5 px-3 text-xs"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Drawer historial por contacto */}
      {historyContact && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={closeHistory}
          />
          {/* Panel */}
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-base-card border-l border-base-border z-50 flex flex-col shadow-2xl animate-slide-up">
            {/* Header del drawer */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-border">
              <div>
                <p className="font-semibold text-white text-sm">{historyContact.nombre}</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{historyContact.telefono}</p>
              </div>
              <button onClick={closeHistory} className="text-gray-500 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-16 gap-3 text-gray-500">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Cargando historial...</span>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-600">
                  <History size={32} />
                  <p className="text-sm">Sin interacciones registradas</p>
                </div>
              ) : (
                <ol className="relative border-l border-base-border ml-3 space-y-0">
                  {history.map((item, idx) => (
                    <HistoryItem key={`${item.tipo}-${item.id}-${idx}`} item={item} />
                  ))}
                </ol>
              )}
            </div>

            {/* Footer */}
            {history.length > 0 && (
              <div className="px-5 py-3 border-t border-base-border">
                <p className="text-xs text-gray-600">{history.length} evento{history.length !== 1 ? 's' : ''} registrado{history.length !== 1 ? 's' : ''}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Ítem de la timeline ───────────────────────────────────────────── */
const TIPO_CONFIG = {
  'campaña': {
    icon: Megaphone,
    color: 'text-accent',
    bg: 'bg-accent/10 border-accent/20',
    label: 'Campaña',
  },
  'follow-up': {
    icon: Zap,
    color: 'text-amber-400',
    bg: 'bg-amber-400/10 border-amber-400/20',
    label: 'Follow-up',
  },
  'automatización': {
    icon: MessageSquare,
    color: 'text-purple-400',
    bg: 'bg-purple-400/10 border-purple-400/20',
    label: 'Automatización',
  },
  'entrante': {
    icon: ArrowDownLeft,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10 border-emerald-400/20',
    label: 'Recibido',
  },
};

const STATUS_BADGE = {
  'sent':      'text-blue-400 bg-blue-400/10',
  'delivered': 'text-emerald-400 bg-emerald-400/10',
  'read':      'text-accent bg-accent/10',
  'failed':    'text-red-400 bg-red-400/10',
  'pending':   'text-gray-400 bg-white/5',
  'received':  'text-emerald-400 bg-emerald-400/10',
};

const STATUS_LABEL = {
  'sent':      'Enviado',
  'delivered': 'Entregado',
  'read':      'Leído',
  'failed':    'Fallido',
  'pending':   'Pendiente',
  'received':  'Recibido',
};

function HistoryItem({ item }) {
  const conf = TIPO_CONFIG[item.tipo] || TIPO_CONFIG['campaña'];
  const Icon = conf.icon;
  const statusCls = STATUS_BADGE[item.status] || STATUS_BADGE['pending'];
  const statusLabel = STATUS_LABEL[item.status] || item.status;

  const fecha = new Date(item.fecha);
  const fechaRelativa = formatDistanceToNow(fecha, { locale: es, addSuffix: true });
  const fechaExacta  = format(fecha, "d MMM yyyy, HH:mm", { locale: es });

  return (
    <li className="mb-6 ml-6">
      {/* Ícono en la línea */}
      <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border ${conf.bg}`}>
        <Icon size={11} className={conf.color} />
      </span>

      <div className="glass-card p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-200 truncate">{item.titulo}</p>
            {item.subtitulo && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.subtitulo}</p>
            )}
          </div>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${statusCls}`}>
            {statusLabel}
          </span>
        </div>

        {item.detalle && item.status === 'failed' && (
          <p className="text-[11px] text-red-400/80 bg-red-400/5 rounded px-2 py-1 line-clamp-2">
            {item.detalle}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${conf.bg} ${conf.color} font-medium`}>
            {conf.label}
          </span>
          <span className="text-[10px] text-gray-600" title={fechaExacta}>
            {fechaRelativa}
          </span>
        </div>
      </div>
    </li>
  );
}
