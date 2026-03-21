import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Trash2, Upload, ChevronLeft, ChevronRight, Tag, Edit2, Check, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
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
  const [editingPhone, setEditingPhone] = useState(null); // id del contacto en edición
  const [phoneValue, setPhoneValue]     = useState('');
  const [savingPhone, setSavingPhone]   = useState(false);

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
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="btn-primary"
        >
          <Upload size={15} />
          {showUpload ? 'Ocultar' : 'Importar Excel'}
        </button>
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
                      <button
                        onClick={() => handleDelete(c.id, c.nombre)}
                        disabled={deleting === c.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
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
    </div>
  );
}
