import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  Filter, CheckCircle, XCircle, HelpCircle, Loader,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Plus, Trash2, Settings, AlertTriangle, BookOpen, FileText,
  ArrowRight, RefreshCw, ExternalLink, Upload, FileCheck, Eye, Search, X,
} from 'lucide-react';
import PDFViewer from './PDFViewer';

// ── Colores por decisión ──────────────────────────────────────────────────────
const DECISION_STYLE = {
  include: { bg: 'bg-green-50',  border: 'border-green-300',  text: 'text-green-700'  },
  exclude: { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-700'    },
  maybe:   { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-700'  },
  pending: { bg: 'bg-white',     border: 'border-gray-200',   text: 'text-gray-400'   },
};

const DECISION_LABEL = {
  include: 'Incluido',
  exclude: 'Excluido',
  maybe:   'Revisar',
  pending: 'Pendiente',
};

// Helper para construir la URL del DOI
function doiUrl(doi) {
  if (!doi) return null;
  if (doi.startsWith('http://') || doi.startsWith('https://')) return doi;
  return `https://doi.org/${doi}`;
}

// ── Panel de gestión de criterios ─────────────────────────────────────────────
function CriteriaManager({ criteria, onReload }) {
  const [newLabel, setNewLabel]       = useState('');
  const [newDesc, setNewDesc]         = useState('');
  const [newType, setNewType]         = useState('exclusion');
  const [saving, setSaving]           = useState(false);
  const [expanded, setExpanded]       = useState(false);

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await axios.post('/api/screening/criteria', {
        label: newLabel.trim(),
        description: newDesc.trim() || null,
        type: newType,
      });
      setNewLabel(''); setNewDesc('');
      onReload();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await axios.delete(`/api/screening/criteria/${id}`);
    onReload();
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-700"
      >
        <span className="flex items-center gap-2">
          <Settings size={14} />
          Criterios de exclusión/inclusión ({criteria.length})
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="p-4 space-y-3">
          {criteria.length === 0 && (
            <p className="text-xs text-gray-400 italic">No hay criterios definidos aún.</p>
          )}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {criteria.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  c.type === 'exclusion' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                }`}>{c.type === 'exclusion' ? 'Excl' : 'Incl'}</span>
                <span className="flex-1 text-gray-700">{c.label}</span>
                {c.description && <span className="text-gray-400 truncate max-w-[120px]">{c.description}</span>}
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-gray-400 hover:text-red-500 shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Nuevo criterio</p>
            <div className="flex gap-2">
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 shrink-0"
              >
                <option value="exclusion">Exclusión</option>
                <option value="inclusion">Inclusión</option>
              </select>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Etiqueta del criterio…"
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Descripción opcional…"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={handleAdd}
              disabled={!newLabel.trim() || saving}
              className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1.5 rounded"
            >
              {saving ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
              Agregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fila de referencia con decisión inline ────────────────────────────────────
// NOTA: no usar "ref" como prop — es reservado por React; usamos "data"
function RefRow({ data, criteria, phase, onDecide, deciding }) {
  const [expanded, setExpanded]           = useState(false);
  const [showCriteriaPanel, setShowCritPanel] = useState(false);
  const [pendingDecision, setPendingDecision] = useState(null); // 'include'|'exclude'
  const [selectedCritIds, setSelectedCritIds] = useState(new Set());
  const [hasPdf, setHasPdf]               = useState(!!data.has_pdf);
  const [uploading, setUploading]         = useState(false);
  const [uploadError, setUploadError]     = useState(null);
  const [showViewer, setShowViewer]       = useState(false);
  const fileInputRef                      = useRef(null);

  const style        = DECISION_STYLE[data.decision] || DECISION_STYLE.pending;
  const exclCriteria = criteria.filter(c => c.type === 'exclusion');
  const inclCriteria = criteria.filter(c => c.type === 'inclusion');
  const dUrl         = doiUrl(data.doi);

  const openCriteriaPanel = (decision) => {
    // Preseleccionar los criterios ya aplicados
    const existing = new Set(data.criterion_ids || []);
    setSelectedCritIds(existing);
    setPendingDecision(decision);
    setShowCritPanel(true);
  };

  const toggleCrit = (id) =>
    setSelectedCritIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const confirmDecide = (criterionIds) => {
    onDecide(data.id, pendingDecision, criterionIds, null);
    setShowCritPanel(false);
  };

  const handleDecide = (decision) => {
    const relevantCriteria = decision === 'exclude' ? exclCriteria : inclCriteria;
    if (relevantCriteria.length > 0) {
      openCriteriaPanel(decision);
    } else {
      onDecide(data.id, decision, [], null);
    }
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Solo se aceptan archivos PDF');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await axios.post(`/api/pdfs/${data.id}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setHasPdf(true);
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Error al subir PDF');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${style.border} ${style.bg}`}>
      {/* Cabecera */}
      <div className="flex items-start gap-3 p-3">
        {/* Botones de decisión */}
        <div className="flex flex-col gap-1 shrink-0 mt-0.5">
          <button
            onClick={() => handleDecide('include')}
            disabled={deciding === data.id}
            title="Incluir"
            className={`p-1.5 rounded-lg border transition-colors ${
              data.decision === 'include'
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-500 bg-white'
            } disabled:opacity-40`}
          >
            <CheckCircle size={16} />
          </button>
          <button
            onClick={() => onDecide(data.id, 'maybe', [], null)}
            disabled={deciding === data.id}
            title="Revisar / Dudoso"
            className={`p-1.5 rounded-lg border transition-colors ${
              data.decision === 'maybe'
                ? 'bg-amber-400 border-amber-400 text-white'
                : 'border-gray-200 text-gray-400 hover:border-amber-400 hover:text-amber-500 bg-white'
            } disabled:opacity-40`}
          >
            <HelpCircle size={16} />
          </button>
          <button
            onClick={() => handleDecide('exclude')}
            disabled={deciding === data.id}
            title="Excluir"
            className={`p-1.5 rounded-lg border transition-colors ${
              data.decision === 'exclude'
                ? 'bg-red-500 border-red-500 text-white'
                : 'border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500 bg-white'
            } disabled:opacity-40`}
          >
            <XCircle size={16} />
          </button>
        </div>

        {/* Contenido */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-800 leading-snug">
              {data.title}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Badge R1 (solo en Ronda 2) */}
              {phase === 'full_text' && data.r1_decision && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 border border-blue-200">
                  R1: {DECISION_LABEL[data.r1_decision] || data.r1_decision}
                </span>
              )}
              {/* Badge PDF */}
              {hasPdf && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 border border-purple-200">
                  PDF
                </span>
              )}
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                data.decision === 'include' ? 'bg-green-100 text-green-700' :
                data.decision === 'exclude' ? 'bg-red-100 text-red-700' :
                data.decision === 'maybe'   ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-400'
              }`}>
                {DECISION_LABEL[data.decision] || 'Pendiente'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            <p className="text-xs text-gray-500">
              {data.authors?.split(';')[0]?.trim() || '—'}
              {data.year    ? ` · ${data.year}`    : ''}
              {data.journal ? ` · ${data.journal}` : ''}
            </p>
            {/* DOI link en cabecera */}
            {dUrl && (
              <a
                href={dUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 hover:underline"
                title={`Abrir DOI: ${data.doi}`}
              >
                <ExternalLink size={10} />
                DOI
              </a>
            )}
          </div>

          {data.decision === 'exclude' && data.criterion_labels?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {data.criterion_labels.map((lbl, i) => (
                <span key={i} className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                  {lbl}
                </span>
              ))}
            </div>
          )}
          {data.decision === 'include' && data.criterion_labels?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {data.criterion_labels.map((lbl, i) => (
                <span key={i} className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                  {lbl}
                </span>
              ))}
            </div>
          )}

          {data.abstract && !expanded && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{data.abstract}</p>
          )}

          {deciding === data.id && (
            <Loader size={12} className="animate-spin text-blue-400 mt-1" />
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 shrink-0 mt-0.5"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Panel unificado de criterios con checkboxes multi-selección */}
      {showCriteriaPanel && (
        <div className={`border-t p-3 ${
          pendingDecision === 'exclude'
            ? 'border-red-200 bg-red-50'
            : 'border-green-200 bg-green-50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <p className={`text-xs font-semibold ${
              pendingDecision === 'exclude' ? 'text-red-600' : 'text-green-700'
            }`}>
              {pendingDecision === 'exclude' ? 'Motivos de exclusión:' : 'Criterios de inclusión:'}
              <span className="text-gray-400 font-normal ml-1">(selecciona uno o varios)</span>
            </p>
            <button onClick={() => setShowCritPanel(false)}
              className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
          </div>

          <div className="space-y-1 max-h-36 overflow-y-auto mb-2">
            {(pendingDecision === 'exclude' ? exclCriteria : inclCriteria).map(c => (
              <label key={c.id}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white/60 px-1 py-0.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedCritIds.has(c.id)}
                  onChange={() => toggleCrit(c.id)}
                  className={`shrink-0 ${
                    pendingDecision === 'exclude' ? 'accent-red-500' : 'accent-green-600'
                  }`}
                />
                <span className={selectedCritIds.has(c.id)
                  ? (pendingDecision === 'exclude' ? 'text-red-700 font-medium' : 'text-green-700 font-medium')
                  : 'text-gray-700'
                }>{c.label}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => confirmDecide([...selectedCritIds])}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium text-white ${
                pendingDecision === 'exclude'
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              Confirmar {pendingDecision === 'exclude' ? 'exclusión' : 'inclusión'}
              {selectedCritIds.size > 0 && ` (${selectedCritIds.size})`}
            </button>
            <button
              onClick={() => confirmDecide([])}
              className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
            >
              Sin criterio específico
            </button>
          </div>
        </div>
      )}

      {/* Panel expandido: abstract + DOI + PDF */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 pb-3 pt-2 bg-white/60 space-y-2">
          {/* Abstract */}
          {data.abstract && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Abstract</p>
              <p className="text-xs text-gray-700 leading-relaxed">{data.abstract}</p>
            </div>
          )}

          {/* DOI clickable */}
          {dUrl && (
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-gray-500">DOI:</p>
              <a
                href={dUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:text-blue-700 hover:underline font-mono break-all flex items-center gap-1"
              >
                {data.doi}
                <ExternalLink size={10} className="shrink-0" />
              </a>
            </div>
          )}

          {/* PDF upload */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <input
              type="file"
              accept=".pdf,application/pdf"
              ref={fileInputRef}
              onChange={handlePdfUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                hasPdf
                  ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {uploading
                ? <Loader size={12} className="animate-spin" />
                : hasPdf
                  ? <FileCheck size={12} />
                  : <Upload size={12} />
              }
              {uploading ? 'Subiendo…' : hasPdf ? 'PDF adjunto · Reemplazar' : 'Adjuntar PDF'}
            </button>
            {uploadError && (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={11} /> {uploadError}
              </span>
            )}
            {hasPdf && !uploading && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowViewer(true)}
                  className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
                >
                  <Eye size={11} /> Ver PDF
                </button>
                <a
                  href={`/api/pdfs/${data.id}/download`}
                  className="text-xs text-gray-400 hover:underline flex items-center gap-1"
                >
                  ↓ Descargar
                </a>
              </div>
            )}

            {/* Visor PDF en pantalla completa */}
            {showViewer && (
              <PDFViewer
                referenceId={data.id}
                title={data.title}
                onClose={() => setShowViewer(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────
export default function ScreeningPanel({ selectedSearch, onSearchChange }) {
  const [searches, setSearches]           = useState([]);
  // selectedId derivado del prop — sin copia local que pueda desincronizarse
  const selectedId = selectedSearch?.id ? String(selectedSearch.id) : '';
  const [phase, setPhase]                 = useState('title_abstract');
  const [filterDecision, setFilterDecision] = useState('all');
  const [searchQuery, setSearchQuery]     = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef                       = useRef(null);
  const [stats, setStats]                 = useState(null);
  const [criteria, setCriteria]           = useState([]);
  const [refs, setRefs]                   = useState([]);
  const [pagination, setPagination]       = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]             = useState(false);
  const [initializingRound, setInitializingRound] = useState(false);
  const [deciding, setDeciding]           = useState(null);
  const [error, setError]                 = useState(null);

  // Debounce del campo de búsqueda
  const handleQueryChange = (val) => {
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 400);
  };

  // Cargar búsquedas y criterios al montar
  useEffect(() => {
    axios.get('/api/searches').then(r => setSearches(r.data || [])).catch(() => {});
    loadCriteria();
  }, []);

  const loadCriteria = () => {
    axios.get('/api/screening/criteria').then(r => setCriteria(r.data || [])).catch(() => {});
  };

  // Cargar stats y refs cuando cambia búsqueda, fase, filtro o query
  useEffect(() => {
    if (!selectedId) {
      setStats(null); setRefs([]); setPagination({ total: 0, page: 1, pages: 1 });
      return;
    }
    loadStats();
    loadRefs(1);
  }, [selectedId, phase, filterDecision, debouncedQuery]);

  const loadStats = async () => {
    try {
      const r = await axios.get(`/api/screening/${selectedId}/stats`);
      setStats(r.data);
    } catch { /* ignore */ }
  };

  const loadRefs = useCallback(async (page = 1) => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { phase, decision: filterDecision, page, per_page: 50 };
      if (debouncedQuery.trim()) params.q = debouncedQuery.trim();
      const r = await axios.get(`/api/screening/${selectedId}/refs`, { params });
      setRefs(r.data.refs || []);
      setPagination({ total: r.data.total, page: r.data.page, pages: r.data.pages });
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar referencias');
    } finally {
      setLoading(false);
    }
  }, [selectedId, phase, filterDecision, debouncedQuery]);

  // Iniciar ronda 1
  const handleInitRound1 = async () => {
    setInitializingRound(true);
    try {
      await axios.post(`/api/screening/${selectedId}/init-round1`);
      await loadStats();
      await loadRefs(1);
    } finally {
      setInitializingRound(false);
    }
  };

  // Iniciar ronda 2 — reset filtro para evitar quedar con el filtro de R1
  const handleInitRound2 = async () => {
    setInitializingRound(true);
    try {
      await axios.post(`/api/screening/${selectedId}/init-round2`);
      setFilterDecision('all'); // ← reset antes de cambiar de fase
      setPhase('full_text');
      await loadStats();
      // loadRefs se disparará automáticamente por el useEffect al cambiar phase/filterDecision
    } finally {
      setInitializingRound(false);
    }
  };

  // Registrar decisión
  const handleDecide = async (referenceId, decision, criterionIds = [], notes = null) => {
    setDeciding(referenceId);
    try {
      await axios.post(`/api/screening/${selectedId}/decide`, {
        reference_id:  referenceId,
        phase,
        decision,
        criterion_ids: criterionIds,
        notes,
      });
      // Actualizar la fila localmente (sin recargar todo)
      const criterionLabels = criterionIds
        .map(id => criteria.find(c => c.id === id)?.label).filter(Boolean);
      setRefs(prev => prev.map(r =>
        r.id === referenceId
          ? { ...r, decision, criterion_ids: criterionIds, criterion_labels: criterionLabels }
          : r
      ));
      // Refrescar stats en background
      loadStats();
    } catch (e) {
      console.error('Error al decidir:', e);
    } finally {
      setDeciding(null);
    }
  };

  const currentPhaseStats = stats ? (phase === 'title_abstract' ? stats.round1 : stats.round2) : null;
  const progressPct = currentPhaseStats?.total > 0
    ? Math.round((currentPhaseStats.decided / currentPhaseStats.total) * 100)
    : 0;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Filter size={20} className="text-blue-600" />
          Screening
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Filtra referencias en 2 rondas: título/abstract → texto completo.
        </p>
      </div>

      {/* Criterios */}
      <CriteriaManager criteria={criteria} onReload={loadCriteria} />

      {/* Selector de búsqueda */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
          Búsqueda a revisar
        </label>
        <select
          value={selectedId}
          onChange={e => {
            const id  = e.target.value;
            const obj = searches.find(s => String(s.id) === id);
            setPhase('title_abstract');
            setFilterDecision('all');
            if (onSearchChange) onSearchChange(obj ? { id: obj.id, name: obj.name } : null);
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">— Selecciona una búsqueda —</option>
          {searches.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}  ({s.reference_count ?? '?'} refs)
            </option>
          ))}
        </select>
      </div>

      {!selectedId && (
        <div className="text-center py-16 text-gray-300">
          <Filter size={48} className="mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Selecciona una búsqueda para comenzar</p>
        </div>
      )}

      {selectedId && stats && (
        <>
          {/* Tabs de ronda */}
          <div className="flex gap-2">
            {[
              { key: 'title_abstract', label: 'Ronda 1 · Título/Abstract', icon: BookOpen, s: stats.round1 },
              { key: 'full_text',      label: 'Ronda 2 · Texto completo',   icon: FileText, s: stats.round2 },
            ].map(({ key, label, icon: Icon, s }) => (
              <button
                key={key}
                onClick={async () => {
                  setPhase(key);
                  setFilterDecision('all');
                  // Al cambiar a Ronda 2, sincronizar automáticamente cualquier
                  // nuevo "include" de Ronda 1 que aún no esté en Ronda 2
                  if (key === 'full_text') {
                    try {
                      await axios.post(`/api/screening/${selectedId}/init-round2`);
                      await loadStats();
                    } catch { /* silencioso */ }
                  }
                }}
                disabled={key === 'full_text' && !stats.round2_available}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors
                  ${phase === key
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : key === 'full_text' && !stats.round2_available
                      ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400'
                      : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
              >
                <Icon size={15} />
                {label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  phase === key ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {s.total}
                </span>
                {/* Badge: nuevos includes de R1 pendientes de sincronizar */}
                {key === 'full_text' && stats.pending_sync > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold bg-amber-400 text-white" title={`${stats.pending_sync} paper(s) incluidos en Ronda 1 aún no agregados a Ronda 2`}>
                    +{stats.pending_sync}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Estado: Ronda no iniciada */}
          {phase === 'title_abstract' && !stats.round1_started && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 text-center">
              <BookOpen size={32} className="text-blue-400 mx-auto mb-2" />
              <p className="text-blue-700 font-semibold mb-1">Ronda 1 no iniciada</p>
              <p className="text-blue-600 text-sm mb-4">
                Se inicializarán {stats.total_refs} referencias como "pendiente" para revisar por título y abstract.
              </p>
              <button
                onClick={handleInitRound1}
                disabled={initializingRound}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-medium"
              >
                {initializingRound ? <Loader size={14} className="animate-spin" /> : <BookOpen size={14} />}
                Iniciar Ronda 1
              </button>
            </div>
          )}

          {phase === 'full_text' && !stats.round2_available && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-center">
              <FileText size={32} className="text-amber-400 mx-auto mb-2" />
              <p className="text-amber-700 font-semibold mb-1">Ronda 2 no disponible</p>
              <p className="text-amber-600 text-sm">
                Debes incluir al menos una referencia en la Ronda 1 antes de iniciar la Ronda 2.
              </p>
            </div>
          )}

          {/* Progreso y filtros (cuando la ronda está activa) */}
          {currentPhaseStats && currentPhaseStats.total > 0 && (
            <>
              {/* Barra de progreso + stats */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="font-semibold text-gray-700">
                    Progreso — {selectedSearch?.name}
                  </span>
                  <span>{currentPhaseStats.decided} / {currentPhaseStats.total} revisados ({progressPct}%)</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                {/* Contadores */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { key: 'include', label: 'Incluidos',  color: 'text-green-600', bg: 'bg-green-50' },
                    { key: 'exclude', label: 'Excluidos',  color: 'text-red-600',   bg: 'bg-red-50'   },
                    { key: 'maybe',   label: 'Revisar',    color: 'text-amber-600', bg: 'bg-amber-50' },
                    { key: 'pending', label: 'Pendientes', color: 'text-gray-500',  bg: 'bg-gray-50'  },
                  ].map(({ key, label, color, bg }) => (
                    <div key={key} className={`${bg} rounded-lg p-2`}>
                      <div className={`text-lg font-bold ${color}`}>{currentPhaseStats[key]}</div>
                      <div className="text-gray-500">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Botón avanzar a ronda 2 */}
                {phase === 'title_abstract' && currentPhaseStats.include > 0 && (
                  <div className="border-t border-gray-100 pt-3 flex justify-end">
                    <button
                      onClick={handleInitRound2}
                      disabled={initializingRound || stats.round2_available}
                      className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
                    >
                      {initializingRound
                        ? <Loader size={14} className="animate-spin" />
                        : <ArrowRight size={14} />
                      }
                      {stats.round2_available
                        ? 'Ronda 2 ya iniciada'
                        : `Iniciar Ronda 2 (${currentPhaseStats.include} incluidas)`
                      }
                    </button>
                  </div>
                )}
              </div>

              {/* Toolbar de filtros + búsqueda */}
              <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-gray-500 uppercase shrink-0">Filtrar:</span>
                {['all', 'pending', 'include', 'maybe', 'exclude'].map(d => (
                  <button
                    key={d}
                    onClick={() => setFilterDecision(d)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors shrink-0 ${
                      filterDecision === d
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {d === 'all'     ? `Todas (${currentPhaseStats.total})` :
                     d === 'pending' ? `Pendientes (${currentPhaseStats.pending})` :
                     d === 'include' ? `Incluidas (${currentPhaseStats.include})` :
                     d === 'maybe'   ? `Revisar (${currentPhaseStats.maybe})` :
                                       `Excluidas (${currentPhaseStats.exclude})`}
                  </button>
                ))}
                {/* Barra de búsqueda */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                  <input
                    value={searchQuery}
                    onChange={e => handleQueryChange(e.target.value)}
                    placeholder="Buscar por título, autores…"
                    className="w-full text-xs border border-gray-200 rounded-lg pl-7 pr-6 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setDebouncedQuery(''); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => loadRefs(pagination.page)}
                  className="text-gray-400 hover:text-blue-500 shrink-0"
                  title="Recargar"
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
                  <AlertTriangle size={16} /> {error}
                </div>
              )}

              {/* Lista de referencias */}
              {loading ? (
                <div className="flex items-center justify-center gap-3 py-12 text-blue-600">
                  <Loader size={22} className="animate-spin" />
                  <span className="text-sm font-medium">Cargando referencias…</span>
                </div>
              ) : refs.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-lg border border-gray-200">
                  <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-semibold">No hay referencias con este filtro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {refs.map(ref => (
                    <RefRow
                      key={ref.id}
                      data={ref}
                      criteria={criteria}
                      phase={phase}
                      onDecide={handleDecide}
                      deciding={deciding}
                    />
                  ))}

                  {/* Paginación */}
                  {pagination.pages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <button
                        onClick={() => loadRefs(pagination.page - 1)}
                        disabled={pagination.page <= 1 || loading}
                        className="flex items-center gap-1 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                      >
                        <ChevronLeft size={14} /> Anterior
                      </button>
                      <span className="text-xs text-gray-500">
                        Página {pagination.page} de {pagination.pages}
                        {' '}({pagination.total} refs)
                      </span>
                      <button
                        onClick={() => loadRefs(pagination.page + 1)}
                        disabled={pagination.page >= pagination.pages || loading}
                        className="flex items-center gap-1 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                      >
                        Siguiente <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
