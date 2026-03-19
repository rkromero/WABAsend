/**
 * Página de Catálogo de Productos — sincronizado desde WooCommerce
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Eye,
  ShoppingBag,
  Zap,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

export default function Products() {
  const [products, setProducts]   = useState([]);
  const [stats, setStats]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast]         = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Debounce del search: esperar 400ms después del último tecleo
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchProducts = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (debouncedSearch) params.append('search', debouncedSearch);

      const [prodRes, statsRes] = await Promise.all([
        fetch(`${API}/api/products?${params}`),
        fetch(`${API}/api/products/stats`),
      ]);

      const prodData  = await prodRes.json();
      const statsData = await statsRes.json();

      if (prodData.success) {
        setProducts(prodData.data.products);
        setPagination(prodData.data.pagination);
      }
      if (statsData.success) setStats(statsData.data);
    } catch (err) {
      showToast('Error al cargar productos', 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchProducts(1);
  }, [fetchProducts]);

  const handleSync = async (full = false) => {
    setSyncing(true);
    try {
      const res  = await fetch(`${API}/api/products/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      if (data.success) {
        const { inserted, updated, visionCalls, mode } = data.data;
        showToast(
          `Sync ${mode} completada — ${inserted} nuevos, ${updated} actualizados, ${visionCalls} análisis Vision`
        );
        fetchProducts(1);
      } else {
        showToast(data.error || 'Error en sync', 'error');
      }
    } catch (err) {
      showToast('Error al sincronizar', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const formatPrice = (precio, precioOferta) => {
    if (precioOferta) {
      return (
        <span className="flex items-center gap-2">
          <span className="text-accent font-semibold">${Number(precioOferta).toLocaleString('es-AR')}</span>
          <span className="text-gray-500 line-through text-xs">${Number(precio).toLocaleString('es-AR')}</span>
        </span>
      );
    }
    return <span className="font-semibold">${Number(precio).toLocaleString('es-AR')}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg flex items-center gap-2 ${
          toast.type === 'error' ? 'bg-red-500/20 border border-red-500/30 text-red-400' : 'bg-accent/20 border border-accent/30 text-accent'
        }`}>
          {toast.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-white flex items-center gap-2">
            <Package size={20} className="text-accent" />
            Catálogo de Productos
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Productos sincronizados desde WooCommerce</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSync(false)}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white/5 border border-base-border text-gray-300 hover:bg-white/10 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sync delta'}
          </button>
          <button
            onClick={() => handleSync(true)}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all disabled:opacity-50"
          >
            <Zap size={14} />
            Sync completa
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Con stock', value: stats.con_stock, color: 'text-accent' },
            { label: 'Con análisis Vision', value: stats.con_vision, color: 'text-purple-400' },
            { label: 'Total activos', value: stats.total_activos, color: 'text-blue-400' },
            { label: 'Sin stock', value: stats.inactivos, color: 'text-gray-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-base-surface border border-base-border rounded-xl p-4">
              <p className="text-gray-500 text-xs mb-1">{label}</p>
              <p className={`text-2xl font-bold font-display ${color}`}>{value ?? '—'}</p>
            </div>
          ))}
        </div>
      )}

      {/* Buscador */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Buscar por nombre, color, categoría..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-base-surface border border-base-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent/50 transition-colors"
        />
      </div>

      {/* Grilla de productos */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-base-surface border border-base-border rounded-xl overflow-hidden animate-pulse">
              <div className="h-44 bg-white/5" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-white/5 rounded w-3/4" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShoppingBag size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">
            {search ? 'Sin resultados para esa búsqueda' : 'No hay productos sincronizados'}
          </p>
          <p className="text-gray-600 text-sm mt-1">
            {!search && 'Hacé clic en "Sync completa" para importar el catálogo desde WooCommerce'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                className="bg-base-surface border border-base-border rounded-xl overflow-hidden cursor-pointer hover:border-accent/30 hover:bg-white/[0.03] transition-all group"
              >
                {/* Imagen */}
                <div className="relative h-44 bg-white/5 overflow-hidden">
                  {p.imagen_url ? (
                    <img
                      src={p.imagen_url}
                      alt={p.nombre}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Package size={32} className="text-gray-700" />
                    </div>
                  )}
                  {/* Badge Vision */}
                  {p.vision_generado_at && (
                    <div className="absolute top-2 right-2 bg-purple-500/80 backdrop-blur-sm text-white text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Eye size={9} />
                      Vision
                    </div>
                  )}
                  {/* Badge stock / talles */}
                  <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded max-w-[90%] truncate">
                    {p.variantes ? `Talles: ${p.variantes}` : `Stock: ${p.stock}`}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3 space-y-1">
                  <p className="text-white text-xs font-medium leading-tight line-clamp-2">{p.nombre}</p>
                  <p className="text-gray-500 text-[10px] line-clamp-1">{p.categorias || 'Sin categoría'}</p>
                  <div className="text-xs pt-0.5">
                    {formatPrice(p.precio, p.precio_oferta)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Paginación */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => fetchProducts(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-base-border text-gray-400 hover:text-white disabled:opacity-30 transition-all"
              >
                Anterior
              </button>
              <span className="text-gray-500 text-sm">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => fetchProducts(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-base-border text-gray-400 hover:text-white disabled:opacity-30 transition-all"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal detalle de producto */}
      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="bg-base-surface border border-base-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-4 p-5">
              {/* Imagen */}
              <div className="w-36 h-36 shrink-0 rounded-xl overflow-hidden bg-white/5">
                {selectedProduct.imagen_url ? (
                  <img src={selectedProduct.imagen_url} alt={selectedProduct.nombre} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Package size={28} className="text-gray-600" />
                  </div>
                )}
              </div>

              {/* Datos */}
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="text-white font-semibold text-sm leading-tight">{selectedProduct.nombre}</h3>
                <p className="text-gray-500 text-xs">{selectedProduct.categorias || 'Sin categoría'}</p>
                <div className="text-sm">{formatPrice(selectedProduct.precio, selectedProduct.precio_oferta)}</div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {selectedProduct.variantes
                    ? <span>Talles: <span className="text-white font-medium">{selectedProduct.variantes}</span></span>
                    : <span>Stock: <span className="text-white font-medium">{selectedProduct.stock}</span></span>
                  }
                  {selectedProduct.permalink && (
                    <a
                      href={selectedProduct.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      Ver en tienda ↗
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Descripción Vision */}
            {selectedProduct.descripcion_vision && (
              <div className="px-5 pb-5">
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
                  <p className="text-purple-400 text-[11px] font-medium mb-1.5 flex items-center gap-1.5">
                    <Eye size={11} />
                    Descripción generada por Vision IA
                  </p>
                  <p className="text-gray-300 text-xs leading-relaxed">{selectedProduct.descripcion_vision}</p>
                </div>
              </div>
            )}

            <div className="px-5 pb-5">
              <button
                onClick={() => setSelectedProduct(null)}
                className="w-full py-2 rounded-lg text-sm bg-white/5 border border-base-border text-gray-400 hover:text-white transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
