/**
 * AssistedImporter — modal de importación asistida de PDFs.
 *
 * Flujo:
 *  1. Se muestra la lista de artículos sin PDF (con DOI)
 *  2. "Iniciar sesión" → registra timestamp, abre los DOIs en pestañas del navegador
 *  3. Usuario descarga los PDFs manualmente y vuelve
 *  4. "Finalizar y emparejar" → backend escanea Downloads y hace fuzzy matching
 *  5. Se muestran los matches para revisión: usuario acepta/rechaza cada uno
 *  6. "Confirmar seleccionados" → importa los PDFs aceptados y extrae texto
 */

import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  X, ExternalLink, CheckCircle, XCircle, AlertTriangle,
  FolderOpen, Loader, ChevronRight, FileText, RefreshCw,
  CheckSquare, Square, Info, Zap,
} from 'lucide-react';

// ── Paleta de scores ──────────────────────────────────────────────────────────
function ScoreBadge({ score, lowConfidence }) {
  const pct = Math.round(score);
  let color = 'bg-green-100 text-green-700';
  if (pct < 70) color = 'bg-amber-100 text-amber-700';
  if (pct < 50) color = 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
      {pct}%
      {lowConfidence && <AlertTriangle size={10} className="ml-0.5" />}
    </span>
  );
}

// ── Tarjeta de match individual ───────────────────────────────────────────────
function MatchCard({ match, accepted, onToggle }) {
  const isLow = match.low_confidence || match.score < 60;

  return (
    <div
      className={`border rounded-xl p-4 transition-all cursor-pointer
        ${accepted
          ? 'border-green-400 bg-green-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300'
        }
        ${isLow ? 'border-l-4 border-l-amber-400' : ''}`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div className={`mt-0.5 shrink-0 ${accepted ? 'text-green-500' : 'text-gray-300'}`}>
          {accepted ? <CheckSquare size={20} /> : <Square size={20} />}
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {/* PDF descargado */}
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <FileText size={11} /> Archivo PDF
            </p>
            <p className="text-sm font-medium text-gray-700 truncate" title={match.pdf_name}>
              📄 {match.pdf_name}
            </p>
            {match.pdf_title && (
              <p className="text-xs text-gray-500 italic line-clamp-2" title={match.pdf_title}>
                "{match.pdf_title}"
              </p>
            )}
          </div>

          {/* Divider con score */}
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t border-dashed border-gray-200" />
            <ScoreBadge score={match.score} lowConfidence={isLow} />
            <div className="flex-1 border-t border-dashed border-gray-200" />
          </div>

          {/* Artículo en BD */}
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Artículo en BD
            </p>
            <p className="text-sm font-medium text-gray-800 line-clamp-2" title={match.ref_title}>
              {match.ref_title}
            </p>
            <p className="text-xs text-gray-400">
              {match.ref_authors?.split(/[,;]/)[0]}
              {match.ref_year ? ` (${match.ref_year})` : ''}
              {match.ref_doi && (
                <span className="ml-1 text-blue-400">· DOI: {match.ref_doi}</span>
              )}
            </p>
          </div>

          {isLow && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
              <AlertTriangle size={12} />
              Confianza baja — verifica que corresponden antes de aceptar
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function AssistedImporter({ refs, onClose, onImported }) {
  // refs: lista de objetos {id, title, doi, authors, year} sin PDF

  const [phase, setPhase]             = useState('intro');    // intro | session | matching | done
  const [sinceTs, setSinceTs]         = useState(null);
  const [openedDois, setOpenedDois]   = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanResult, setScanResult]   = useState(null);
  const [accepted, setAccepted]       = useState({});         // {pdf_path: bool}
  const [confirming, setConfirming]   = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [dlFolder, setDlFolder]       = useState('');
  const [error, setError]             = useState('');

  // Solo refs con DOI (las que puede abrir en el navegador)
  const refsWithDoi    = refs.filter(r => r.doi);
  const refsWithoutDoi = refs.filter(r => !r.doi);

  useEffect(() => {
    // Obtener la carpeta Downloads detectada
    axios.get('/api/pdfs/assisted/downloads-folder')
      .then(r => setDlFolder(r.data.path))
      .catch(() => {});
  }, []);

  // ── Iniciar sesión asistida ───────────────────────────────────────────────
  const startSession = () => {
    const ts = Date.now() / 1000;  // timestamp Unix (segundos)
    setSinceTs(ts);
    setOpenedDois([]);
    setPhase('session');
  };

  const openDoi = (ref) => {
    const url = `https://doi.org/${ref.doi}`;
    window.open(url, '_blank', 'noopener');
    setOpenedDois(prev => prev.includes(ref.doi) ? prev : [...prev, ref.doi]);
  };

  const openAll = () => {
    refsWithDoi.forEach((ref, i) => {
      setTimeout(() => openDoi(ref), i * 300);  // pequeño delay para no bloquear popups
    });
  };

  // ── Escanear Downloads ────────────────────────────────────────────────────
  const scanDownloads = async () => {
    setScanning(true);
    setError('');
    try {
      const res = await axios.post('/api/pdfs/assisted/scan', {
        since_ts:      sinceTs,
        reference_ids: refsWithDoi.map(r => r.id),
        min_score:     55,
      });
      setScanResult(res.data);

      // Pre-seleccionar matches con score >= 70
      const preAccepted = {};
      for (const m of (res.data.matches || [])) {
        preAccepted[m.pdf_path] = m.score >= 70;
      }
      for (const m of (res.data.low_confidence || [])) {
        preAccepted[m.pdf_path] = false;  // no pre-seleccionar baja confianza
      }
      setAccepted(preAccepted);
      setPhase('matching');
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al escanear la carpeta de descargas');
    } finally {
      setScanning(false);
    }
  };

  // ── Confirmar seleccionados ───────────────────────────────────────────────
  const confirmSelected = async () => {
    const allMatches = [
      ...(scanResult?.matches       || []),
      ...(scanResult?.low_confidence || []),
    ];
    const toConfirm = allMatches
      .filter(m => accepted[m.pdf_path])
      .map(m => ({ pdf_path: m.pdf_path, reference_id: m.reference_id }));

    if (!toConfirm.length) {
      setError('No hay matches seleccionados para confirmar');
      return;
    }

    setConfirming(true);
    setError('');
    try {
      const res = await axios.post('/api/pdfs/assisted/confirm', {
        confirmations: toConfirm,
      });
      setConfirmResult(res.data);
      setPhase('done');
      if (onImported) onImported(res.data.ok);
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al confirmar los PDFs');
    } finally {
      setConfirming(false);
    }
  };

  // ── Contadores ────────────────────────────────────────────────────────────
  const allMatches     = [...(scanResult?.matches || []), ...(scanResult?.low_confidence || [])];
  const acceptedCount  = Object.values(accepted).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
              <Zap size={16} className="text-violet-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800">Agregar PDF asistido</h2>
              <p className="text-xs text-gray-400">
                {phase === 'intro'    && 'Descarga manual + emparejamiento automático'}
                {phase === 'session'  && `Sesión activa · ${openedDois.length}/${refsWithDoi.length} DOIs abiertos`}
                {phase === 'matching' && `${allMatches.length} coincidencias encontradas`}
                {phase === 'done'     && '¡Importación completada!'}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── INTRO ── */}
          {phase === 'intro' && (
            <div className="space-y-4">
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-700 space-y-2">
                <p className="font-semibold flex items-center gap-2">
                  <Info size={15} /> ¿Cómo funciona?
                </p>
                <ol className="space-y-1 list-decimal list-inside text-violet-600">
                  <li>Haz clic en "Iniciar sesión" — registramos el momento exacto</li>
                  <li>Abrimos los DOIs de los artículos sin PDF en nuevas pestañas</li>
                  <li>Descarga los PDFs que puedas desde tu red universitaria</li>
                  <li>Vuelve aquí y pulsa "Finalizar y emparejar"</li>
                  <li>Revisamos tu carpeta Descargas y emparejamos automáticamente</li>
                  <li>Confirmas los matches correctos → listos para análisis</li>
                </ol>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-400 mb-1">Artículos sin PDF</p>
                  <p className="text-2xl font-bold text-gray-700">{refs.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {refsWithDoi.length} con DOI · {refsWithoutDoi.length} sin DOI
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-400 mb-1">Carpeta Descargas</p>
                  <p className="text-xs font-mono text-gray-600 break-all">{dlFolder || '…'}</p>
                </div>
              </div>

              {refsWithoutDoi.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                  <span className="font-semibold">{refsWithoutDoi.length} artículos sin DOI</span>{' '}
                  no se pueden abrir automáticamente. Tendrás que buscarlos manualmente.
                </div>
              )}

              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {refsWithDoi.map(ref => (
                  <div key={ref.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-gray-700 font-medium" title={ref.title}>{ref.title}</p>
                      <p className="text-xs text-gray-400">DOI: {ref.doi}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SESIÓN ACTIVA ── */}
          {phase === 'session' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
                <p className="font-semibold mb-1">Sesión iniciada ✓</p>
                <p className="text-blue-600">
                  Registraremos todos los PDFs descargados a partir de ahora.
                  Abre los DOIs, descarga los PDFs desde tu red universitaria,
                  y cuando termines haz clic en "Finalizar y emparejar".
                </p>
              </div>

              {/* Botón abrir todos */}
              <button
                onClick={openAll}
                className="w-full flex items-center justify-center gap-2 px-4 py-3
                           bg-blue-600 text-white text-sm font-medium rounded-xl
                           hover:bg-blue-700 transition-colors">
                <ExternalLink size={15} />
                Abrir todos los DOIs ({refsWithDoi.length} pestañas)
              </button>

              {/* Lista individual */}
              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {refsWithDoi.map(ref => {
                  const isOpen = openedDois.includes(ref.doi);
                  return (
                    <div key={ref.id} className={`flex items-center gap-3 px-3 py-2.5
                      ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0
                        ${isOpen ? 'bg-blue-500' : 'bg-gray-200'}`}>
                        {isOpen
                          ? <CheckCircle size={12} className="text-white" />
                          : <span className="text-xs text-gray-400 font-bold" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-gray-700 font-medium">{ref.title}</p>
                        <p className="text-xs text-gray-400">DOI: {ref.doi}</p>
                      </div>
                      <button
                        onClick={() => openDoi(ref)}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium
                          ${isOpen
                            ? 'text-blue-600 bg-blue-100 hover:bg-blue-200'
                            : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                          }`}>
                        <ExternalLink size={11} />
                        {isOpen ? 'Reabrir' : 'Abrir'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {refsWithoutDoi.length > 0 && (
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                  {refsWithoutDoi.length} artículos sin DOI no están en la lista.
                  Puedes buscarlos manualmente y descargar los PDFs también —
                  el emparejador los detectará igualmente.
                </div>
              )}
            </div>
          )}

          {/* ── REVISIÓN DE MATCHES ── */}
          {phase === 'matching' && scanResult && (
            <div className="space-y-4">
              {/* Resumen del escaneo */}
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-2xl font-bold text-gray-700">{scanResult.pdfs_found}</p>
                  <p className="text-xs text-gray-400">PDFs encontrados</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                  <p className="text-2xl font-bold text-green-600">{scanResult.matches?.length || 0}</p>
                  <p className="text-xs text-green-600">Alta confianza</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
                  <p className="text-2xl font-bold text-amber-600">{scanResult.low_confidence?.length || 0}</p>
                  <p className="text-xs text-amber-600">Baja confianza</p>
                </div>
              </div>

              {scanResult.pdfs_found === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 space-y-2">
                  <p className="font-semibold">No se encontraron PDFs nuevos en:</p>
                  <p className="font-mono text-xs bg-amber-100 rounded px-2 py-1">{scanResult.downloads_folder}</p>
                  <p>Asegúrate de haber descargado los PDFs después de iniciar la sesión.
                     Si tu navegador guarda en otra carpeta, puedes configurarla con la variable
                     <code className="mx-1 px-1 bg-amber-100 rounded">SLR_DOWNLOADS_DIR</code>
                     en el backend/.env</p>
                </div>
              )}

              {allMatches.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-600">
                      Revisa y acepta los matches correctos:
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const all = {};
                          allMatches.forEach(m => { all[m.pdf_path] = true; });
                          setAccepted(all);
                        }}
                        className="text-xs text-green-600 hover:text-green-700 font-medium">
                        Aceptar todos
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => setAccepted({})}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">
                        Ninguno
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Alta confianza primero */}
                    {(scanResult.matches || []).map(m => (
                      <MatchCard
                        key={m.pdf_path}
                        match={m}
                        accepted={!!accepted[m.pdf_path]}
                        onToggle={() => setAccepted(a => ({ ...a, [m.pdf_path]: !a[m.pdf_path] }))}
                      />
                    ))}

                    {/* Baja confianza */}
                    {(scanResult.low_confidence || []).length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide pt-2">
                          ⚠️ Baja confianza — verifica antes de aceptar
                        </p>
                        {(scanResult.low_confidence || []).map(m => (
                          <MatchCard
                            key={m.pdf_path}
                            match={m}
                            accepted={!!accepted[m.pdf_path]}
                            onToggle={() => setAccepted(a => ({ ...a, [m.pdf_path]: !a[m.pdf_path] }))}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}

              {/* PDFs sin match */}
              {scanResult.unmatched_pdfs?.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    PDFs sin match automático ({scanResult.unmatched_pdfs.length})
                  </p>
                  <div className="space-y-1">
                    {scanResult.unmatched_pdfs.map(p => (
                      <p key={p} className="text-xs text-gray-500 font-mono truncate">{p.split(/[/\\]/).pop()}</p>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Puedes subir estos PDFs manualmente usando el botón "Subir PDF" de cada artículo.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && confirmResult && (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle size={32} className="text-green-500" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">
                  {confirmResult.ok} PDF{confirmResult.ok !== 1 ? 's' : ''} importado{confirmResult.ok !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Textos extraídos y listos para análisis en Screening
                </p>
              </div>
              {confirmResult.errors?.length > 0 && (
                <div className="w-full bg-red-50 border border-red-200 rounded-xl p-3 text-left">
                  <p className="text-xs font-semibold text-red-600 mb-1">Errores:</p>
                  {confirmResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-500">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error global */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 flex items-center gap-2">
              <XCircle size={16} /> {error}
            </div>
          )}
        </div>

        {/* Footer con botones de acción */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
          {phase === 'intro' && (
            <>
              <button onClick={onClose}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                Cancelar
              </button>
              <button
                onClick={startSession}
                disabled={refsWithDoi.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-medium
                           rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
                <Zap size={15} />
                Iniciar sesión asistida
              </button>
            </>
          )}

          {phase === 'session' && (
            <>
              <button onClick={() => setPhase('intro')}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                ← Atrás
              </button>
              <button
                onClick={scanDownloads}
                disabled={scanning}
                className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-medium
                           rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {scanning
                  ? <Loader size={15} className="animate-spin" />
                  : <FolderOpen size={15} />
                }
                {scanning ? 'Escaneando…' : 'Finalizar y emparejar'}
              </button>
            </>
          )}

          {phase === 'matching' && (
            <>
              <div className="flex items-center gap-3">
                <button onClick={() => setPhase('session')}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                  ← Re-escanear
                </button>
                <span className="text-sm text-gray-400">
                  {acceptedCount} seleccionado{acceptedCount !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={confirmSelected}
                disabled={confirming || acceptedCount === 0}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-medium
                           rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
                {confirming
                  ? <Loader size={15} className="animate-spin" />
                  : <CheckCircle size={15} />
                }
                {confirming
                  ? 'Importando…'
                  : `Confirmar ${acceptedCount} PDF${acceptedCount !== 1 ? 's' : ''}`
                }
              </button>
            </>
          )}

          {phase === 'done' && (
            <button
              onClick={onClose}
              className="ml-auto px-5 py-2 bg-blue-600 text-white text-sm font-medium
                         rounded-xl hover:bg-blue-700 transition-colors">
              Cerrar y actualizar lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
