/**
 * Aviso para activar las notificaciones push. Insiste hasta que estén activadas
 * (los navegadores exigen que el usuario toque un botón para dar el permiso).
 */
import React, { useState } from 'react';
import { Bell, BellOff, Share } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import { pushSupported, requestPushPermission, isIOS, isStandalone } from '../lib/pwa.js';

export function useNotificationStatus() {
  const calc = () => {
    if (isIOS() && !isStandalone()) return 'ios-install'; // en iPhone el push solo funciona con la app instalada
    if (!pushSupported()) return 'unsupported';
    return Notification.permission; // default | granted | denied
  };
  const [status, setStatus] = useState(calc);
  return [status, setStatus];
}

export default function NotificationBanner() {
  const [status, setStatus] = useNotificationStatus();
  const [busy, setBusy] = useState(false);

  if (status === 'granted' || status === 'unsupported') return null;

  async function activate() {
    setBusy(true);
    const result = await requestPushPermission(api);
    setBusy(false);
    setStatus(result);
    if (result === 'granted') toast.success('Notificaciones activadas');
    else if (result === 'denied') toast.error('Bloqueaste las notificaciones');
  }

  const box = 'mx-3 mt-1 mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5';

  if (status === 'ios-install') {
    return (
      <div className={`${box} bg-wa-chipon text-wa-chiptext`}>
        <Bell size={22} className="shrink-0" />
        <p className="flex-1 text-[13.5px] leading-snug">
          Para recibir avisos de mensajes en iPhone, instalá la app: tocá <Share size={13} className="inline" /> <b>Compartir</b> → <b>Agregar a inicio</b> y abrila desde el ícono.
        </p>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={`${box} bg-[#fde2e1] dark:bg-[#3b1a1a] text-[#8a1c1c] dark:text-[#ffb4ab]`}>
        <BellOff size={22} className="shrink-0" />
        <p className="flex-1 text-[13.5px] leading-snug">
          <b>Notificaciones bloqueadas.</b> Activalas desde los ajustes del teléfono: Ajustes → Apps → Ventas (o Chrome) → Notificaciones → Permitir.
        </p>
      </div>
    );
  }

  return (
    <div className={`${box} bg-wa-chipon text-wa-chiptext`}>
      <Bell size={22} className="shrink-0" />
      <div className="flex-1 min-w-0 text-[13.5px] leading-snug">
        <p className="font-semibold">Activá las notificaciones</p>
        <p>Para enterarte de cada mensaje aunque la app esté cerrada.</p>
      </div>
      <button
        onClick={activate}
        disabled={busy}
        className="shrink-0 px-3.5 h-9 rounded-full bg-wa-green text-white text-[14px] font-semibold disabled:opacity-60"
      >
        Activar
      </button>
    </div>
  );
}
