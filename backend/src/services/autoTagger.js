/**
 * Servicio de auto-etiquetado de conversaciones con IA
 * Autor: Turnio
 * Fecha: 2026-03-25
 *
 * Usa GPT-4o-mini para clasificar el mensaje entrante y aplicar
 * etiquetas automáticamente a la conversación en waba_conversation_tags.
 *
 * Se llama en background (fire-and-forget) desde el webhook — nunca
 * interrumpe el flujo principal aunque falle.
 */

import OpenAI from 'openai';
import { query } from '../db/index.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VALID_TAGS = ['urgente', 'reclamo', 'presupuesto', 'pedido', 'seguimiento'];

const SYSTEM_PROMPT = `Sos un clasificador de mensajes de WhatsApp para un negocio argentino.
Analizá el mensaje del cliente y devolvé un array JSON con las etiquetas que aplican.
Etiquetas disponibles: urgente, reclamo, presupuesto, pedido, seguimiento.

Criterios:
- urgente: el cliente expresa urgencia, apuro, enojo fuerte o desesperación
- reclamo: queja, problema con un producto o pedido, pide solución o explicación
- presupuesto: pregunta por precios, cotizaciones, cuánto cuesta algo
- pedido: consulta o seguimiento de un pedido específico (número, estado, entrega)
- seguimiento: retoma algo anterior, "como quedamos", "te escribo por lo de ayer"

Devolvé SOLO el array JSON, sin explicación ni texto adicional.
Ejemplos:
- "necesito urgente el pedido 1234" → ["urgente","pedido"]
- "cuánto sale la remera azul talle M?" → ["presupuesto"]
- "hola buenas" → []
- "me llegó roto el producto, quiero el reembolso" → ["reclamo"]
- "me llamás cuando puedas, sin apuro" → []`;

/**
 * Clasifica un mensaje con GPT-4o-mini y aplica los tags detectados
 * a la conversación en la base de datos.
 *
 * Es silencioso ante errores — nunca debe cortar el flujo del webhook.
 *
 * @param {number} chatwootConversationId - ID de la conversación en Chatwoot/DB local
 * @param {string} messageText            - Texto del mensaje a clasificar
 */
export async function autoTagConversation(chatwootConversationId, messageText) {
  if (!chatwootConversationId || !messageText?.trim()) return;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // Limitar a 500 chars para reducir tokens y latencia
        { role: 'user', content: messageText.substring(0, 500) },
      ],
      max_tokens: 50,
      temperature: 0, // determinista — siempre el mismo resultado para el mismo input
    });

    const raw = response.choices[0]?.message?.content?.trim() || '[]';

    // Parsear el JSON devuelto por el modelo
    let tags = [];
    try {
      tags = JSON.parse(raw);
    } catch {
      // Si el modelo no devolvió JSON válido, buscar tags mencionados en el texto
      tags = VALID_TAGS.filter((t) => raw.includes(t));
    }

    // Solo aceptar tags que existen en la lista predefinida
    const validTags = tags.filter((t) => VALID_TAGS.includes(t));
    if (validTags.length === 0) return;

    // Insertar en DB — ON CONFLICT DO NOTHING para no duplicar tags ya existentes
    for (const tag of validTags) {
      await query(
        `INSERT INTO waba_conversation_tags (conversacion_chatwoot_id, tag)
         VALUES ($1, $2)
         ON CONFLICT (conversacion_chatwoot_id, tag) DO NOTHING`,
        [chatwootConversationId, tag]
      );
    }

    console.log(`[AutoTag] Conv ${chatwootConversationId} → [${validTags.join(', ')}]`);
  } catch (err) {
    // Silencioso — el auto-tag nunca debe interrumpir el flujo principal
    console.warn(`[AutoTag] Error clasificando conv ${chatwootConversationId}:`, err.message);
  }
}
