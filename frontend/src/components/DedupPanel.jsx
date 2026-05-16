import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Copy, CheckCircle, AlertTriangle, Loader,
  ChevronDown, ChevronUp, Trash2, Search, AlertCircle, Database, X, Sliders,
} from 'lucide-react';

const METHOD_LABEL = {
  doi_exact:        { label: 'DOI exacto',     color: 'bg-red-100 text-red-700 border-red-200' },
  title_normalized: { label: 'Título similar', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  fuzzy_title:      { label: 'Fuzzy',          color: 'bg-purple-100 text-purple-700 border-purple-200' },
  manual:           { label: 'Manual',         color: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// ── Modal unificado de confirmación ───────────────────────────
// Para pares idénticos: confirmación simple.
// Para pares con diferencias: comparación + elección de cuál conservar.
function ConfirmModal({ pair, queuePos, queueTotal, onConfirm, onSkip, onCancel, removing }) {
  const [choice, setChoice] = useState(null); // 'canonical' | 'duplicate'  — solo para conflictos

  const fields = ['title', 'authors', 'doi'];
  const fieldLabel = { title: 'Título', authors: 'Autores', doi: 'DOI' };

  const diffFields = fields.filter(f => {
    const a = (pair.canonical[f] || '').trim().toLowerCase();
    const b = (pair.duplicate[f]  || '').trim().toLowerCase();
    return a !== b && a !== '' && b !== '';
  });
  const isIdentical = diffFields.length === 0;

  // Reset choice when pair changes
  useEffect(() => { setChoice(null); }, [pair]);

  const handleConfirm = () => {
    if (isIdentical) {
      // Conservamos la canónica (ID menor), eliminamos la duplicada
      onConfirm('canonical', pair);
    } else {
      if (choice) onConfirm(choice, pair);
    }
  };

  const canConfirm = isIdentical || choice !== null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full max-h-[90vh] overflow-y-auto ${isIdentical ? 'max-w-2xl' : 'max-w-4xl'}`}>

        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {isIdentical
                ? <CheckCircle size={18} className="text-green-500" />
                : <AlertCircle  size={18} className="text-amber-500" />
              }
              <h3 className="font-bold text-gray-800">
                {isIdentical ? 'Confirmar eliminación de duplicado' : 'Campos distintos — ¿Con cuál te quedas?'}
              </h3>
            </div>
            <p className="text-xs text-gray-400">
              Par {queuePos} de {queueTotal}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Caso idéntico: resumen compacto */}
          {isIdentical && (
            <>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                Todos los campos principales son iguales. Se conservará la referencia con ID menor
                <strong> (#{pair.canonical.id})</strong> y se eliminará la duplicada
                <strong> (#{pair.duplicate.id})</strong>.
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="border border-green-300 bg-green-50 rounded-lg p-3 space-y-1">
                  <p className="font-bold text-green-700 uppercase text-[10px]">✓ SE CONSERVA · ID #{pair.canonical.id}</p>
                  <p className="font-medium text-gray-800 leading-snug">{pair.canonical.title}</p>
                  <p className="text-gray-500">{pair.canonical.authors?.split(';')[0]?.trim() || '—'}</p>
                  <p className="text-gray-400">Año: {pair.canonical.year ?? '—'}</p>
                  <p className="text-gray-400 break-all">DOI: {pair.canonical.doi ?? '—'}</p>
                </div>
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-1">
                  <p className="font-bold text-red-600 uppercase text-[10px]">✗ SE ELIMINARÁ · ID #{pair.duplicate.id}</p>
                  <p className="font-medium text-gray-800 leading-snug">{pair.duplicate.title}</p>
                  <p className="text-gray-500">{pair.duplicate.authors?.split(';')[0]?.trim() || '—'}</p>
                  <p className="text-gray-400">Año: {pair.duplicate.year ?? '—'}</p>
                  <p className="text-gray-400 break-all">DOI: {pair.duplicate.doi ?? '—'}</p>
                </div>
              </div>
            </>
          )}

          {/* Caso conflicto: comparación + selección */}
          {!isIdentical && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                <strong>Campos que difieren:</strong> {diffFields.map(f => fieldLabel[f]).join(', ')}.
                Selecciona cuál referencia quieres <strong>conservar</strong>; la otra se eliminará.
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'canonical', ref: pair.canonical, label: 'Opción A · conservar' },
                  { key: 'duplicate', ref: pair.duplicate, label: 'Opción B · conservar' },
                ].map(({ key, ref, label }) => (
                  <button
                    key={key}
                    onClick={() => setChoice(key)}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${
                      choice === key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-bold uppercase tracking-wide ${
                        choice === key ? 'text-blue-600' : 'text-gray-500'
                      }`}>{label}</span>
                      {choice === key && <CheckCircle size={16} className="text-blue-500 shrink-0" />}
                    </div>
                    <RefCard
                      data={ref}
                      label=""
                      labelColor=""
                      diffFields={diffFields}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={onSkip}
            disabled={removing}
            className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Saltar este par
          </button>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={removing}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              Cancelar todo
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || removing}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-40 font-medium flex items-center gap-2"
            >
              {removing
                ? <><Loader size={14} className="animate-spin" /> Eliminando…</>
                : isIdentical
                  ? <><Trash2 size={14} /> Confirmar eliminación</>
                  : <><Trash2 size={14} /> Eliminar la otra</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de campos completos (usada en fila expandida y en modal) ──
// NOTA: no usar "ref" como nombre de prop — es reservado por React
function RefCard({ data, label, labelColor, diffFields = [] }) {
  const rows = [
    { key: 'title',    label: 'Título',          value: data.title    },
    { key: 'authors',  label: 'Autores',          value: data.authors  },
    { key: 'year',     label: 'Año',              value: data.year     },
    { key: 'journal',  label: 'Revista/Fuente',   value: data.journal  },
    { key: 'doi',      label: 'DOI',              value: data.doi,  mono: true },
    { key: 'url',      label: 'URL',              value: data.url,  mono: true },
    { key: 'keywords', label: 'Palabras clave',   value: data.keywords },
    { key: 'abstract', label: 'Abstract',         value: data.abstract },
  ].filter(r => r.value != null && r.value !== '');

  return (
    <div className="space-y-1.5 text-xs">
      {label && (
        <p className={`font-bold uppercase tracking-wide text-[10px] ${labelColor}`}>
          {label} · ID #{data.id}
        </p>
      )}
      {rows.length === 0 && <p className="text-gray-400 italic">Sin datos</p>}
      {rows.map(r => (
        <div key={r.key}>
          <span className={`font-semibold ${diffFields.includes(r.key) ? 'text-amber-600' : 'text-gray-500'}`}>
            {r.label}:{' '}
          </span>
          <span className={`
            ${diffFields.includes(r.key) ? 'text-amber-800 font-medium' : 'text-gray-700'}
            ${r.mono ? 'font-mono break-all' : ''}
          `}>
            {String(r.value)}
          </span>
        </div>
      ))}
      {/* Indicador de completitud */}
      <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
        {rows.length} campo(s) con datos
      </p>
    </div>
  );
}

// ── Fila de un par duplicado ───────────────────────────────────
function DupRow({ pair, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const method = METHOD_LABEL[pair.method] ?? METHOD_LABEL.manual;

  const compareFields = ['title', 'authors', 'doi'];
  const diffFields = compareFields.filter(f => {
    const a = (pair.canonical[f] || '').trim().toLowerCase();
    const b = (pair.duplicate[f]  || '').trim().toLowerCase();
    return a !== b && a !== '' && b !== '';
  });
  const isIdentical = diffFields.length === 0;

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      selected ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300'
    }`}>
      {/* Cabecera — checkbox aislado, resto clickeable para expandir */}
      <div className="flex items-center gap-3 p-3">
        {/* Checkbox: NO propaga el click al expansor */}
        <div onClick={e => e.stopPropagation()} className="shrink-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(pair)}
            className="w-4 h-4 rounded border-gray-300 text-red-600 cursor-pointer"
          />
        </div>

        {/* Todo lo demás es clickeable para expandir */}
        <div
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${method.color}`}>
            {method.label}
          </span>

          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
            isIdentical ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isIdentical ? '≡ Idéntico' : '≠ Con diferencias'}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate" title={pair.duplicate.title}>
              {pair.duplicate.title}
            </p>
            <p className="text-xs text-gray-400">
              {pair.duplicate.authors?.split(';')[0]?.trim() || '—'}
              {pair.duplicate.year ? ` · ${pair.duplicate.year}` : ''}
              {pair.duplicate.doi  ? ` · ${pair.duplicate.doi}`  : ''}
            </p>
          </div>

          <span className="text-gray-400 shrink-0">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </div>

      {/* Detalle expandido — todos los campos */}
      {expanded && (
        <div className="border-t border-gray-100 p-3 grid grid-cols-2 gap-4 bg-gray-50">
          <RefCard
            data={pair.canonical}
            label="Canónica"
            labelColor="text-green-700"
            diffFields={diffFields}
          />
          <RefCard
            data={pair.duplicate}
            label="Duplicada"
            labelColor="text-red-600"
            diffFields={diffFields}
          />
        </div>
      )}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────
export default function DedupPanel({ selectedSearch, onSearchChange }) {
  const [searches, setSearches]         = useState([]);
  // selectedId derivado del prop — sin copia local que pueda desincronizarse
  const selectedId = selectedSearch?.id ? String(selectedSearch.id) : '';
  const [pairs, setPairs]               = useState([]);
  const [stats, setStats]               = useState(null);
  const [sources, setSources]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [removing, setRemoving]         = useState(false);
  const [error, setError]               = useState(null);
  const [selected, setSelected]         = useState(new Set());
  const [filterMethod, setFilterMethod] = useState('all');
  const [fuzzyMode,    setFuzzyMode]    = useState(false);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(90);

  // Cola de pares pendientes de confirmación manual
  const [confirmQueue, setConfirmQueue]       = useState([]);
  const [currentConfirm, setCurrentConfirm]   = useState(null);
  const [removeResults, setRemoveResults]     = useState(null);

  useEffect(() => {
    axios.get('/api/searches').then(r => setSearches(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedId) {
      runFind(selectedId);
    } else {
      setPairs([]); setStats(null); setSources(null);
      setSelected(new Set()); setError(null); setRemoveResults(null);
    }
  }, [selectedId]);

  const runFind = async (sid, useFuzzy = fuzzyMode, threshold = fuzzyThreshold) => {
    setLoading(true);
    setError(null);
    setPairs([]);
    setStats(null);
    setSources(null);
    setSelected(new Set());
    setRemoveResults(null);
    try {
      const endpoint = useFuzzy ? '/api/dedup/find-fuzzy' : '/api/dedup/find';
      const params   = useFuzzy
        ? { search_id: sid, threshold }
        : { search_id: sid };

      const [findRes, srcRes] = await Promise.all([
        axios.post(endpoint, null, { params }),
        axios.get('/api/dedup/sources', { params: { search_id: sid } }),
      ]);
      setPairs(findRes.data.pairs || []);
      if (useFuzzy) {
        setStats({
          checked: findRes.data.total_references_checked,
          fuzzy:   findRes.data.fuzzy_duplicates,
          total:   findRes.data.fuzzy_duplicates || 0,
          mode:    'fuzzy',
          threshold,
        });
      } else {
        setStats({
          checked: findRes.data.total_references_checked,
          doi:     findRes.data.doi_duplicates,
          title:   findRes.data.title_duplicates,
          total:   (findRes.data.doi_duplicates || 0) + (findRes.data.title_duplicates || 0),
          mode:    'exact',
        });
      }
      setSources(srcRes.data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Error al analizar duplicados');
    } finally {
      setLoading(false);
    }
  };

  const pairKey = (p) => `${p.duplicate.id}-${p.canonical.id}`;

  const removePairFromUI = (pair) => {
    const key = pairKey(pair);
    setPairs(prev => prev.filter(p => pairKey(p) !== key));
    setSelected(prev => { const next = new Set(prev); next.delete(key); return next; });
  };

  const toggleSelect = (pair) => {
    const k = pairKey(pair);
    setSelected(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = visiblePairs;
    const allSel  = visible.every(p => selected.has(pairKey(p)));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSel) { visible.forEach(p => next.delete(pairKey(p))); }
      else        { visible.forEach(p => next.add(pairKey(p))); }
      return next;
    });
  };

  // ── Abrir la cola de confirmación ─────────────────────────────
  // Todos los pares seleccionados pasan por el modal, sin excepción.
  const handleEliminar = () => {
    const selectedPairs = pairs.filter(p => selected.has(pairKey(p)));
    if (selectedPairs.length === 0) return;
    setConfirmQueue(selectedPairs);
    setCurrentConfirm(selectedPairs[0]);
  };

  // El usuario confirmó: keepChoice = 'canonical' | 'duplicate'
  const handleConfirm = async (keepChoice, pair) => {
    const toDeleteId = keepChoice === 'canonical' ? pair.duplicate.id : pair.canonical.id;
    const toKeepId   = keepChoice === 'canonical' ? pair.canonical.id : pair.duplicate.id;

    setRemoving(true);
    try {
      await axios.delete('/api/dedup/remove', {
        data: { duplicate_id: toDeleteId, canonical_id: toKeepId, search_id: parseInt(selectedId) },
      });
      removePairFromUI(pair);
      setRemoveResults(prev => ({ removed: (prev?.removed || 0) + 1, errors: prev?.errors || 0 }));
    } catch (e) {
      console.error('Error eliminando duplicado:', e.response?.data || e.message);
      setRemoveResults(prev => ({ removed: prev?.removed || 0, errors: (prev?.errors || 0) + 1 }));
    } finally {
      setRemoving(false);
    }
    advanceQueue(pair);
  };

  // El usuario saltó este par (lo deja en la lista)
  const handleSkip = (pair) => {
    advanceQueue(pair);
  };

  // Cancelar toda la cola
  const handleCancelQueue = () => {
    setConfirmQueue([]);
    setCurrentConfirm(null);
  };

  const advanceQueue = (processedPair) => {
    const remaining = confirmQueue.filter(p => pairKey(p) !== pairKey(processedPair));
    setConfirmQueue(remaining);
    setCurrentConfirm(remaining.length > 0 ? remaining[0] : null);
  };

  // Filtrado y conteos
  const visiblePairs  = pairs.filter(p => filterMethod === 'all' || p.method === filterMethod);
  const selectedCount = visiblePairs.filter(p => selected.has(pairKey(p))).length;
  const allVisible    = visiblePairs.length > 0 && visiblePairs.every(p => selected.has(pairKey(p)));
  const currentSearch = searches.find(s => String(s.id) === String(selectedId));

  // Posición en la cola para el modal
  const confirmQueuePos = confirmQueue.length > 0 && currentConfirm
    ? (confirmQueue.findIndex(p => pairKey(p) === pairKey(currentConfirm)) + 1)
    : 0;
  const confirmQueueTotal = confirmQueue.length + (removeResults?.removed || 0) + (removeResults?.errors || 0);
  // En realidad queremos mostrar el total ORIGINAL de la cola antes de procesar:
  const [originalQueueSize, setOriginalQueueSize] = useState(0);

  // Guardar tamaño original de la cola al abrirla
  const handleEliminarWrapper = () => {
    const selectedPairs = pairs.filter(p => selected.has(pairKey(p)));
    if (selectedPairs.length === 0) return;
    setOriginalQueueSize(selectedPairs.length);
    setConfirmQueue(selectedPairs);
    setCurrentConfirm(selectedPairs[0]);
  };

  const currentPos = currentConfirm
    ? originalQueueSize - confirmQueue.length + 1
    : 0;

  return (
    <div className="space-y-5">

      {/* Modal de confirmación (idéntico o conflicto) */}
      {currentConfirm && (
        <ConfirmModal
          pair={currentConfirm}
          queuePos={currentPos}
          queueTotal={originalQueueSize}
          onConfirm={handleConfirm}
          onSkip={() => handleSkip(currentConfirm)}
          onCancel={handleCancelQueue}
          removing={removing}
        />
      )}

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Copy size={20} className="text-purple-600" />
          Análisis de Duplicados
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Selecciona una búsqueda para detectar referencias duplicadas y confirmarlas una por una.
        </p>
      </div>

      {/* Selector de búsqueda */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
          Búsqueda a analizar
        </label>
        <div className="flex gap-3 items-center flex-wrap">
          <select
            value={selectedId}
            onChange={e => {
              const id  = e.target.value;
              const obj = searches.find(s => String(s.id) === id);
              if (onSearchChange) onSearchChange(obj ? { id: obj.id, name: obj.name } : null);
            }}
            className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            <option value="">— Selecciona una búsqueda —</option>
            {searches.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}  ({s.reference_count ?? '?'} refs)
              </option>
            ))}
          </select>
          {selectedId && !loading && (
            <button
              onClick={() => runFind(selectedId)}
              className="flex items-center gap-2 text-purple-600 hover:text-purple-800 text-sm border border-purple-200 px-3 py-2 rounded-lg hover:bg-purple-50"
            >
              <Search size={14} /> Re-analizar
            </button>
          )}

          {/* Toggle fuzzy */}
          <button
            onClick={() => setFuzzyMode(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${
              fuzzyMode
                ? 'bg-purple-600 text-white border-purple-600'
                : 'border-gray-300 text-gray-600 hover:bg-purple-50 hover:border-purple-300'
            }`}
            title="Búsqueda fuzzy: detecta títulos muy similares (no exactos)"
          >
            <Sliders size={14} /> Fuzzy
          </button>
        </div>

        {/* Slider de umbral fuzzy */}
        {fuzzyMode && (
          <div className="mt-3 flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg p-3">
            <Sliders size={15} className="text-purple-600 shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-semibold text-purple-700 block mb-1">
                Umbral de similitud: <span className="font-bold">{fuzzyThreshold}%</span>
              </label>
              <input
                type="range"
                min={70} max={99} step={1}
                value={fuzzyThreshold}
                onChange={e => setFuzzyThreshold(Number(e.target.value))}
                className="w-full accent-purple-600"
              />
              <div className="flex justify-between text-[10px] text-purple-400 mt-0.5">
                <span>70% — más resultados</span>
                <span>99% — más precisión</span>
              </div>
            </div>
            <p className="text-xs text-purple-600 max-w-[140px]">
              Solo compara refs sin DOI, complementa la búsqueda exacta.
            </p>
          </div>
        )}
      </div>

      {/* Estado vacío */}
      {!selectedId && (
        <div className="text-center py-16 text-gray-300">
          <Copy size={48} className="mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Selecciona una búsqueda para comenzar</p>
        </div>
      )}

      {/* Cargando */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-12 text-purple-600">
          <Loader size={22} className="animate-spin" />
          <span className="text-sm font-medium">Analizando duplicados en {currentSearch?.name}…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Resultados */}
      {!loading && stats && (
        <>
          {/* Resumen */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">
              Resultado del análisis · {currentSearch?.name}
            </p>

            {stats.mode === 'fuzzy' && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-700 flex items-center gap-2">
                <Sliders size={13} />
                Modo Fuzzy activo — umbral {stats.threshold}% — solo refs sin DOI
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-gray-800">{stats.checked}</div>
                <div className="text-xs text-gray-500">Referencias analizadas</div>
              </div>
              <div className={`rounded-lg p-3 ${stats.total > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div className={`text-2xl font-bold ${stats.total > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {stats.total}
                </div>
                <div className="text-xs text-gray-500">Duplicados detectados</div>
              </div>
              {stats.mode === 'fuzzy' ? (
                <div className="bg-purple-50 rounded-lg p-3 col-span-2">
                  <div className="text-2xl font-bold text-purple-600">{stats.fuzzy}</div>
                  <div className="text-xs text-gray-500">Por similitud de título ≥{stats.threshold}%</div>
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-amber-600">{stats.doi}</div>
                    <div className="text-xs text-gray-500">Por DOI exacto</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-purple-600">{stats.title}</div>
                    <div className="text-xs text-gray-500">Por título similar</div>
                  </div>
                </>
              )}
            </div>

            {/* Fuentes (WoS / Scopus / etc.) */}
            {sources && sources.sources_found?.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1">
                  <Database size={12} /> Origen de referencias
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(sources.per_source_total || {}).map(([src, count]) => (
                    <div key={src} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-blue-700">{src}</span>
                      <span className="text-xl font-bold text-blue-800">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resultado de eliminaciones */}
          {removeResults && (
            <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm border ${
              removeResults.errors > 0
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-green-50 border-green-200 text-green-700'
            }`}>
              <CheckCircle size={16} />
              {removeResults.removed > 0 && (
                <span>Se eliminaron <strong>{removeResults.removed}</strong> duplicado(s).</span>
              )}
              {removeResults.errors > 0 && (
                <span className="text-red-600 ml-1">{removeResults.errors} error(es) — algunos pares no se pudieron eliminar.</span>
              )}
            </div>
          )}

          {/* Sin duplicados */}
          {pairs.length === 0 && (
            <div className="text-center py-10 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle size={36} className="text-green-500 mx-auto mb-2" />
              <p className="text-green-700 font-semibold">¡Sin duplicados en esta búsqueda!</p>
              <p className="text-green-600 text-sm mt-1">
                Las {stats.checked} referencias son únicas.
              </p>
            </div>
          )}

          {/* Lista de pares */}
          {pairs.length > 0 && (
            <div className="space-y-3">

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allVisible}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-red-600"
                  />
                  Seleccionar todos
                </label>

                <select
                  value={filterMethod}
                  onChange={e => setFilterMethod(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600"
                >
                  <option value="all">Todos los métodos ({pairs.length})</option>
                  {stats.mode !== 'fuzzy' && <option value="doi_exact">DOI exacto ({stats.doi})</option>}
                  {stats.mode !== 'fuzzy' && <option value="title_normalized">Título similar ({stats.title})</option>}
                  {stats.mode === 'fuzzy'  && <option value="fuzzy_title">Fuzzy ({stats.fuzzy})</option>}
                </select>

                <span className="text-xs text-gray-400 ml-auto">
                  {selectedCount > 0 ? `${selectedCount} seleccionado(s)` : `${visiblePairs.length} par(es)`}
                </span>

                <button
                  onClick={handleEliminarWrapper}
                  disabled={selectedCount === 0 || removing}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Trash2 size={14} /> Eliminar seleccionados ({selectedCount})
                </button>
              </div>

              <p className="text-xs text-gray-400 px-1">
                Selecciona los pares que deseas revisar y haz clic en "Eliminar seleccionados".
                Se abrirá un modal de confirmación uno por uno — ninguna referencia se elimina sin tu aprobación.
                Si hay diferencias en título, autores o DOI, podrás elegir cuál conservar.
              </p>

              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {visiblePairs.map(pair => (
                  <DupRow
                    key={pairKey(pair)}
                    pair={pair}
                    selected={selected.has(pairKey(pair))}
                    onToggle={toggleSelect}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
