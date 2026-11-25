/**
 * Conversión de audio con ffmpeg (binario de ffmpeg-static).
 *
 * - toOggOpus: formato que WhatsApp acepta para notas de voz (los navegadores
 *   graban en webm/opus o mp4/aac, que Meta no siempre acepta como audio).
 * - toM4a: AAC en mp4, se reproduce en todos los celulares (iPhone no reproduce
 *   el ogg/opus que manda WhatsApp). Es el formato que guardamos en Chatwoot.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import ffmpegPath from 'ffmpeg-static';

const TIMEOUT_MS = 60000;

async function transcode(input, outExt, args) {
  if (!ffmpegPath) throw new Error('ffmpeg no disponible');
  const id = crypto.randomBytes(8).toString('hex');
  const inFile = path.join(os.tmpdir(), `aud_${id}.in`);
  const outFile = path.join(os.tmpdir(), `aud_${id}.${outExt}`);
  await fs.writeFile(inFile, input);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-vn', ...args, outFile]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, TIMEOUT_MS);
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg salió con código ${code}: ${stderr.slice(0, 300)}`));
      });
    });
    return await fs.readFile(outFile);
  } finally {
    fs.unlink(inFile).catch(() => {});
    fs.unlink(outFile).catch(() => {});
  }
}

/** Nota de voz para WhatsApp: ogg/opus mono 48 kHz */
export function toOggOpus(buffer) {
  return transcode(buffer, 'ogg', ['-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip']);
}

/** Audio reproducible en cualquier navegador: AAC en contenedor m4a */
export function toM4a(buffer) {
  return transcode(buffer, 'm4a', ['-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart']);
}
