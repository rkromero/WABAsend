/**
 * Selector de plantillas aprobadas por Meta para reabrir una conversación
 * cuando la ventana de 24 h está vencida.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowLeft, Search, Send, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import { Sheet, Spinner } from './ui.jsx';
import { FormattedText } from './MessageBubble.jsx';

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
const CATEGORY = { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' };

function humanize(name) {
  const s = name.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fill(text, params) {
  return text.replace(VAR_RE, (_, n) => params[Number(n) - 1]?.trim() || `{{${n}}}`);
}

/** Vista previa como burbuja saliente */
function Preview({ tpl, params }) {
  return (
    <div className="wa-wallpaper rounded-xl p-3">
      <div className="ml-auto max-w-[92%] rounded-lg bg-wa-out px-3 py-2 shadow-sm wa-tail-out">
        {tpl.header && <p className="font-semibold text-[15px] mb-1">{tpl.header}</p>}
        <p className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words">
          <FormattedText text={fill(tpl.body, params)} />
        </p>
        {tpl.footer && <p className="text-[13px] text-wa-sub mt-1">{tpl.footer}</p>}
        {tpl.buttons.length > 0 && (
          <div className="mt-2 border-t border-black/10 dark:border-white/10 pt-1.5 space-y-1">
            {tpl.buttons.map((b) => (
              <p key={b} className="text-center text-wa-blue text-[14px] font-medium">{b}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TemplatePicker({ open, onClose, convId, contactName, onSent }) {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [params, setParams] = useState([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || templates) return;
    api.get('/inbox/templates')
      .then((res) => setTemplates(res.data || []))
      .catch((err) => { setError(err.message); setTemplates([]); });
  }, [open, templates]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (templates || []).filter((t) => !term || `${t.name} ${t.body}`.toLowerCase().includes(term));
  }, [templates, q]);

  function choose(t) {
    // La variable {{1}} suele ser el nombre: se precarga con el nombre del cliente
    const first = (contactName || '').split(' ')[0];
    const initial = Array.from({ length: t.varCount }, (_, i) => (i === 0 && first && !/^\+?\d+$/.test(first) ? first : ''));
    setSelected(t);
    setParams(initial);
  }

  function close() {
    setSelected(null);
    setQ('');
    onClose();
  }

  async function send() {
    if (!selected || sending) return;
    if (params.some((p) => !p.trim())) return toast.error('Completá todas las variables');
    setSending(true);
    try {
      await api.post(`/inbox/conversations/${convId}/template`, {
        name: selected.name,
        language: selected.language,
        params,
      });
      toast.success('Plantilla enviada');
      close();
      onSent?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar la plantilla');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} full>
      {selected ? (
        <>
          <div className="flex items-center gap-2 px-2">
            <button onClick={() => setSelected(null)} className="p-2 rounded-full active:bg-wa-panel"><ArrowLeft size={22} /></button>
            <h2 className="text-[17px] font-medium truncate">{humanize(selected.name)}</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <Preview tpl={selected} params={params} />
            {params.map((val, i) => (
              <label key={i} className="block">
                <span className="text-[13px] text-wa-sub pl-1">Variable {`{{${i + 1}}}`}</span>
                <input
                  value={val}
                  onChange={(e) => setParams((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={i === 0 ? 'Ej: nombre del cliente' : 'Completar'}
                  className="mt-1 w-full h-12 px-4 rounded-xl bg-wa-panel outline-none text-[16px] border-2 border-transparent focus:border-wa-green"
                />
              </label>
            ))}
            {selected.varCount === 0 && <p className="text-[13.5px] text-wa-sub text-center">Esta plantilla no tiene variables.</p>}
          </div>
          <div className="shrink-0 p-3 border-t border-wa-line">
            <button
              onClick={send}
              disabled={sending}
              className="w-full h-12 rounded-full bg-wa-green text-white text-[16px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Send size={18} /> {sending ? 'Enviando…' : 'Enviar plantilla'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 px-2">
            <button onClick={close} className="p-2 rounded-full active:bg-wa-panel"><X size={22} /></button>
            <div className="min-w-0">
              <h2 className="text-[17px] font-medium">Elegí una plantilla</h2>
              <p className="text-[12.5px] text-wa-sub leading-tight">Aprobadas por Meta · reabren la conversación</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mx-4 my-2 px-4 h-11 rounded-full bg-wa-panel">
            <Search size={18} className="text-wa-sub shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar plantilla"
              className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-wa-sub min-w-0"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {templates === null && <div className="flex justify-center py-10"><Spinner /></div>}
            {templates && list.length === 0 && (
              <div className="flex flex-col items-center text-center text-wa-sub px-8 py-12">
                <FileText size={44} strokeWidth={1.4} />
                <p className="mt-3 text-[15px]">
                  {error || (q ? 'Ninguna plantilla coincide' : 'No hay plantillas aprobadas disponibles. Pedile al administrador que cree una en Meta.')}
                </p>
              </div>
            )}
            {list.map((t) => (
              <button
                key={`${t.name}_${t.language}`}
                onClick={() => choose(t)}
                className="w-full text-left px-4 py-3 border-b border-wa-line active:bg-wa-panel"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[15.5px] font-medium truncate flex-1">{humanize(t.name)}</span>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-wa-chip text-wa-sub">
                    {CATEGORY[t.category] || t.category} · {t.language}
                  </span>
                </div>
                <p className="text-[13.5px] text-wa-sub line-clamp-2 mt-0.5">{t.header ? `${t.header} — ` : ''}{t.body}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
