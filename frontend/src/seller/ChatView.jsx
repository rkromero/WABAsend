/**
 * Conversación con un cliente — estilo WhatsApp.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, MoreVertical, Phone, Paperclip, Send, Bot, ChevronDown, Image as ImageIcon,
  Camera, FileText, ShoppingBag, Zap, Tag, X, UserCheck, AlertTriangle, Check, Mic, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Avatar, Sheet, Spinner } from './ui.jsx';
import MessageBubble from './MessageBubble.jsx';
import { ProductPicker } from './ProductsView.jsx';
import useVoiceRecorder, { fmtSeconds } from './useVoiceRecorder.js';
import { contactOf, dayKey, dayLabel, isOutgoing, productMessage } from './waUtils.js';

const PRESET_TAGS = ['urgente', 'reclamo', 'presupuesto', 'pedido', 'seguimiento'];
const DAY_MS = 24 * 60 * 60 * 1000;

export default function ChatView({ conversations, tags, setTags, markRead, refreshList }) {
  const { id } = useParams();
  const convId = parseInt(id);
  const navigate = useNavigate();
  const location = useLocation();

  const conv = conversations.find((c) => c.id === convId);
  const { name, phone, thumb } = contactOf(conv);
  const convTags = tags[convId] || [];

  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]); // mensajes optimistas
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState(location.state?.draft || '');
  const [sending, setSending] = useState(false);
  const [botPaused, setBotPaused] = useState(null);
  const [sheet, setSheet] = useState(null); // 'attach' | 'menu' | 'quick' | 'tags' | 'product'
  const [quickReplies, setQuickReplies] = useState(null);
  const [media, setMedia] = useState(null); // { file, url, type }
  const [caption, setCaption] = useState('');
  const [showDown, setShowDown] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { recording, startRecording, finishRecording } = useVoiceRecorder((blob, type) => sendAudio(blob, type));

  const scrollRef = useRef(null);
  const atBottom = useRef(true);
  const inputRef = useRef(null);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const docRef = useRef(null);

  // ── Datos ────────────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (isNaN(convId)) return;
    try {
      const res = await api.get(`/inbox/conversations/${convId}/messages`);
      const payload = res.data?.payload || res.data || [];
      const list = (Array.isArray(payload) ? payload : [])
        .filter((m) => !m.private && m.message_type !== 2 && m.message_type !== 'activity')
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      setMessages(list);
    } catch { /* reintenta en el próximo poll */ }
    finally { setLoading(false); }
  }, [convId]);

  usePolling(fetchMessages, 4000, !isNaN(convId));

  useEffect(() => {
    if (isNaN(convId)) return;
    markRead(convId);
    api.get(`/inbox/conversations/${convId}/bot-status`)
      .then((r) => setBotPaused(!!r.data?.bot_paused))
      .catch(() => setBotPaused(null));
  }, [convId, markRead]);

  // Si llegan mensajes nuevos con el chat abierto, se marcan como leídos
  useEffect(() => {
    if (conv?.unread_count > 0) markRead(convId);
  }, [conv?.unread_count, convId, markRead]);

  // Borrador que viene desde "Enviar a un chat" del catálogo
  useEffect(() => {
    if (location.state?.draft) {
      navigate(location.pathname, { replace: true, state: null });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, []); // eslint-disable-line

  // ── Scroll ───────────────────────────────────────────────────────────────
  const scrollToBottom = (smooth) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (atBottom.current) scrollToBottom(false);
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottom.current = near;
    setShowDown(!near);
  };

  // Autoalto del textarea (hasta ~6 líneas)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // ── Ventana de 24 h de WhatsApp ──────────────────────────────────────────
  const windowClosed = useMemo(() => {
    const lastIn = [...messages].reverse().find((m) => !isOutgoing(m));
    if (!lastIn) return false;
    return Date.now() - lastIn.created_at * 1000 > DAY_MS;
  }, [messages]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  async function setBot(paused, silent) {
    try {
      await api.post(`/inbox/conversations/${convId}/${paused ? 'takeover' : 'release'}`);
      setBotPaused(paused);
      if (!silent) toast.success(paused ? 'Tomaste el chat — el bot no responde' : 'El bot vuelve a responder');
    } catch {
      if (!silent) toast.error('No se pudo cambiar');
    }
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const temp = { id: `tmp-${Date.now()}`, content: body, message_type: 1, status: 'progress', created_at: Date.now() / 1000 };
    setPending((p) => [...p, temp]);
    setText('');
    atBottom.current = true;
    try {
      // Si el bot está activo, el vendedor toma el chat para que no respondan los dos
      if (botPaused === false) await setBot(true, true);
      await api.post(`/inbox/conversations/${convId}/messages`, { message: body });
      await fetchMessages();
      refreshList();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar');
      setText(body);
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
      setSending(false);
    }
  }

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) return toast.error('El archivo supera los 16 MB');
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
    setMedia({ file, url: URL.createObjectURL(file), type });
    setCaption(text);
    setSheet(null);
  }

  function closeMedia() {
    if (media?.url) URL.revokeObjectURL(media.url);
    setMedia(null);
  }

  async function sendMedia() {
    if (!media || sending) return;
    setSending(true);
    try {
      if (botPaused === false) await setBot(true, true);
      const fd = new FormData();
      fd.append('file', media.file);
      if (caption.trim()) fd.append('caption', caption.trim());
      await api.post(`/inbox/conversations/${convId}/media`, fd, { headers: { 'Content-Type': undefined }, timeout: 90000 });
      closeMedia();
      setText('');
      atBottom.current = true;
      await fetchMessages();
      refreshList();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el archivo');
    } finally {
      setSending(false);
    }
  }


  async function sendAudio(blob, type) {
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const temp = { id: `tmp-${Date.now()}`, content: '🎤 Enviando nota de voz…', message_type: 1, status: 'progress', created_at: Date.now() / 1000 };
    setPending((p) => [...p, temp]);
    atBottom.current = true;
    try {
      if (botPaused === false) await setBot(true, true);
      const fd = new FormData();
      fd.append('file', blob, `nota.${ext}`);
      await api.post(`/inbox/conversations/${convId}/audio`, fd, { headers: { 'Content-Type': undefined }, timeout: 90000 });
      await fetchMessages();
      refreshList();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el audio');
      await fetchMessages();
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
    }
  }

  async function openQuick() {
    setSheet('quick');
    if (quickReplies) return;
    try {
      const res = await api.get('/inbox/quick-replies');
      setQuickReplies(res.data || []);
    } catch {
      setQuickReplies([]);
    }
  }

  function insertDraft(value) {
    setText((t) => (t.trim() ? `${t}\n${value}` : value));
    setSheet(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function toggleTag(tag) {
    const has = convTags.includes(tag);
    const next = has ? convTags.filter((t) => t !== tag) : [...convTags, tag];
    setTags((prev) => ({ ...prev, [convId]: next }));
    try {
      if (has) await api.delete(`/inbox/conversations/${convId}/tags/${encodeURIComponent(tag)}`);
      else await api.post(`/inbox/conversations/${convId}/tags`, { tag });
    } catch {
      setTags((prev) => ({ ...prev, [convId]: convTags }));
      toast.error('No se pudo actualizar la etiqueta');
    }
  }

  function addCustomTag() {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, '_').substring(0, 50);
    if (t && !convTags.includes(t)) toggleTag(t);
    setNewTag('');
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const all = [...messages, ...pending];

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
      <header className="shrink-0 bg-wa-bg wa-safe-top border-b border-wa-line">
        <div className="flex items-center h-14 pr-1">
          <button onClick={() => navigate('/')} className="flex items-center gap-0.5 pl-1.5 pr-1 py-2 rounded-full active:bg-wa-panel" aria-label="Volver">
            <ArrowLeft size={22} />
            <Avatar name={name} seed={phone} src={thumb} size={38} />
          </button>
          <div className="flex-1 min-w-0 pl-2" onClick={() => setSheet('menu')}>
            <p className="text-[16.5px] font-medium truncate leading-tight">{name}</p>
            <p className="text-[12.5px] text-wa-sub truncate leading-tight">
              {botPaused === false ? '🤖 Bot respondiendo' : botPaused ? 'Atendido por vos' : phone}
            </p>
          </div>
          {phone && (
            <a href={`tel:${phone}`} className="p-2.5 rounded-full active:bg-wa-panel" aria-label="Llamar">
              <Phone size={21} />
            </a>
          )}
          <button onClick={() => setSheet('menu')} className="p-2.5 rounded-full active:bg-wa-panel" aria-label="Opciones">
            <MoreVertical size={22} />
          </button>
        </div>
      </header>

      {/* Mensajes */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain wa-wallpaper relative pb-2">
        <div className="flex justify-center pt-3 px-6">
          <span className="text-center text-[12px] leading-snug px-3 py-1.5 rounded-lg bg-[#ffeecd] text-[#54656f] dark:bg-[#182229] dark:text-[#ffd279]">
            🔒 Los mensajes se envían desde el WhatsApp de la empresa.
          </span>
        </div>

        {loading && <div className="flex justify-center pt-10"><Spinner /></div>}

        {all.map((m, i) => {
          const prev = all[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const first = newDay || !prev || isOutgoing(prev) !== isOutgoing(m);
          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[12.5px] px-3 py-1 rounded-lg bg-wa-sys text-wa-sub shadow-sm">{dayLabel(m.created_at)}</span>
                </div>
              )}
              {(m.content || m.attachments?.length) ? <MessageBubble msg={m} firstOfGroup={first} /> : null}
            </React.Fragment>
          );
        })}
      </div>

      {showDown && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute right-3 bottom-24 z-10 w-10 h-10 rounded-full bg-wa-bg shadow-lg flex items-center justify-center text-wa-sub"
          aria-label="Ir al final"
        >
          <ChevronDown size={22} />
        </button>
      )}

      {/* Avisos */}
      {botPaused === false && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-wa-panel text-[13px]">
          <Bot size={16} className="text-wa-green shrink-0" />
          <span className="flex-1 text-wa-sub">El bot responde este chat. Al escribir, lo tomás vos.</span>
          <button onClick={() => setBot(true)} className="text-wa-green font-semibold px-2 py-1">Tomar</button>
        </div>
      )}
      {windowClosed && (
        <div className="shrink-0 flex items-start gap-2 px-3 py-2 bg-[#fff3c4] dark:bg-[#3a3000] text-[12.5px] text-[#6b5800] dark:text-[#ffd279]">
          <AlertTriangle size={15} className="shrink-0 mt-px" />
          <span>Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp puede no entregar mensajes libres hasta que vuelva a escribir.</span>
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 flex items-end gap-1.5 px-1.5 pt-1.5 pb-1.5 wa-wallpaper wa-safe-bottom">
        {recording !== null ? (
          <div className="flex-1 flex items-center gap-3 h-12 px-2 rounded-[24px] bg-wa-input shadow-[0_1px_0.5px_rgba(0,0,0,0.1)]">
            <button onClick={() => finishRecording(false)} className="p-2 text-wa-sub" aria-label="Descartar audio">
              <Trash2 size={22} />
            </button>
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[16px] tabular-nums">{fmtSeconds(recording)}</span>
            <span className="flex-1 text-[14px] text-wa-sub truncate">Grabando…</span>
          </div>
        ) : (
        <div className="flex-1 flex items-end min-h-[48px] rounded-[24px] bg-wa-input shadow-[0_1px_0.5px_rgba(0,0,0,0.1)]">
          <button onClick={openQuick} className="p-3 text-wa-sub shrink-0" aria-label="Respuestas rápidas">
            <Zap size={22} />
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder="Mensaje"
            className="flex-1 resize-none bg-transparent outline-none text-[16px] leading-[22px] py-[13px] placeholder:text-wa-sub min-w-0"
          />
          <button onClick={() => setSheet('attach')} className="p-3 text-wa-sub shrink-0 -rotate-45" aria-label="Adjuntar">
            <Paperclip size={21} />
          </button>
          {!text && (
            <button onClick={() => cameraRef.current?.click()} className="py-3 pr-3.5 text-wa-sub shrink-0" aria-label="Cámara">
              <Camera size={21} />
            </button>
          )}
        </div>
        )}
        {recording !== null ? (
          <button
            onClick={() => finishRecording(true)}
            className="w-12 h-12 shrink-0 rounded-full bg-wa-green text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
            aria-label="Enviar audio"
          >
            <Send size={20} className="ml-0.5" />
          </button>
        ) : text.trim() ? (
          <button
            onClick={handleSend}
            disabled={sending}
            className="w-12 h-12 shrink-0 rounded-full bg-wa-green text-white flex items-center justify-center shadow-md disabled:opacity-60 active:scale-95 transition-transform"
            aria-label="Enviar"
          >
            <Send size={20} className="ml-0.5" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="w-12 h-12 shrink-0 rounded-full bg-wa-green text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
            aria-label="Grabar nota de voz"
          >
            <Mic size={22} />
          </button>
        )}
      </div>

      {/* Inputs de archivos ocultos */}
      <input ref={galleryRef} type="file" accept="image/*,video/*" className="hidden" onChange={pickFile} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickFile} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/*" className="hidden" onChange={pickFile} />

      {/* Hoja: adjuntar */}
      <Sheet open={sheet === 'attach'} onClose={() => setSheet(null)}>
        <div className="grid grid-cols-3 gap-y-5 px-4 pt-4 pb-6">
          {[
            [FileText, 'Documento', '#7f66ff', () => docRef.current?.click()],
            [Camera, 'Cámara', '#ff2e74', () => cameraRef.current?.click()],
            [ImageIcon, 'Galería', '#bf59cf', () => galleryRef.current?.click()],
            [ShoppingBag, 'Producto', '#1daa61', () => setSheet('product')],
            [Zap, 'Resp. rápidas', '#ffb32a', openQuick],
          ].map(([Icon, label, color, fn]) => (
            <button key={label} onClick={fn} className="flex flex-col items-center gap-2 active:opacity-70">
              <span className="w-14 h-14 rounded-full flex items-center justify-center text-white" style={{ background: color }}>
                <Icon size={24} />
              </span>
              <span className="text-[13px] text-wa-sub">{label}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* Hoja: respuestas rápidas */}
      <Sheet open={sheet === 'quick'} onClose={() => setSheet(null)}>
        <h2 className="px-4 py-2 text-[17px] font-medium">Respuestas rápidas</h2>
        <div className="overflow-y-auto pb-2">
          {quickReplies === null && <div className="flex justify-center py-6"><Spinner /></div>}
          {quickReplies?.length === 0 && <p className="text-center text-wa-sub py-8 px-6">No hay respuestas rápidas cargadas. Pedile al administrador que las cree.</p>}
          {quickReplies?.map((qr) => (
            <button key={qr.id} onClick={() => insertDraft(qr.mensaje)} className="w-full text-left px-4 py-3 border-b border-wa-line active:bg-wa-panel">
              <p className="text-[15px] font-medium">{qr.titulo}</p>
              <p className="text-[13.5px] text-wa-sub line-clamp-2">{qr.mensaje}</p>
            </button>
          ))}
        </div>
      </Sheet>

      {/* Hoja: opciones del chat */}
      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)}>
        <div className="flex flex-col items-center pt-2 pb-3">
          <Avatar name={name} seed={phone} src={thumb} size={72} />
          <p className="text-[19px] font-medium mt-2">{name}</p>
          <p className="text-[14px] text-wa-sub">{phone}</p>
        </div>
        <div className="pb-3">
          {botPaused !== null && (
            <button onClick={() => { setBot(!botPaused); setSheet(null); }} className="w-full flex items-center gap-4 px-5 py-3.5 active:bg-wa-panel text-[15.5px]">
              {botPaused ? <Bot size={21} className="text-wa-sub" /> : <UserCheck size={21} className="text-wa-sub" />}
              {botPaused ? 'Devolver el chat al bot' : 'Tomar el chat (pausar bot)'}
            </button>
          )}
          <button onClick={() => setSheet('tags')} className="w-full flex items-center gap-4 px-5 py-3.5 active:bg-wa-panel text-[15.5px]">
            <Tag size={21} className="text-wa-sub" /> Etiquetas
            {convTags.length > 0 && <span className="ml-auto text-[13px] text-wa-sub">{convTags.length}</span>}
          </button>
          {phone && (
            <a href={`tel:${phone}`} className="w-full flex items-center gap-4 px-5 py-3.5 active:bg-wa-panel text-[15.5px]">
              <Phone size={21} className="text-wa-sub" /> Llamar
            </a>
          )}
        </div>
      </Sheet>

      {/* Hoja: etiquetas */}
      <Sheet open={sheet === 'tags'} onClose={() => setSheet(null)}>
        <h2 className="px-4 py-2 text-[17px] font-medium">Etiquetas</h2>
        <div className="overflow-y-auto">
          {[...new Set([...PRESET_TAGS, ...convTags])].map((t) => (
            <button key={t} onClick={() => toggleTag(t)} className="w-full flex items-center justify-between px-5 py-3 active:bg-wa-panel text-[15.5px] capitalize">
              {t.replace(/_/g, ' ')}
              <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center ${convTags.includes(t) ? 'bg-wa-green border-wa-green text-white' : 'border-wa-sub'}`}>
                {convTags.includes(t) && <Check size={16} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 p-3 border-t border-wa-line">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomTag()}
            placeholder="Nueva etiqueta"
            className="flex-1 h-11 px-4 rounded-full bg-wa-panel outline-none text-[16px] placeholder:text-wa-sub"
          />
          <button onClick={addCustomTag} className="px-5 h-11 rounded-full bg-wa-green text-white font-medium">Agregar</button>
        </div>
      </Sheet>

      {/* Hoja: selector de producto */}
      {sheet === 'product' && (
        <ProductPicker open onClose={() => setSheet(null)} onPick={(p) => insertDraft(productMessage(p))} />
      )}

      {/* Vista previa de archivo antes de enviar */}
      {media && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col text-white">
          <div className="flex items-center gap-3 p-2 wa-safe-top">
            <button onClick={closeMedia} className="p-2 rounded-full active:bg-white/10"><X size={24} /></button>
            <span className="truncate text-[15px]">{media.file.name}</span>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
            {media.type === 'image' && <img src={media.url} alt="" className="max-w-full max-h-full object-contain" />}
            {media.type === 'video' && <video src={media.url} controls playsInline className="max-w-full max-h-full" />}
            {media.type === 'document' && (
              <div className="flex flex-col items-center gap-3 text-white/80">
                <FileText size={72} strokeWidth={1.2} />
                <span className="text-[15px] px-6 text-center break-all">{media.file.name}</span>
                <span className="text-[13px] text-white/50">{(media.file.size / 1024).toFixed(0)} KB</span>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 p-2 wa-safe-bottom">
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Añade un comentario…"
              className="flex-1 h-12 px-5 rounded-full bg-[#1f2c34] outline-none text-[16px] placeholder:text-white/50"
            />
            <button
              onClick={sendMedia}
              disabled={sending}
              className="w-12 h-12 rounded-full bg-[#1daa61] flex items-center justify-center disabled:opacity-60"
              aria-label="Enviar archivo"
            >
              {sending ? <div className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <Send size={20} className="ml-0.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
