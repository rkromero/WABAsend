# Plan de funcionalidades — Enviador WABA
Última actualización: 2026-03-24

---

## Estado general

```
✅ Fase 1 — Opt-out automático        (completado 2026-03-24 · commit 779ad03)
✅ Fase 2 — Variables en templates    (completado 2026-03-24 · commit d05b7c2)
✅ Fase 3 — Historial por contacto    (completado 2026-03-24)
⬜ Fase 4 — Mensajes multimedia
⬜ Fase 5 — Etiquetas en conversas
⬜ Fase 6 — Carrito abandonado
⬜ Fase 7 — Analytics avanzados
```

---

## ✅ Fase 1 — Opt-out automático
**Completado:** 2026-03-24 · commit `779ad03`

### Qué se hizo
- Tabla `waba_optouts (telefono PK, motivo, created_at)`
- Detección automática en `webhook.js`: STOP, baja, no quiero, cancelar, desuscribir, no me mandes, no me escribas, no gracias
- `scheduler.js`: excluye opt-outs de campañas; los marca `failed` con motivo explicativo
- `followup.js`: condición `NOT EXISTS (waba_optouts)` en la query de candidatos
- `automations.js`: marca como `failed` los pendientes de opt-outs antes de procesar la cola
- API: `GET /api/optouts`, `POST /api/optouts`, `DELETE /api/optouts/:telefono`
- UI en Settings: lista de bajas con fecha/motivo, agregar manual, reactivar con ↺

### Pendiente (mejora futura)
- Badge en el inbox cuando el contacto activo está en opt-out

---

## ✅ Fase 2 — Templates con variables dinámicas
**Completado:** 2026-03-24 · commit `d05b7c2`

### Qué se hizo
- Migración: columna `variable_mapping jsonb DEFAULT '{}'` en `waba_campaigns`
- `whatsapp.js`: `sendTemplateMessage` refactorizado — acepta `string[]` de valores para `{{1}}`, `{{2}}`, etc. Array vacío = sin `components` (evita error #132000 de Meta)
- `scheduler.js`: función `buildParameterValues()` resuelve fuentes por contacto (`nombre`, `telefono`, `email`, `fixed`). Fallback a `[nombre]` para campañas sin mapping (compatibilidad)
- `automations.js`: detecta `hasVariables` por template con cache de 10 min antes de enviar parámetros
- `campaigns.js`: guarda `variable_mapping` en POST
- `CampaignStepper`: badge de cantidad de variables en cada template; al seleccionar uno con variables aparece sección de mapeo con dropdowns + preview en tiempo real con datos de ejemplo; Step5 muestra resumen del mapping y mensaje de muestra

---

## ✅ Fase 3 — Historial de envíos por contacto
**Completado:** 2026-03-24

### Qué se hizo
- Endpoint `GET /api/contacts/:telefono/history` en `contacts.js`
- Query UNION que une en cronología: `waba_message_logs` + `waba_campaigns` + `waba_conversation_followups` + `incoming_messages` + `waba_automation_queue`
- Devuelve array ordenado por fecha DESC (límite 200) con campo `tipo`: campaña / follow-up / automatización / entrante
- En `Contacts.jsx`: botón con ícono de reloj (History) aparece al hover de cada fila
- Drawer lateral derecho con overlay oscuro, cerrable con click fuera o con X
- Timeline con línea vertical, ícono+color por tipo de evento, badge de estado, fecha relativa con tooltip exacto
- Estado vacío y estado de carga con spinner

---

## ⬜ Fase 4 — Mensajes multimedia en el inbox
**Complejidad:** Media · **Impacto:** Alto (hoy se pierden fotos de clientes)

### Backend — recepción
- En `webhook.js`: procesar `msg.type === 'image' | 'video' | 'document' | 'audio'`
- Guardar en `incoming_messages` con columnas `media_type` y `media_url` (URL temporal de Meta)
- Sincronizar como adjunto en Chatwoot

### Backend — envío
- Endpoint `POST /api/inbox/conversations/:id/media` que recibe `multipart/form-data`
- Subir el archivo a Meta (`POST /{phone-number-id}/media`) → obtener `media_id`
- Enviar como mensaje de imagen/documento con ese `media_id`

### Frontend
- Botón de clip/adjunto junto al textarea del inbox
- Previsualizar imagen seleccionada antes de enviar
- En el chat: renderizar imágenes y archivos en `MessageBubble` (hoy solo muestra texto)

---

## ⬜ Fase 5 — Etiquetas en conversaciones
**Complejidad:** Baja · **Impacto:** Medio (organización del inbox)

### Backend
- Tabla `waba_conversation_tags (id, conversacion_chatwoot_id, tag, created_at)`
- Tags predefinidos: `urgente`, `reclamo`, `presupuesto`, `pedido`, `seguimiento` + custom
- Endpoints: `GET/POST/DELETE /api/inbox/conversations/:id/tags`

### Frontend
- En el header del chat activo: chips de tags con X para eliminar + dropdown para agregar
- En la lista de conversaciones: chips pequeños debajo del preview del último mensaje
- Filtro en el sidebar: "Ver solo urgente" etc.

---

## ⬜ Fase 6 — Carrito abandonado
**Complejidad:** Media-Alta · **Impacto:** Alto (revenue directo)

### Backend
- Cron en scheduler: `GET /wc/v3/orders?status=pending` cada 2h
- Tabla `waba_abandoned_carts (id, woo_order_id, telefono, monto, items_json, reminder_sent_at, converted)`
- Lógica: buscar pedidos pendientes de más de X horas sin reminder → enviar template + link al pedido
- Marcar `converted = true` cuando llegue `order.completed` con ese `woo_order_id` vía WooCommerce webhook
- Cooldown: máximo 1 reminder por pedido

### Frontend
- Sección en Automatizaciones: toggle para activar, delay configurable (2h / 4h / 24h), template a usar
- Tabla: pendientes / reminders enviados / convertidos / revenue recuperado

---

## ⬜ Fase 7 — Analytics avanzados
**Complejidad:** Media · **Impacto:** Estratégico (decisiones de negocio)

### Backend
- `GET /api/analytics/campaigns` → por campaña: enviados, entregados, leídos, respondieron, convirtieron
- `GET /api/analytics/funnel?desde=&hasta=` → funnel agregado del período
- `GET /api/analytics/revenue` → revenue atribuido por tipo (campaña / follow-up / automatización) por mes
- "Respondieron" = al menos 1 mensaje entrante de ese teléfono en las 48h siguientes al envío

### Frontend
- Nueva página "Analytics" en el sidebar
- Selector de campaña o período
- Funnel visual: enviados → entregados → leídos → respondieron → compraron
- Gráfico de revenue mensual por tipo
- Tabla de campañas con métricas ordenable por conversión
