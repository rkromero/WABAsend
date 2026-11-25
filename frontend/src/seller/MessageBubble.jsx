/**
 * Burbuja de mensaje estilo WhatsApp: texto con formato (*negrita*, _cursiva_,
 * ~tachado~, links), adjuntos, hora y ticks.
 */
import React from 'react';
import { FileText, Download } from 'lucide-react';
import { Ticks } from './ui.jsx';
import { msgTime, isOutgoing } from './waUtils.js';

const TOKEN_RE = /(https?:\/\/[^\s]+|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

export function FormattedText({ text }) {
  const parts = String(text).split(TOKEN_RE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^https?:\/\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-wa-blue underline break-all">
          {p}
        </a>
      );
    }
    if (p.length > 2 && p[0] === '*' && p.endsWith('*')) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (p.length > 2 && p[0] === '_' && p.endsWith('_')) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.length > 2 && p[0] === '~' && p.endsWith('~')) return <s key={i}>{p.slice(1, -1)}</s>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function Attachment({ att }) {
  const url = att.data_url || att.file_url || '';
  const type = att.file_type || '';
  if (!url) return null;

  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block -mx-1.5 -mt-1 mb-1">
        <img src={url} alt="" loading="lazy" className="rounded-md w-full max-h-80 object-cover" />
      </a>
    );
  }
  if (type === 'video') {
    return <video src={url} controls playsInline className="rounded-md w-full max-h-80 -mt-1 mb-1 bg-black" />;
  }
  if (type === 'audio') {
    return <audio src={url} controls className="w-60 max-w-full my-1" />;
  }
  const name = att.file_name || decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Documento');
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-md bg-black/5 dark:bg-white/5 px-3 py-2.5 mb-1 -mx-0.5"
    >
      <FileText size={28} className="text-red-500 shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[14px]">{name}</span>
      <Download size={18} className="text-wa-sub shrink-0" />
    </a>
  );
}

export default function MessageBubble({ msg, firstOfGroup }) {
  const out = isOutgoing(msg);
  const atts = msg.attachments || [];
  const time = msgTime(msg.created_at);
  const hasText = !!msg.content;

  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} px-3 ${firstOfGroup ? 'mt-2' : 'mt-0.5'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-2 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] ${
          out ? 'bg-wa-out' : 'bg-wa-in'
        } ${firstOfGroup ? (out ? 'wa-tail-out' : 'wa-tail-in') : ''}`}
      >
        {atts.map((a) => <Attachment key={a.id || a.data_url} att={a} />)}
        {hasText ? (
          <p className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words px-0.5">
            <FormattedText text={msg.content} />
            {/* Espacio reservado para la hora (como WhatsApp) */}
            <span className="inline-block w-[68px]" />
          </p>
        ) : null}
        <div className={`flex items-center justify-end gap-1 text-[11px] text-wa-sub leading-none ${hasText ? '-mt-3.5' : 'mt-0.5'}`}>
          <span>{time}</span>
          {out && <Ticks status={msg.status} />}
        </div>
      </div>
    </div>
  );
}
