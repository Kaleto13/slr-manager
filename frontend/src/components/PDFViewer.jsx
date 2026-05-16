/**
 * PDFViewer.jsx
 *
 * Visor PDF con:
 *  - Scroll vertical (todas las páginas apiladas)
 *  - Renderizado nítido HiDPI (devicePixelRatio)
 *  - Text layer invisible → selección de texto real
 *  - Panel de anotaciones
 *  - Prop `embedded` para integrarse en un panel sin modal
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  X, ZoomIn, ZoomOut,
  MessageSquare, Loader, AlertTriangle, Maximize2, Minimize2,
} from 'lucide-react';
import AnnotationPanel from './AnnotationPanel';

// ── CSS del text layer ─────────────────────────────────────────────────────────
const TEXT_LAYER_CSS = `
.slr-text-layer {
  position: absolute;
  top: 0; left: 0;
  overflow: hidden;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  pointer-events: auto;
}
.slr-text-layer span,
.slr-text-layer br,
.slr-text-layer .endOfContent {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
  -webkit-user-select: text;
}
.slr-text-layer .markedContent { top: 0; height: 0; }
.slr-text-layer ::selection { background: rgba(59,130,246,0.35); color: transparent; }
`;
let cssInjected = false;
function injectTextLayerCss() {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.textContent = TEXT_LAYER_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ── pdfjs worker ──────────────────────────────────────────────────────────────
let pdfjsLib = null;
async function getPdfjsLib() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

// ── Componente ────────────────────────────────────────────────────────────────
export default function PDFViewer({ referenceId, title, onClose, embedded = false }) {
  const containerRef  = useRef(null);
  const pdfDocRef     = useRef(null);
  const canvasRefs    = useRef({});    // pageNum → <canvas>
  const textRefs      = useRef({});    // pageNum → <div>
  const wrapperRefs   = useRef({});    // pageNum → <div> wrapper (para IntersectionObserver)
  const activeRenders = useRef(new Set());

  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [numPages,        setNumPages]        = useState(0);
  const [currentPage,     setCurrentPage]     = useState(1);
  const [scale,           setScale]           = useState(1.2);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [fullscreen,      setFullscreen]      = useState(false);
  const [hasTextLayer,    setHasTextLayer]    = useState(true);

  // Anotaciones
  const [selectedText, setSelectedText] = useState('');
  const [showNewAnn,   setShowNewAnn]   = useState(false);
  const [newComment,   setNewComment]   = useState('');
  const [newTag,       setNewTag]       = useState('');
  const [savingAnn,    setSavingAnn]    = useState(false);
  const [annRefresh,   setAnnRefresh]   = useState(0);

  useEffect(() => { injectTextLayerCss(); }, []);

  // ── Cargar PDF ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    canvasRefs.current  = {};
    textRefs.current    = {};
    wrapperRefs.current = {};
    setLoading(true);
    setError(null);
    setNumPages(0);
    setCurrentPage(1);
    pdfDocRef.current = null;

    (async () => {
      try {
        const lib    = await getPdfjsLib();
        const url    = `/api/pdfs/${referenceId}/download?inline=true`;
        const pdfDoc = await lib.getDocument(url).promise;
        if (cancelled) return;
        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'No se pudo cargar el PDF');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [referenceId]);

  // ── Renderizar una página con resolución HiDPI ────────────────────────────
  const renderPage = useCallback(async (pageNum) => {
    if (!pdfDocRef.current) return;
    const canvas  = canvasRefs.current[pageNum];
    const textDiv = textRefs.current[pageNum];
    if (!canvas) return;

    const lib  = await getPdfjsLib();
    const page = await pdfDocRef.current.getPage(pageNum);
    const dpr  = window.devicePixelRatio || 1;

    // Viewport a tamaño visual (lo que el usuario ve en CSS px)
    const viewport    = page.getViewport({ scale });
    // Viewport HiDPI para el canvas real (más píxeles → imagen nítida)
    const hiDpiVp     = page.getViewport({ scale: scale * dpr });

    canvas.width        = hiDpiVp.width;
    canvas.height       = hiDpiVp.height;
    canvas.style.width  = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx  = canvas.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport: hiDpiVp });
    activeRenders.current.add(task);
    try {
      await task.promise;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('Render error:', e);
      return;
    } finally {
      activeRenders.current.delete(task);
    }

    // Text layer (usa el viewport visual, no el HiDPI)
    if (textDiv) {
      textDiv.innerHTML = '';
      textDiv.style.width  = `${viewport.width}px`;
      textDiv.style.height = `${viewport.height}px`;
      textDiv.style.setProperty('--scale-factor', String(scale));
      try {
        const textContent = await page.getTextContent();
        if (textContent?.items?.length > 0) {
          setHasTextLayer(true);
          if (typeof lib.TextLayer === 'function') {
            const tl = new lib.TextLayer({
              textContentSource: textContent,
              container: textDiv,
              viewport,
            });
            await tl.render();
            // Restaurar dimensiones (TextLayer puede sobreescribirlas)
            textDiv.style.width  = `${viewport.width}px`;
            textDiv.style.height = `${viewport.height}px`;
          } else if (typeof lib.renderTextLayer === 'function') {
            const tl = lib.renderTextLayer({
              textContentSource: textContent,
              container: textDiv,
              viewport,
            });
            if (tl?.promise) await tl.promise;
          }
        }
      } catch (tlErr) {
        console.warn('Text layer no disponible:', tlErr);
      }
    }
  }, [scale]);

  // ── Renderizar todas las páginas al cargar o al cambiar escala ────────────
  useEffect(() => {
    if (loading || error || !numPages) return;
    // Cancelar renders previos
    activeRenders.current.forEach(t => { try { t.cancel(); } catch {} });
    activeRenders.current.clear();
    // Renderizar en secuencia
    (async () => {
      for (let i = 1; i <= numPages; i++) await renderPage(i);
    })();
  }, [numPages, scale, loading, error, renderPage]);

  // ── IntersectionObserver → página actual ──────────────────────────────────
  useEffect(() => {
    if (!numPages) return;
    const root = containerRef.current;
    const observer = new IntersectionObserver(entries => {
      let bestRatio = 0, bestPage = 1;
      entries.forEach(e => {
        if (e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          bestPage  = parseInt(e.target.dataset.page);
        }
      });
      if (bestRatio > 0) setCurrentPage(bestPage);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });

    const refs = wrapperRefs.current;
    Object.values(refs).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [numPages]);

  // ── Teclado ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (showNewAnn) return;
      if (e.key === 'Escape') {
        if (fullscreen) { setFullscreen(false); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, showNewAnn, fullscreen]);

  // ── Selección de texto ────────────────────────────────────────────────────
  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length > 3) {
      setSelectedText(sel);
      setShowNewAnn(true);
    }
  };

  // ── Crear anotación ───────────────────────────────────────────────────────
  const handleSaveAnnotation = async () => {
    if (!newComment.trim()) return;
    setSavingAnn(true);
    try {
      await axios.post('/api/annotations', {
        reference_id: referenceId,
        page:         currentPage,
        text:         selectedText || null,
        comment:      newComment.trim(),
        tag:          newTag.trim() || null,
      });
      setShowNewAnn(false);
      setNewComment(''); setNewTag(''); setSelectedText('');
      setAnnRefresh(r => r + 1);
    } catch (e) { console.error(e); }
    finally { setSavingAnn(false); }
  };

  const zoomIn  = () => setScale(s => Math.min(s + 0.25, 3.0));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));
  const scrollToPage = (p) => {
    const el = wrapperRefs.current[p];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Clases según modo ─────────────────────────────────────────────────────
  // Embedded + fullscreen → overlay igual que el modal normal
  const outerClass = (!embedded)
    ? `fixed inset-0 z-50 bg-black/80 flex flex-col ${fullscreen ? '' : 'p-4'}`
    : fullscreen
      ? 'fixed inset-0 z-50 bg-black/80 flex flex-col'
      : 'flex flex-col w-full h-full bg-white overflow-hidden';

  const innerClass = (!embedded)
    ? `bg-white flex flex-col overflow-hidden ${fullscreen ? 'w-full h-full' : 'rounded-xl w-full h-full max-w-7xl mx-auto'}`
    : fullscreen
      ? 'bg-white flex flex-col overflow-hidden w-full h-full'
      : 'flex flex-col w-full h-full overflow-hidden';

  return (
    <div className={outerClass}>
      <div className={innerClass}>

        {/* ── Topbar ── */}
        <div className="flex items-center justify-between bg-gray-900 text-white px-3 py-2 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium truncate">{title || `Ref #${referenceId}`}</span>
            {numPages > 0 && (
              <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                {currentPage}/{numPages}
              </span>
            )}
            {!hasTextLayer && !loading && !error && (
              <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded-full shrink-0">
                Escaneado
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={zoomOut} className="p-1.5 hover:bg-gray-700 rounded" title="Alejar (-)">
              <ZoomOut size={14} />
            </button>
            <span className="text-[11px] text-gray-400 w-9 text-center tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button onClick={zoomIn} className="p-1.5 hover:bg-gray-700 rounded" title="Acercar (+)">
              <ZoomIn size={14} />
            </button>

            <div className="w-px h-4 bg-gray-600 mx-1" />

            <button
              onClick={() => setShowAnnotations(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors
                ${showAnnotations ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
              title="Notas y anotaciones"
            >
              <MessageSquare size={12} /> Notas
            </button>

            <button
              onClick={() => setFullscreen(v => !v)}
              className="p-1.5 hover:bg-gray-700 rounded"
              title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            <button onClick={onClose} className="p-1.5 hover:bg-red-700 rounded ml-0.5" title="Cerrar">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Cuerpo ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Área de scroll con todas las páginas */}
          <div
            ref={containerRef}
            className="flex-1 overflow-auto bg-gray-600 flex flex-col items-center py-4 gap-3"
            onMouseUp={handleMouseUp}
          >
            {loading && (
              <div className="flex flex-col items-center justify-center h-full text-white gap-3">
                <Loader size={28} className="animate-spin" />
                <p className="text-sm">Cargando PDF...</p>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center h-full text-white gap-3 max-w-xs text-center px-4">
                <AlertTriangle size={28} className="text-amber-400" />
                <p className="text-sm font-medium">No se pudo cargar el PDF</p>
                <p className="text-xs text-gray-300">{error}</p>
                <p className="text-xs text-gray-400">
                  Verifica que el PDF esté descargado en "Descarga de PDFs".
                </p>
              </div>
            )}

            {/* Una página por cada número */}
            {!loading && !error && Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
              <div
                key={pageNum}
                data-page={pageNum}
                ref={el => { wrapperRefs.current[pageNum] = el; }}
                style={{ position: 'relative', lineHeight: 0, display: 'inline-block' }}
                className="shadow-2xl"
              >
                <canvas
                  ref={el => { canvasRefs.current[pageNum] = el; }}
                  style={{ display: 'block' }}
                />
                <div
                  ref={el => { textRefs.current[pageNum] = el; }}
                  className="slr-text-layer"
                />
              </div>
            ))}
          </div>

          {/* Panel de anotaciones */}
          {showAnnotations && !loading && !error && (
            <AnnotationPanel
              referenceId={referenceId}
              currentPage={currentPage}
              refresh={annRefresh}
              onGoToPage={scrollToPage}
            />
          )}
        </div>
      </div>

      {/* ── Modal nueva anotación ── */}
      {showNewAnn && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <MessageSquare size={18} className="text-blue-500" />
              Nueva anotación — Página {currentPage}
            </h3>

            {selectedText && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-gray-700 italic">
                "{selectedText.length > 200 ? selectedText.slice(0, 200) + '…' : selectedText}"
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">
                Comentario <span className="text-red-500">*</span>
              </label>
              <textarea
                autoFocus
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Escribe tu nota aquí..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.ctrlKey) handleSaveAnnotation();
                  if (e.key === 'Escape') { setShowNewAnn(false); setSelectedText(''); }
                }}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">
                Etiqueta (opcional)
              </label>
              <input
                type="text"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="ej: metodología, resultado, limitación..."
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewAnn(false);
                  setNewComment(''); setNewTag(''); setSelectedText('');
                }}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAnnotation}
                disabled={!newComment.trim() || savingAnn}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {savingAnn && <Loader size={13} className="animate-spin" />}
                Guardar (Ctrl+Enter)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
