/**
 * QAPanel — preguntas sobre PDFs usando LLMs.
 *
 * Modos:
 *   "single"  → pregunta sobre una referencia específica con historial
 *   "batch"   → misma pregunta para todas las refs de una búsqueda
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  MessageSquare, Send, Loader, AlertCircle, CheckCircle,
  ChevronDown, ChevronUp, RefreshCw, Download, Trash2,
  Layers, FileText, DollarSign, Clock, BookOpen, X,
} from 'lucide-react';
import { useCostEstimate } from './CostSidebar';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(n) {
  if (!n) return '$0';
  return n < 0.001 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5 (recomendado)' },
  { value: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5 (más rápido/barato)' },
  { value: 'claude-opus-4-5',    label: 'Claude Opus 4.5 (más potente)' },
  { value: 'gpt-4o-mini',        label: 'GPT-4o mini' },
  { value: 'gpt-4o',             label: 'GPT-4o' },
  { value: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash' },
];

// ── Selector de búsqueda ──────────────────────────────────────────────────────
function SearchSelector({ value, onChange }) {
  const [searches, setSearches] = useState([]);
  useEffect(() => {
    axios.get('/api/searches').then(r => setSearches(r.data?.searches || r.data || [])).catch(() => {});
  }, []);
  return (
    <select value={value || ''} onChange={e => onChange(parseInt(e.target.value) || null)}
      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white
                 focus:outline-none focus:ring-1 focus:ring-blue-400 flex-1">
      <option value="">— Selecciona una búsqueda —</option>
      {searches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

// ── AnswerCard — muestra una respuesta del historial ──────────────────────────
function AnswerCard({ item, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Pregunta</p>
          <p className="text-sm text-gray-800">{item.question}</p>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
            <span>{item.model_name || item.model}</span>
            <span>{fmtUsd(item.cost_usd)}</span>
            <span>{fmtDate(item.created_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {onDelete && (
            <button onClick={() => onDelete(item.id)}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Respuesta</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{item.answer}</p>
        </div>
      )}
    </div>
  );
}

// ── Modo Single: Q&A de una referencia ────────────────────────────────────────
function SingleQA({ refId, refTitle }) {
  const [question,  setQuestion]  = useState('');
  const [model,     setModel]     = useState('claude-sonnet-4-5');
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [loadingH,  setLoadingH]  = useState(false);
  const [error,     setError]     = useState(null);
  const { openEstimate, CostEstimateModal } = useCostEstimate();

  const loadHistory = useCallback(async () => {
    if (!refId) return;
    setLoadingH(true);
    try {
      const res = await axios.get(`/api/qa/${refId}`);
      setHistory(res.data);
    } catch { /* silencioso */ }
    finally { setLoadingH(false); }
  }, [refId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleAsk = async () => {
    if (!question.trim()) return;
    openEstimate({
      model,
      prompt: question + ' '.repeat(5000),
      outputTokens: 800,
      onConfirm: async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await axios.post(`/api/qa/${refId}`, { question, model });
          setHistory(h => [res.data, ...h]);
          setQuestion('');
        } catch (e) {
          setError(e.response?.data?.detail || e.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleDelete = async (qaId) => {
    try {
      await axios.delete(`/api/qa/response/${qaId}`);
      setHistory(h => h.filter(x => x.id !== qaId));
    } catch { /* silencioso */ }
  };

  return (
    <div className="space-y-4">
      <CostEstimateModal />

      {/* Ref info */}
      {refTitle && (
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 rounded-lg px-3 py-2">
          <BookOpen size={14} className="text-blue-500 shrink-0" />
          <span className="truncate font-medium">{refTitle}</span>
        </div>
      )}

      {/* Input */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAsk(); }}
          placeholder="¿Cuál es la metodología utilizada? / ¿Cuáles son los principales hallazgos? / ..."
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none
                     focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex items-center gap-2">
          <select value={model} onChange={e => setModel(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white
                       focus:outline-none flex-1">
            {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={handleAsk} disabled={!question.trim() || loading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm
                       font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50
                       disabled:cursor-not-allowed transition-colors">
            {loading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
            {loading ? 'Consultando…' : 'Preguntar'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">Ctrl+Enter para enviar</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 text-red-600 rounded-lg px-3 py-2 text-sm">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Historial */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Historial ({history.length})
          </p>
          <button onClick={loadHistory} disabled={loadingH}
            className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <RefreshCw size={12} className={loadingH ? 'animate-spin' : ''} />
          </button>
        </div>
        {history.length === 0 && !loadingH && (
          <p className="text-sm text-gray-400 py-4 text-center">Sin preguntas aún.</p>
        )}
        {history.map(item => (
          <AnswerCard key={item.id} item={item} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}

// ── Modo Batch ────────────────────────────────────────────────────────────────
function BatchQA() {
  const [searchId,  setSearchId]  = useState(null);
  const [question,  setQuestion]  = useState('');
  const [model,     setModel]     = useState('claude-sonnet-4-5');
  const [running,   setRunning]   = useState(false);
  const [results,   setResults]   = useState(null);
  const [estimate,  setEstimate]  = useState(null);
  const [error,     setError]     = useState(null);
  const [showModal, setShowModal] = useState(false);

  const fetchEstimate = async () => {
    if (!searchId || !question.trim()) return;
    try {
      const res = await axios.post('/api/qa/batch/estimate', {
        search_id: searchId, question, model, output_tokens: 800,
      });
      setEstimate(res.data);
      setShowModal(true);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    }
  };

  const runBatch = async () => {
    setShowModal(false);
    setRunning(true);
    setResults(null);
    setError(null);
    try {
      const res = await axios.post('/api/qa/batch', {
        search_id: searchId, question, model,
      }, { timeout: 600_000 });  // 10 min timeout
      setResults(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    window.open(`/api/qa/batch/${searchId}/export-csv?question=${encodeURIComponent(question)}`, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Modal de confirmación */}
      {showModal && estimate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <span className="font-semibold text-gray-800 flex items-center gap-2">
                <DollarSign size={16} className="text-yellow-500" />
                Confirmar consulta batch
              </span>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded hover:bg-gray-100">
                <X size={15} className="text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Referencias con texto</span>
                <span className="font-semibold">{estimate.refs_with_text}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Modelo</span>
                <span className="font-semibold">{estimate.model}</span>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                <div className="flex justify-between font-semibold text-gray-700">
                  <span>Costo estimado USD</span>
                  <span className="text-yellow-700">{fmtUsd(estimate.estimated_cost_usd)}</span>
                </div>
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>{estimate.currency}</span>
                  <span>{estimate.estimated_cost_local?.toLocaleString('es-CL', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 text-center">
                Estimación aproximada. El costo real puede variar según la longitud del texto.
              </p>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t bg-gray-50">
              <button onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={runBatch}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700
                           flex items-center justify-center gap-1.5">
                <Send size={13} />
                Ejecutar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulario */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <SearchSelector value={searchId} onChange={setSearchId} />
        </div>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Pregunta que se hará a todos los PDFs de la búsqueda…"
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none
                     focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex items-center gap-2">
          <select value={model} onChange={e => setModel(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white
                       focus:outline-none flex-1">
            {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button
            onClick={fetchEstimate}
            disabled={!searchId || !question.trim() || running}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm
                       font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50
                       disabled:cursor-not-allowed transition-colors">
            {running ? <Loader size={14} className="animate-spin" /> : <Layers size={14} />}
            {running ? 'Procesando…' : 'Preguntar a todos'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Solo se consultarán referencias que tengan texto extraído de su PDF.
          La operación puede tardar varios minutos.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 text-red-600 rounded-lg px-3 py-2 text-sm">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3 bg-blue-50 text-blue-700 rounded-lg px-4 py-3 text-sm">
          <Loader size={16} className="animate-spin shrink-0" />
          <span>Consultando PDFs… esto puede tomar varios minutos.</span>
        </div>
      )}

      {/* Resultados */}
      {results && (
        <div className="space-y-3">
          {/* Resumen */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <CheckCircle size={16} className="text-green-500" />
                Resultados batch
              </h3>
              <button onClick={exportCsv}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-300
                           text-gray-600 rounded-lg hover:bg-gray-50">
                <Download size={12} />
                Exportar CSV
              </button>
            </div>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>✓ <strong>{results.processed}</strong> procesadas</span>
              {results.errors?.length > 0 && (
                <span className="text-red-500">✗ <strong>{results.errors.length}</strong> errores</span>
              )}
              <span className="text-yellow-600">
                <DollarSign size={13} className="inline" /> {fmtUsd(results.total_cost_usd)} total
              </span>
            </div>
          </div>

          {/* Tabla de resultados */}
          <div className="space-y-2">
            {results.results?.map(r => (
              <AnswerCard key={r.id || r.reference_id} item={{
                ...r, model_name: r.model,
              }} />
            ))}
          </div>

          {/* Errores */}
          {results.errors?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
              <p className="text-sm font-semibold text-red-700 mb-2">
                Referencias con error ({results.errors.length}):
              </p>
              {results.errors.map(e => (
                <div key={e.reference_id} className="text-xs text-red-600">
                  <span className="font-medium">{e.ref_title}</span>: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel de selección de referencia para modo single ─────────────────────────
function RefSelector({ searchId, onSelect, selectedId }) {
  const [refs, setRefs] = useState([]);

  useEffect(() => {
    if (!searchId) { setRefs([]); return; }
    axios.get(`/api/references/${searchId}/list`)
      .then(r => setRefs(r.data.filter(x => x.has_text)))
      .catch(() => {});
  }, [searchId]);

  if (!refs.length) return (
    <p className="text-xs text-gray-400 py-2">
      No hay referencias con texto extraído en esta búsqueda.
    </p>
  );

  return (
    <select value={selectedId || ''} onChange={e => {
      const r = refs.find(x => x.id === parseInt(e.target.value));
      onSelect(r || null);
    }}
      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white
                 focus:outline-none focus:ring-1 focus:ring-blue-400">
      <option value="">— Selecciona una referencia —</option>
      {refs.map(r => (
        <option key={r.id} value={r.id}>
          [{r.id}] {r.title?.slice(0, 80) || 'Sin título'} {r.year ? `(${r.year})` : ''}
        </option>
      ))}
    </select>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function QAPanel() {
  const [mode,       setMode]       = useState('single');  // 'single' | 'batch'
  const [searchId,   setSearchId]   = useState(null);
  const [selectedRef, setSelectedRef] = useState(null);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { id: 'single', label: 'Por referencia',   icon: FileText },
          { id: 'batch',  label: 'Consulta masiva',  icon: Layers   },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setMode(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium
                transition-colors
                ${mode === tab.id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Modo single */}
      {mode === 'single' && (
        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            <SearchSelector value={searchId} onChange={id => { setSearchId(id); setSelectedRef(null); }} />
          </div>
          {searchId && (
            <RefSelector
              searchId={searchId}
              selectedId={selectedRef?.id}
              onSelect={setSelectedRef}
            />
          )}
          {selectedRef
            ? <SingleQA refId={selectedRef.id} refTitle={selectedRef.title} />
            : (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <div className="text-center space-y-2">
                  <MessageSquare size={32} className="mx-auto text-gray-300" />
                  <p className="text-sm">Selecciona una búsqueda y una referencia para comenzar.</p>
                  <p className="text-xs text-gray-300">Solo se muestran refs con PDF y texto extraído.</p>
                </div>
              </div>
            )
          }
        </div>
      )}

      {/* Modo batch */}
      {mode === 'batch' && <BatchQA />}
    </div>
  );
}
