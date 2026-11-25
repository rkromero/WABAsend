/**
 * Vista previa a pantalla completa de un archivo antes de enviarlo (como WhatsApp).
 */
import React from 'react';
import { X, FileText, Send } from 'lucide-react';

export default function MediaPreview({ media, caption, setCaption, sending, onClose, onSend }) {
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col text-white">
      <div className="flex items-center gap-3 p-2 wa-safe-top">
        <button onClick={onClose} className="p-2 rounded-full active:bg-white/10"><X size={24} /></button>
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
          onClick={onSend}
          disabled={sending}
          className="w-12 h-12 rounded-full bg-[#1daa61] flex items-center justify-center disabled:opacity-60"
          aria-label="Enviar archivo"
        >
          {sending ? <div className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <Send size={20} className="ml-0.5" />}
        </button>
      </div>
    </div>
  );
}
