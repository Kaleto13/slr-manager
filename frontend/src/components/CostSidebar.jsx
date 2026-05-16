/**
 * CostSidebar — widget de costos LLM acumulados.
 *
 * Uso en App.jsx:
 *   import CostSidebar, { useCostEstimate } from './components/CostSidebar';
 *   <CostSidebar collapsed={!sidebarOpen} />
 *
 * Hook para modal de confirmación pre-ejecución:
 *   const { open: openEstimate, CostEstimateModal } = useCostEstimate();
 *   openEstimate({ model, prompt, outputTokens, onConfirm })
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  DollarSign, Zap, BarChart2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, X, Loader,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(n) {
  if (n === 0) return '$0.000000';
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  return `$${n.toFixed(6)}`;
}

function fmtLocal(n, currency) {
  return `${currency} ${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const PROVIDER_COLOR = {
  anthropic: 'bg-orange-100 text-orange-700',
  openai:    'bg-green-100  text-green-700',
  google:    'bg-blue-100   text-blue-700',
};

// ── CostSidebar (widget principal) ───────────────────────────────────────────

export default function CostSidebar({ collapsed = false }) {
  const [stats,     setStats]     = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [expanded,  setExpanded]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/costs/session');
      setStats(res.data);
    } catch (e) {
      setError('No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresco automático cada 30 s
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (collapsed) {
    // Versión compacta (sidebar cerrado)
    return (
      <div className="px-2 py-3 border-t border-gray-700">
        <button onClick={load} title="Costos LLM"
          className="w-full flex justify-center p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-yellow-400">
          <DollarSign size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-700 text-xs">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-4 py-2 text-gray-400">
        <div className="flex items-center gap-1.5 font-semibold text-gray-300">
          <DollarSign size={13} className="text-yellow-400" />
          <span>Costos LLM</span>
        </div>
        <div className="flex items-center gap-1">
          {loading && <Loader size={11} className="animate-spin text-gray-500" />}
          <button onClick={load}
            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
            title="Actualizar">
            <RefreshCw size={11} />
          </button>
          <button onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="px-4 pb-2 text-red-400 text-[11px]">{error}</p>
      )}

      {stats && (
        <div className="px-4 pb-3 space-y-1">
          {/* Totales */}
          <div className="flex justify-between text-gray-400">
            <span>Consultas</span>
            <span className="text-white font-mono">{stats.queries_count}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Tokens</span>
            <span className="text-white font-mono">{fmtTokens(stats.token_summary?.total ?? 0)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Costo USD</span>
            <span className="text-yellow-300 font-mono">{fmtUsd(stats.total_usd)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>{stats.currency}</span>
            <span className="text-yellow-200 font-mono">
              {fmtLocal(stats.total_local, stats.currency)}
            </span>
          </div>

          {stats.top_model && (
            <div className="pt-1 text-[10px] text-gray-500 truncate" title={stats.top_model}>
              Modelo top: <span className="text-gray-400">{stats.top_model}</span>
            </div>
          )}

          {/* Detalle por modelo (expandible) */}
          {expanded && stats.by_model?.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-gray-700 pt-2">
              {stats.by_model.map(m => (
                <div key={m.model} className="space-y-0.5">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 truncate max-w-[120px]" title={m.display_name}>
                      {m.display_name}
                    </span>
                    <span className="text-yellow-300 font-mono">{fmtUsd(m.cost_usd)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-500">
                    <span>{m.queries} consultas</span>
                    <span>{fmtTokens(m.input_tokens + m.output_tokens)} tok</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Hook useCostEstimate — modal pre-ejecución ────────────────────────────────

/**
 * Hook que provee:
 *   - CostEstimateModal: componente JSX a montar en el árbol
 *   - openEstimate({ model, prompt, outputTokens, onConfirm, onCancel })
 *
 * Uso:
 *   const { openEstimate, CostEstimateModal } = useCostEstimate();
 *   ...
 *   <CostEstimateModal />
 *   ...
 *   <button onClick={() => openEstimate({
 *     model: 'claude-sonnet-4-5',
 *     prompt: fullPrompt,
 *     outputTokens: 800,
 *     onConfirm: () => runMyLLMCall(),
 *   })}>
 *     Analizar con IA
 *   </button>
 */
export function useCostEstimate() {
  const [open,     setOpen]     = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const callbackRef = useRef(null);

  const openEstimate = useCallback(async ({
    model        = 'claude-sonnet-4-5',
    prompt       = '',
    outputTokens = 500,
    onConfirm    = () => {},
    onCancel     = () => {},
  }) => {
    callbackRef.current = { onConfirm, onCancel };
    setEstimate(null);
    setError(null);
    setLoading(true);
    setOpen(true);

    try {
      const res = await axios.get('/api/costs/estimate', {
        params: { model, prompt, output_tokens: outputTokens },
      });
      setEstimate(res.data);
    } catch (e) {
      setError('No se pudo obtener la estimación de costo.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirm = () => {
    setOpen(false);
    callbackRef.current?.onConfirm();
  };

  const handleCancel = () => {
    setOpen(false);
    callbackRef.current?.onCancel();
  };

  function CostEstimateModal() {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2 font-semibold text-gray-800">
              <DollarSign size={18} className="text-yellow-500" />
              Estimación de costo
            </div>
            <button onClick={handleCancel}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {loading && (
              <div className="flex items-center gap-2 text-gray-500 py-4 justify-center">
                <Loader size={18} className="animate-spin" />
                <span className="text-sm">Calculando...</span>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center gap-2 text-red-500 text-sm py-2">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            {estimate && !loading && (
              <div className="space-y-3">
                {/* Modelo */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Modelo</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                    ${PROVIDER_COLOR[estimate.provider] || 'bg-gray-100 text-gray-600'}`}>
                    {estimate.display_name}
                  </span>
                </div>

                {/* Tokens */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Tokens entrada (est.)</span>
                    <span className="font-mono">{estimate.input_tokens_est.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Tokens salida (est.)</span>
                    <span className="font-mono">{estimate.output_tokens_est.toLocaleString()}</span>
                  </div>
                </div>

                {/* Costo */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between text-sm font-semibold text-gray-700">
                    <span>Costo estimado USD</span>
                    <span className="text-yellow-700 font-mono">{fmtUsd(estimate.cost_usd)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>{estimate.currency}</span>
                    <span className="font-mono">{fmtLocal(estimate.cost_local, estimate.currency)}</span>
                  </div>
                </div>

                <p className="text-[11px] text-gray-400 text-center">
                  Estimación basada en ~4 chars/token. El costo real puede variar.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-5 py-4 border-t bg-gray-50">
            <button onClick={handleCancel}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700
                         hover:bg-gray-100 transition-colors">
              Cancelar
            </button>
            <button onClick={handleConfirm}
              disabled={loading || !!error}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex items-center justify-center gap-1.5">
              <Zap size={14} />
              Ejecutar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return { openEstimate, CostEstimateModal };
}
