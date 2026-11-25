/**
 * Catálogo de productos para el vendedor + selector de productos para el chat.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Package, Send, Copy, ArrowLeft, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import { Avatar, BottomNav, Sheet, Spinner } from './ui.jsx';
import { money, productMessage, contactOf } from './waUtils.js';

const PAGE_SIZE = 30;

/** Carga paginada con búsqueda (debounce 350ms) */
export function useProducts(search) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (p, t) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: PAGE_SIZE });
      if (t) params.set('search', t);
      const res = await api.get(`/products?${params}`);
      if (id !== reqId.current) return;
      const list = res.data?.products || [];
      setItems((prev) => (p === 1 ? list : [...prev, ...list]));
      setHasMore(p < (res.data?.pagination?.totalPages || 1));
      setPage(p);
    } catch {
      if (id === reqId.current) toast.error('No se pudieron cargar los productos');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, term); }, [term, load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) load(page + 1, term);
  }, [loading, hasMore, page, term, load]);

  return { items, loading, hasMore, loadMore };
}

/** Dispara onVisible cuando el centinela entra en pantalla (scroll infinito) */
function Sentinel({ onVisible }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => e[0].isIntersecting && onVisible(), { rootMargin: '300px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible]);
  return <div ref={ref} className="h-1" />;
}

function Price({ p, big }) {
  return (
    <div className={`flex items-baseline gap-1.5 flex-wrap ${big ? 'text-[20px]' : 'text-[15px]'}`}>
      <span className="font-semibold">{money(p.precio_oferta || p.precio)}</span>
      {p.precio_oferta && <span className="text-wa-sub line-through text-[0.8em]">{money(p.precio)}</span>}
    </div>
  );
}

function SearchBar({ value, onChange, placeholder = 'Buscar productos' }) {
  return (
    <div className="flex items-center gap-2 mx-4 my-2 px-4 h-11 rounded-full bg-wa-panel">
      <Search size={18} className="text-wa-sub shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-wa-sub min-w-0"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-wa-sub"><X size={18} /></button>
      )}
    </div>
  );
}

function ProductImage({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} bg-wa-panel flex items-center justify-center text-wa-sub`}>
        <Package size={28} strokeWidth={1.5} />
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />;
}

/** Hoja de selección de producto para insertar en el chat */
export function ProductPicker({ open, onClose, onPick }) {
  const [search, setSearch] = useState('');
  // Se monta solo cuando está abierto (ver ChatView) para no cargar de más
  const { items, loading, hasMore, loadMore } = useProducts(search);
  return (
    <Sheet open={open} onClose={onClose} full>
      <div className="flex items-center gap-2 px-2">
        <button onClick={onClose} className="p-2 rounded-full active:bg-wa-panel"><X size={22} /></button>
        <h2 className="text-[18px] font-medium">Enviar producto</h2>
      </div>
      <SearchBar value={search} onChange={setSearch} />
      <div className="flex-1 overflow-y-auto">
        {items.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} className="w-full flex items-center gap-3 px-4 py-2 active:bg-wa-panel text-left">
            <ProductImage src={p.imagen_url} className="w-14 h-14 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0 border-b border-wa-line pb-2">
              <p className="text-[15px] truncate">{p.nombre}</p>
              <Price p={p} />
              {p.variantes && <p className="text-[13px] text-wa-sub truncate">Talles: {p.variantes}</p>}
            </div>
          </button>
        ))}
        {loading && <div className="flex justify-center py-6"><Spinner /></div>}
        {!loading && items.length === 0 && <p className="text-center text-wa-sub py-10">Sin resultados</p>}
        {hasMore && !loading && items.length > 0 && <Sentinel onVisible={loadMore} />}
      </div>
    </Sheet>
  );
}

/** Detalle del producto + elegir chat al que enviarlo */
function ProductDetail({ product, onClose, conversations }) {
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const [q, setQ] = useState('');
  if (!product) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(productMessage(product));
      toast.success('Copiado');
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const chats = conversations.filter((c) => {
    const { name, phone } = contactOf(c);
    return `${name} ${phone}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  return (
    <Sheet open onClose={onClose} full>
      {choosing ? (
        <>
          <div className="flex items-center gap-2 px-2">
            <button onClick={() => setChoosing(false)} className="p-2 rounded-full active:bg-wa-panel"><ArrowLeft size={22} /></button>
            <h2 className="text-[18px] font-medium">Enviar a…</h2>
          </div>
          <SearchBar value={q} onChange={setQ} placeholder="Buscar chat" />
          <div className="flex-1 overflow-y-auto">
            {chats.map((c) => {
              const { name, phone, thumb } = contactOf(c);
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/chat/${c.id}`, { state: { draft: productMessage(product) } })}
                  className="w-full flex items-center gap-3 px-4 py-2.5 active:bg-wa-panel text-left"
                >
                  <Avatar name={name} seed={phone} src={thumb} size={42} />
                  <div className="min-w-0">
                    <p className="text-[16px] truncate">{name}</p>
                    <p className="text-[13px] text-wa-sub">{phone}</p>
                  </div>
                </button>
              );
            })}
            {chats.length === 0 && <p className="text-center text-wa-sub py-10">No hay chats</p>}
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            <ProductImage src={product.imagen_url} className="w-full aspect-square" />
            <div className="p-4 space-y-2">
              <h2 className="text-[19px] font-medium leading-snug">{product.nombre}</h2>
              <Price p={product} big />
              <p className="text-[14px] text-wa-sub">
                {product.stock > 0 ? `${product.stock} en stock` : 'Sin stock'}
                {product.categorias ? ` · ${product.categorias}` : ''}
              </p>
              {product.variantes && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {product.variantes.split(',').map((v) => (
                    <span key={v} className="px-3 py-1 rounded-full bg-wa-panel text-[14px]">{v.trim()}</span>
                  ))}
                </div>
              )}
              {product.descripcion_vision && (
                <p className="text-[14px] leading-relaxed pt-2 whitespace-pre-wrap">{product.descripcion_vision}</p>
              )}
              {product.permalink && (
                <a href={product.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-wa-green text-[14px] pt-1">
                  <ExternalLink size={15} /> Ver en la tienda
                </a>
              )}
            </div>
          </div>
          <div className="shrink-0 flex gap-2 p-3 border-t border-wa-line">
            <button onClick={copy} className="flex items-center justify-center gap-2 px-5 h-12 rounded-full bg-wa-panel text-[15px] font-medium">
              <Copy size={18} /> Copiar
            </button>
            <button
              onClick={() => setChoosing(true)}
              className="flex-1 flex items-center justify-center gap-2 h-12 rounded-full bg-wa-green text-white text-[15px] font-medium"
            >
              <Send size={18} /> Enviar a un chat
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

export default function ProductsView({ conversations, unread }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const { items, loading, hasMore, loadMore } = useProducts(search);

  return (
    <>
      <header className="shrink-0 bg-wa-bg wa-safe-top">
        <div className="flex items-center h-14 px-4">
          <h1 className="text-[22px] font-semibold text-wa-title">Productos</h1>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar por nombre, categoría…" />
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
          {items.map((p) => (
            <button key={p.id} onClick={() => setSelected(p)} className="text-left rounded-xl overflow-hidden bg-wa-bg border border-wa-line active:opacity-80">
              <ProductImage src={p.imagen_url} className="w-full aspect-square" />
              <div className="p-2.5">
                <p className="text-[14px] leading-snug line-clamp-2 min-h-[2.6em]">{p.nombre}</p>
                <Price p={p} />
                <p className="text-[12px] text-wa-sub truncate mt-0.5">
                  {p.variantes ? `Talles: ${p.variantes}` : `Stock: ${p.stock}`}
                </p>
              </div>
            </button>
          ))}
        </div>
        {loading && <div className="flex justify-center py-8"><Spinner /></div>}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center text-wa-sub pt-16">
            <Package size={48} strokeWidth={1.4} />
            <p className="mt-3">{search ? 'Sin resultados' : 'No hay productos con stock'}</p>
          </div>
        )}
        {hasMore && !loading && items.length > 0 && <Sentinel onVisible={loadMore} />}
      </main>

      <BottomNav unread={unread} />

      {selected && (
        <ProductDetail product={selected} onClose={() => setSelected(null)} conversations={conversations} />
      )}
    </>
  );
}
