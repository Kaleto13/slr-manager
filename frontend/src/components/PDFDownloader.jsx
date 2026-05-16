/**
 * PDFDownloader — panel para descargar PDFs automáticamente desde Open Access
 * y gestionar la extracción de texto.
 *
 * Funcionalidades:
 *  - Lista todas las referencias de una búsqueda con su estado de PDF
 *  - Descarga masiva OA (Unpaywall) con progreso en tiempo real
 *  - Descarga masiva Smart (6 estrategias, incluye red universitaria)
 *  - Descarga individual Smart por referencia
 *  - Descarga individual con URL manual
 *  - Re-extracción de texto para PDFs ya subidos manualmente
 *  - Estado visual: sin PDF / descargando / OK / error / escaneado
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  Download, FileText, AlertCircle, CheckCircle, Clock,
  RefreshCw, Loader, ChevronDown, ChevronUp, Link,
  FileQuestion, ScanLine, Search, X, Eye, Zap,
} from 'lucide-react';
import PDFViewer from './PDFViewer';
import AssistedImporter from './AssistedImporter';

// ── Estado de cada referencia ─────────────────────────────────────────────────
const STATUS = {
  idle:       'idle',        // sin PDF
  has_pdf:    'has_pdf',     // tiene PDF pero sin texto extraído
  has_text:   'has_text',    // tiene PDF + texto
  scanned:    'scanned',     // PDF escaneado (necesita OCR)
  loading:    'loading',     // descargando / procesando
  error:      'error',       // falló
  no_oa:      'no_oa',       // no disponible en OA
};

const STATUS_CONFIG = {
  idle:     { icon: FileQuestion, color: 'text-gray-400',  bg: 'bg-gray-50',    label: 'Sin PDF' },
  has_pdf:  { icon: FileText,     color: 'text-blue-500',  bg: 'bg-blue-50',    label: 'PDF sin texto' },
  has_text: { icon: CheckCircle,  color: 'text-green-500', bg: 'bg-green-50',   label: 'Listo' },
  scanned:  { icon: ScanLine,     color: 'text-amber-500', bg: 'bg-amber-50',   label: 'Requiere OCR' },
  loading:  { icon: Loader,       color: 'text-blue-500',  bg: 'bg-blue-50',    label: 'Procesando…' },
  error:    { icon: AlertCircle,  color: 'text-red-500',   bg: 'bg-red-50',     label: 'Error' },
  no_oa:    { icon: X,            color: 'text-gray-400',  bg: 'bg-gray-50',    label: 'No disponible' },
};

// Etiquetas amigables para estrategias de descarga
const STRATEGY_LABELS = {
  'unpaywall':           '🔓 Unpaywall (OA)',
  'semantic_scholar':    '📚 Semantic Scholar',
  'crossref':            '🔗 CrossRef',
  'europepmc:pmc_pdf':   '🧬 Europe PMC',
  'europepmc:fulltext_url': '🧬 Europe PMC',
  'doi_resolve:direct_pdf':   '🔁 Resolución DOI',
  'doi_resolve:landing_scrape': '🔁 Scraping landing',
};
const strategyLabel = (s) => {
  if (!s) return '';
  if (STRATEGY_LABELS[s]) return STRATEGY_LABELS[s];
  if (s.startsWith('publisher_pattern:')) return `🏛️ Red uni (${s.split(':')[1]})`;
  if (s.startsWith('doi_resolve')) return '🔁 Resolución DOI';
  return s;
};

function StatusBadge({ status, message }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
      ${cfg.bg} ${cfg.color}`}
      title={message || cfg.label}>
      <Icon size={11} className={status === STATUS.loading ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

// ── Hook para cargar refs con estado de PDF ───────────────────────────────────
function useRefsStatus(searchId, onlyIncluded = false) {
  const [refs, setRefs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!searchId) return;
    setLoading(true);
    setError(null);
    try {
      const params = onlyIncluded ? '?only_included=true' : '';
      const res = await axios.get(`/api/references/${searchId}/list${params}`);
      setRefs(res.data.map(r => ({
        ...r,
        _status:  r.has_text ? STATUS.has_text
                : r.has_pdf  ? STATUS.has_pdf
                : STATUS.idle,
        _message: '',
      })));
    } catch (e) {
      setError('No se pudieron cargar las referencias');
    } finally {
      setLoading(false);
    }
  }, [searchId, onlyIncluded]);

  useEffect(() => { load(); }, [load]);

  return { refs, setRefs, loading, error, reload: load };
}

// ── Selector de búsqueda ──────────────────────────────────────────────────────
function SearchSelector({ searchId, onSelect }) {
  const [searches, setSearches] = useState([]);

  useEffect(() => {
    axios.get('/api/searches').then(r => setSearches(r.data?.searches || r.data || [])).catch(() => {});
  }, []);

  return (
    <div className="flex items-center gap-3 mb-4">
      <label className="text-sm font-medium text-gray-600 shrink-0">Búsqueda:</label>
      <select
        value={searchId || ''}
        onChange={e => {
          const id = parseInt(e.target.value);
          const s  = searches.find(x => x.id === id);
          onSelect(s ? { id: s.id, name: s.name } : null);
        }}
        className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5
                   focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
      >
        <option value="">— Selecciona una búsqueda —</option>
        {searches.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PDFDownloader({ selectedSearch, onSearchChange }) {
  const [onlyIncluded, setOnlyIncluded] = useState(true);

  // Usar el prop directamente — sin copia local
  const searchId   = selectedSearch?.id;
  const searchName = selectedSearch?.name;

  const handleSelect = (s) => {
    if (onSearchChange) onSearchChange(s);
  };

  const { refs, setRefs, loading, error, reload } = useRefsStatus(searchId, onlyIncluded);
  const [searchQuery, setSearchQuery]   = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [bulkRunning,      setBulkRunning]      = useState(false);
  const [bulkMode,         setBulkMode]         = useState('oa'); // 'oa' | 'smart'
  const [bulkStats,        setBulkStats]        = useState(null);
  const [urlInputs,        setUrlInputs]        = useState({});   // {ref_id: url_string}
  const [expanded,         setExpanded]         = useState({});   // {ref_id: bool}
  const [smartRunning,     setSmartRunning]     = useState({});   // {ref_id: bool}
  const [showAssisted,     setShowAssisted]     = useState(false);
  const abortRef = useRef(false);

  // ── Filtrado por búsqueda y estado ──────────────────────────────────────────
  const displayedRefs = refs.filter(r => {
    if (filterStatus !== 'all' && r._status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.title?.toLowerCase().includes(q) ||
        r.authors?.toLowerCase().includes(q) ||
        r.journal?.toLowerCase().includes(q) ||
        String(r.year ?? '').includes(q)
      );
    }
    return true;
  });

  // ── Contadores (sobre el total real, no el filtrado) ─────────────────────────
  const total      = refs.length;
  const withText   = refs.filter(r => r._status === STATUS.has_text).length;
  const withPdf    = refs.filter(r => r._status === STATUS.has_pdf).length;
  const withoutPdf = refs.filter(r => r._status === STATUS.idle).length;
  const needsOcr   = refs.filter(r => r._status === STATUS.scanned).length;
  const pct = total ? Math.round(((withText + withPdf) / total) * 100) : 0;

  // ── Actualizar estado de una ref ────────────────────────────────────────────
  const setRefStatus = (id, status, message = '') => {
    setRefs(prev => prev.map(r =>
      r.id === id ? { ...r, _status: status, _message: message } : r
    ));
  };

  // ── Descarga individual (OA o URL) ──────────────────────────────────────────
  const fetchOne = async (ref, url = null) => {
    setRefStatus(ref.id, STATUS.loading);
    try {
      const body = url ? { url } : { use_oa: true };
      const res  = await axios.post(`/api/pdfs/${ref.id}/fetch`, body);
      const d    = res.data;
      if (d.is_scanned) {
        setRefStatus(ref.id, STATUS.scanned, `${d.char_count} chars (escaneado)`);
      } else {
        setRefStatus(ref.id, STATUS.has_text, `${d.char_count} chars`);
      }
    } catch (e) {
      const detail = e.response?.data?.detail || e.message;
      const isNoOA = detail?.includes('OA') || detail?.includes('no_oa');
      setRefStatus(ref.id, isNoOA ? STATUS.no_oa : STATUS.error, detail);
    }
  };

  // ── Re-extracción de texto ───────────────────────────────────────────────────
  const extractOne = async (ref) => {
    setRefStatus(ref.id, STATUS.loading);
    try {
      const res = await axios.post(`/api/pdfs/${ref.id}/extract`);
      const d   = res.data;
      setRefStatus(ref.id, d.is_scanned ? STATUS.scanned : STATUS.has_text, `${d.char_count} chars`);
    } catch (e) {
      setRefStatus(ref.id, STATUS.error, e.response?.data?.detail || e.message);
    }
  };

  // ── Descarga inteligente individual ─────────────────────────────────────────
  const fetchSmart = async (ref) => {
    if (!ref.doi) return;
    setSmartRunning(s => ({ ...s, [ref.id]: true }));
    setRefStatus(ref.id, STATUS.loading, 'Probando estrategias…');
    try {
      const res = await axios.post(`/api/pdfs/${ref.id}/fetch-smart`);
      const d   = res.data;
      const label = strategyLabel(d.strategy);
      if (d.is_scanned) {
        setRefStatus(ref.id, STATUS.scanned, `${d.char_count} chars · ${label}`);
      } else {
        setRefStatus(ref.id, STATUS.has_text, `${d.char_count} chars · ${label}`);
      }
    } catch (e) {
      const detail = e.response?.data?.detail || e.message;
      setRefStatus(ref.id, STATUS.error, detail);
    } finally {
      setSmartRunning(s => ({ ...s, [ref.id]: false }));
    }
  };

  // ── Descarga masiva (OA o Smart) ─────────────────────────────────────────────
  const bulkDownload = async (mode = 'oa') => {
    const targets = refs.filter(r => r._status === STATUS.idle && r.doi);
    if (!targets.length) return;

    abortRef.current = false;
    setBulkRunning(true);
    setBulkMode(mode);
    setBulkStats({ done: 0, total: targets.length, ok: 0, errors: 0, no_oa: 0 });

    for (let i = 0; i < targets.length; i++) {
      if (abortRef.current) break;
      const ref = targets[i];
      setRefStatus(ref.id, STATUS.loading);
      try {
        let res;
        if (mode === 'smart') {
          res = await axios.post(`/api/pdfs/${ref.id}/fetch-smart`);
        } else {
          res = await axios.post(`/api/pdfs/${ref.id}/fetch`, { use_oa: true });
        }
        const d = res.data;
        const label = mode === 'smart' ? strategyLabel(d.strategy) : '';
        setRefStatus(ref.id, d.is_scanned ? STATUS.scanned : STATUS.has_text,
          `${d.char_count} chars${label ? ` · ${label}` : ''}`);
        setBulkStats(s => ({ ...s, done: s.done + 1, ok: s.ok + 1 }));
      } catch (e) {
        const detail = e.response?.data?.detail || '';
        const isNoOA = detail.includes('No disponible') || detail.includes('ninguna estrategia');
        setRefStatus(ref.id, isNoOA ? STATUS.no_oa : STATUS.error, detail);
        setBulkStats(s => ({
          ...s,
          done: s.done + 1,
          no_oa: s.no_oa + (isNoOA ? 1 : 0),
          errors: s.errors + (isNoOA ? 0 : 1),
        }));
      }
      // Pausa cortés entre requests (más larga para smart por la cadena de APIs)
      await new Promise(r => setTimeout(r, mode === 'smart' ? 800 : 500));
    }

    setBulkRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <SearchSelector searchId={searchId} onSelect={handleSelect} onSearchChange={onSearchChange} />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 shrink-0">
          <input
            type="checkbox"
            checked={onlyIncluded}
            onChange={e => setOnlyIncluded(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-green-600"
          />
          Solo incluidas y a revisar en Screening
        </label>
        {/* Barra de búsqueda */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar por título, autores…"
            className="w-full text-xs border border-gray-200 rounded-lg pl-7 pr-6 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {!searchId && (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <p className="text-sm">Selecciona una búsqueda para gestionar PDFs.</p>
        </div>
      )}
      {searchId && <div className="space-y-4">
      {/* ── Cabecera + progreso ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Download size={20} className="text-blue-500" />
              PDF — {searchName || `Búsqueda #${searchId}`}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {withText} con texto · {withPdf} sin texto · {withoutPdf} sin PDF · {total} total
              {needsOcr > 0 && (
                <span className="ml-2 text-amber-600 font-medium">
                  · ⚠️ {needsOcr} requiere OCR
                </span>
              )}
            </p>
          </div>
          <button onClick={reload} disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-400 text-right">{pct}% con PDF</p>

        {/* Descarga masiva */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {/* Botón OA (Unpaywall rápido) */}
          <button
            onClick={() => bulkDownload('oa')}
            disabled={bulkRunning || withoutPdf === 0}
            title="Descarga rápida usando solo Unpaywall (Open Access)"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium
                       rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors">
            {bulkRunning && bulkMode === 'oa'
              ? <Loader size={15} className="animate-spin" />
              : <Download size={15} />}
            {bulkRunning && bulkMode === 'oa'
              ? `OA… (${bulkStats?.done}/${bulkStats?.total})`
              : `OA (${withoutPdf} sin PDF)`}
          </button>

          {/* Botón Smart (6 estrategias, incluye red universitaria) */}
          <button
            onClick={() => bulkDownload('smart')}
            disabled={bulkRunning || withoutPdf === 0}
            title="Descarga inteligente: prueba 6 estrategias incluyendo acceso institucional universitario"
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium
                       rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors">
            {bulkRunning && bulkMode === 'smart'
              ? <Loader size={15} className="animate-spin" />
              : <Zap size={15} />}
            {bulkRunning && bulkMode === 'smart'
              ? `Smart… (${bulkStats?.done}/${bulkStats?.total})`
              : `Smart (${withoutPdf} sin PDF)`}
          </button>

          {bulkRunning && (
            <button onClick={() => { abortRef.current = true; }}
              className="px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
              Detener
            </button>
          )}

          {bulkStats && !bulkRunning && (
            <span className="text-sm text-gray-600">
              ✓ {bulkStats.ok} descargados · ✗ {bulkStats.errors} errores · — {bulkStats.no_oa} no disponibles
            </span>
          )}

          {/* Botón importación asistida */}
          {!bulkRunning && (
            <button
              onClick={() => setShowAssisted(true)}
              disabled={withoutPdf === 0}
              title="Descarga manual con apertura automática de DOIs y emparejamiento inteligente"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-violet-300 text-violet-700
                         text-sm font-medium rounded-lg hover:bg-violet-50 disabled:opacity-50
                         disabled:cursor-not-allowed transition-colors ml-auto">
              <Zap size={15} className="text-violet-500" />
              Agregar PDF asistido
            </button>
          )}
        </div>

        {withoutPdf > 0 && !bulkRunning && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-gray-400">
              <span className="font-medium text-blue-600">OA:</span> solo Open Access vía Unpaywall (más rápido).
              {' '}<span className="font-medium text-violet-600">Smart:</span> 6 estrategias, incluye red universitaria.
              {' '}<span className="font-medium text-violet-500">Asistido:</span> abre los DOIs para descargar manualmente y empareja los PDFs con los artículos.
            </p>
          </div>
        )}
      </div>

      {/* ── Lista de referencias ── */}
      {error && (
        <div className="bg-red-50 text-red-600 rounded-lg p-4 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && !refs.length && (
        <div className="flex justify-center py-12">
          <Loader size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* ── Filtros de estado ── */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase shrink-0">Estado:</span>
        {[
          { key: 'all',      label: `Todos (${refs.length})` },
          { key: STATUS.has_text, label: `Con texto (${withText})`,       color: 'text-green-600  border-green-200  bg-green-50'  },
          { key: STATUS.has_pdf,  label: `PDF sin texto (${withPdf})`,    color: 'text-blue-600   border-blue-200   bg-blue-50'   },
          { key: STATUS.idle,     label: `Sin PDF (${withoutPdf})`,       color: 'text-gray-500   border-gray-200   bg-gray-50'   },
          { key: STATUS.scanned,  label: `Req. OCR (${needsOcr})`,        color: 'text-amber-600  border-amber-200  bg-amber-50'  },
          { key: STATUS.error,    label: `Error (${refs.filter(r => r._status === STATUS.error).length})`,
                                                                           color: 'text-red-600    border-red-200    bg-red-50'    },
        ].map(({ key, label, color }) => (
          <button key={key}
            onClick={() => setFilterStatus(key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filterStatus === key
                ? 'bg-blue-600 border-blue-600 text-white'
                : color || 'border-gray-200 text-gray-600 hover:border-blue-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {(searchQuery || filterStatus !== 'all') && (
        <p className="text-xs text-gray-400 px-1">
          Mostrando {displayedRefs.length} de {refs.length} referencias
          {filterStatus !== 'all' && <> · filtro: <span className="font-medium">{STATUS_CONFIG[filterStatus]?.label ?? filterStatus}</span></>}
        </p>
      )}
      <div className="space-y-1">
        {displayedRefs.map(ref => {
          const isOpen = expanded[ref.id];
          const urlVal = urlInputs[ref.id] || '';

          return (
            <div key={ref.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {/* Fila principal */}
              <div className="flex items-center gap-3 px-4 py-3">
                <StatusBadge status={ref._status} message={ref._message} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate" title={ref.title}>
                    {ref.title || 'Sin título'}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {ref.authors?.split(/[,;]/)[0]}
                    {ref.year ? ` (${ref.year})` : ''}
                    {ref.journal
                      ? <> · <span className="text-gray-500 italic">{ref.journal}</span></>
                      : null}
                    {ref.doi ? ` · DOI: ${ref.doi}` : ''}
                  </p>
                </div>

                {/* Acciones rápidas */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {ref._status === STATUS.idle && ref.doi && (
                    <>
                      <button onClick={() => fetchOne(ref)}
                        title="Descarga rápida OA (Unpaywall)"
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-500 hover:text-blue-700">
                        <Download size={14} />
                      </button>
                      <button onClick={() => fetchSmart(ref)}
                        disabled={smartRunning[ref.id]}
                        title="Descarga Smart: 6 estrategias (incluye red universitaria)"
                        className="p-1.5 rounded hover:bg-violet-50 text-violet-500 hover:text-violet-700
                                   disabled:opacity-40">
                        {smartRunning[ref.id]
                          ? <Loader size={14} className="animate-spin" />
                          : <Zap size={14} />}
                      </button>
                    </>
                  )}
                  {(ref._status === STATUS.no_oa || ref._status === STATUS.error) && ref.doi && (
                    <button onClick={() => fetchSmart(ref)}
                      disabled={smartRunning[ref.id]}
                      title="Reintentar con descarga Smart (6 estrategias)"
                      className="p-1.5 rounded hover:bg-violet-50 text-violet-500 hover:text-violet-700
                                 disabled:opacity-40">
                      {smartRunning[ref.id]
                        ? <Loader size={14} className="animate-spin" />
                        : <Zap size={14} />}
                    </button>
                  )}
                  {ref._status === STATUS.has_pdf && (
                    <button onClick={() => extractOne(ref)}
                      title="Extraer texto del PDF"
                      className="p-1.5 rounded hover:bg-green-50 text-green-500 hover:text-green-700">
                      <FileText size={14} />
                    </button>
                  )}
                  {(ref._status === STATUS.has_text || ref._status === STATUS.has_pdf || ref._status === STATUS.scanned) && (
                    <button
                      onClick={() => setExpanded(e => ({ ...e, [`viewer_${ref.id}`]: true }))}
                      title="Ver PDF con anotaciones"
                      className="p-1.5 rounded hover:bg-purple-50 text-purple-400 hover:text-purple-700">
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded(e => ({ ...e, [ref.id]: !e[ref.id] }))}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {/* Panel expandido — URL manual */}
              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
                  <p className="text-xs font-medium text-gray-500">URL manual del PDF</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={urlVal}
                      onChange={e => setUrlInputs(u => ({ ...u, [ref.id]: e.target.value }))}
                      placeholder="https://ejemplo.com/paper.pdf"
                      className="flex-1 text-xs border border-gray-300 rounded-lg px-3 py-1.5
                                 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    />
                    <button
                      onClick={() => urlVal && fetchOne(ref, urlVal)}
                      disabled={!urlVal || ref._status === STATUS.loading}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs
                                 font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50
                                 disabled:cursor-not-allowed transition-colors">
                      <Link size={12} />
                      Descargar
                    </button>
                  </div>

                  {ref._status === STATUS.has_pdf && (
                    <button onClick={() => extractOne(ref)}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium">
                      <Search size={12} />
                      Re-extraer texto del PDF existente
                    </button>
                  )}

                  {ref._message && (
                    <p className={`text-xs ${
                      ref._status === STATUS.error ? 'text-red-500' : 'text-gray-500'
                    }`}>
                      {ref._message}
                    </p>
                  )}
                </div>
              )}

              {/* Visor PDF con anotaciones */}
              {expanded[`viewer_${ref.id}`] && (
                <PDFViewer
                  referenceId={ref.id}
                  title={ref.title}
                  onClose={() => setExpanded(e => ({ ...e, [`viewer_${ref.id}`]: false }))}
                />
              )}
            </div>
          );
        })}
      </div>
      </div>}

      {/* Modal de importación asistida */}
      {showAssisted && (
        <AssistedImporter
          refs={refs.filter(r => r._status === STATUS.idle || r._status === STATUS.no_oa || r._status === STATUS.error)}
          onClose={() => setShowAssisted(false)}
          onImported={(count) => {
            setShowAssisted(false);
            reload();   // recargar lista para reflejar PDFs importados
          }}
        />
      )}
    </div>
  );
}
