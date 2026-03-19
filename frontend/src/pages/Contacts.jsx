import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Trash2, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api.js';
import ExcelUploader from '../components/ExcelUploader.jsx';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/contacts', {
        params: { page, limit: LIMIT, search: search || undefined },
      });
      setContacts(r.data.contacts);
      setTotal(r.data.pagination.total);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    // Resetear página al cambiar búsqueda
    setPage(1);
  }, [search]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

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

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Contactos</h1>
          <p className="text-sm text-gray-500 mt-1">{total.toLocaleString()} contacto(s) en total</p>
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
          <ExcelUploader onImported={() => { setShowUpload(false); fetchContacts(); }} />
        </div>
      )}

      {/* Búsqueda */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input-field pl-9"
          placeholder="Buscar por nombre, teléfono o email..."
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
              {search ? 'No se encontraron resultados' : 'No hay contactos. Importá un Excel para comenzar.'}
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
                    Importado
                  </th>
                  <th className="py-3 px-5 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-base-border">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="py-3 px-5 text-gray-200 font-medium">{c.nombre}</td>
                    <td className="py-3 px-5 text-gray-400 font-mono text-xs">{c.telefono}</td>
                    <td className="py-3 px-5 text-gray-400 text-xs hidden md:table-cell">
                      {c.email || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-3 px-5 text-gray-500 text-xs hidden lg:table-cell">
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
