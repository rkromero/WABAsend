import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

/**
 * Componente drag & drop para importar contactos desde Excel.
 * Columnas requeridas: nombre, telefono
 * El teléfono debe estar en formato internacional (ej: 5491112345678)
 */
export default function ExcelUploader({ onImported }) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview]       = useState(null); // { contacts, errors }
  const [result, setResult]         = useState(null); // resultado del import
  const [loading, setLoading]       = useState(false);
  const inputRef = useRef(null);

  function parseExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const contacts = [];
        const errors   = [];

        rows.forEach((row, i) => {
          // Normalizar claves a minúsculas para tolerar variantes del header
          const normalized = Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()])
          );

            const nombre   = normalized['nombre'] || normalized['name'] || '';
          const telefono = (normalized['telefono'] || normalized['phone'] || normalized['tel'] || '')
            .replace(/\D/g, '');
          const email    = (normalized['email'] || normalized['correo'] || normalized['mail'] || '').toLowerCase().trim();

          if (!nombre) {
            errors.push({ fila: i + 2, problema: 'Nombre vacío', telefono });
          } else if (telefono.length < 10 || telefono.length > 15) {
            errors.push({ fila: i + 2, problema: `Teléfono inválido: "${telefono}"`, nombre });
          } else {
            contacts.push({ nombre, telefono, email: email || null });
          }
        });

        setPreview({ contacts, errors, fileName: file.name });
      } catch {
        toast.error('No se pudo leer el archivo. Asegurate de que sea un .xlsx o .xls válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      toast.error('Solo se aceptan archivos .xlsx o .xls');
      return;
    }
    parseExcel(file);
  }

  async function handleImport() {
    if (!preview?.contacts?.length) return;
    setLoading(true);
    try {
      const res = await api.post('/contacts/bulk', { contacts: preview.contacts });
      const { imported, skipped, errors: backendErrors } = res.data;
      setPreview(null);
      if (skipped === 0 && (!backendErrors || backendErrors.length === 0)) {
        toast.success(`${imported} contactos importados correctamente`);
        onImported?.();
      } else {
        // Mostrar resultado detallado con errores
        setResult({ imported, skipped, errors: backendErrors || [] });
        if (imported > 0) onImported?.();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setPreview(null);
    setResult(null);
  }

  return (
    <div className="space-y-4">

      {/* Panel de resultado post-import con errores detallados */}
      {result && (
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-base-border">
            <p className="text-sm font-medium text-white">Resultado de la importación</p>
            <button onClick={resetAll} className="text-gray-500 hover:text-gray-300">
              <X size={16} />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} className="text-green-400" />
                <span className="text-gray-300">{result.imported} importados</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle size={15} className="text-red-400" />
                <span className="text-gray-300">{result.skipped} con error de base de datos</span>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="p-3 bg-red-500/8 border border-red-500/20 rounded-lg">
                <p className="text-xs font-medium text-red-400 mb-2">
                  Detalle de errores:
                </p>
                <ul className="space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-400/80 font-mono">
                      {e.nombre || '—'} / {e.telefono || '—'}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button onClick={resetAll} className="btn-secondary text-xs">
              Importar otro archivo
            </button>
          </div>
        </div>
      )}

      {/* Drop zone */}
      {!preview && !result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFile(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
            transition-all duration-200
            ${isDragging
              ? 'border-accent bg-accent/5 scale-[1.01]'
              : 'border-base-border hover:border-white/20 hover:bg-white/[0.02]'
            }
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <Upload size={32} className="mx-auto text-gray-500 mb-3" />
          <p className="text-sm text-gray-300 font-medium">
            Arrastrá tu archivo Excel aquí
          </p>
          <p className="text-xs text-gray-500 mt-1">
            o hacé clic para seleccionar — .xlsx / .xls
          </p>
          <p className="text-xs text-gray-600 mt-3">
            Columnas requeridas: <code className="text-accent/80">nombre</code>, <code className="text-accent/80">telefono</code>
            {' '}· Opcional: <code className="text-accent/80">email</code> (para tracking de conversiones)
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="glass-card overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-base-border">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={18} className="text-accent" />
              <div>
                <p className="text-sm font-medium text-white">{preview.fileName}</p>
                <p className="text-xs text-gray-500">
                  {preview.contacts.length} contactos válidos
                  {preview.errors.length > 0 && ` · ${preview.errors.length} con errores`}
                </p>
              </div>
            </div>
            <button onClick={() => setPreview(null)} className="text-gray-500 hover:text-gray-300">
              <X size={16} />
            </button>
          </div>

          {/* Tabla de preview */}
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
              Primeros 10 contactos
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">Nombre</th>
                    <th className="pb-2 pr-4">Teléfono</th>
                    <th className="pb-2">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-border">
                  {preview.contacts.slice(0, 10).map((c, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 text-gray-200">{c.nombre}</td>
                      <td className="py-2 pr-4 text-gray-400 font-mono text-xs">{c.telefono}</td>
                      <td className="py-2 text-gray-400 text-xs">{c.email || <span className="text-gray-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.contacts.length > 10 && (
                <p className="text-xs text-gray-600 mt-2 text-center">
                  ... y {preview.contacts.length - 10} más
                </p>
              )}
            </div>

            {/* Errores */}
            {preview.errors.length > 0 && (
              <div className="mt-4 p-3 bg-red-500/8 border border-red-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs font-medium text-red-400">
                    {preview.errors.length} fila(s) con errores (serán omitidas)
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {preview.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="text-xs text-red-400/80">
                      Fila {e.fila}: {e.problema}
                    </li>
                  ))}
                  {preview.errors.length > 5 && (
                    <li className="text-xs text-gray-600">
                      ... y {preview.errors.length - 5} más
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Acciones */}
            <div className="flex gap-3 mt-4">
              <button onClick={handleImport} disabled={loading} className="btn-primary flex-1">
                <CheckCircle2 size={15} />
                {loading
                  ? 'Importando...'
                  : `Importar ${preview.contacts.length} contactos`}
              </button>
              <button onClick={() => setPreview(null)} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
