/**
 * ChangeLog.jsx
 *
 * Visor del historial de cambios registrados en la tabla change_log.
 * Permite filtrar por entidad, acción, entity_id y texto libre.
 * También exporta a CSV y muestra estadísticas resumidas.
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Clock, Download, RefreshCw, Filter, X, ChevronLeft, ChevronRight } from 'lucide-react';

// ── Colores por acción ────────────────────────────────────────────────────────
const ACTION_COLORS = {
  import:   'bg-blue-100 text-blue-800',
  delete:   'bg-red-100 text-red-800',
  update:   'bg-yellow-100 text-yellow-800',
  screen:   'bg-green-100 text-green-800',
  dedup:    'bg-purple-100 text-purple-800',
  qa:       'bg-indigo-100 text-indigo-800',
  extract:  'bg-orange-100 text-orange-800',
};
const actionColor = (a) => ACTION_COLORS[a] || 'bg-gray-100 text-gray-700';

// ── Formato de fecha ──────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

// ── Estadísticas ──────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div className="bg-blue-50 rounded-lg p-3 text-center">
        <p className="text-2xl font-bold text-blue-700">{stats.total}</p>
        <p className="text-xs text-blue-500 mt-0.5">Total registros</p>
      </div>
      {stats.by_action.slice(0, 3).map(({ action, count }) => (
        <div key={action} className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-700">{count}</p>
          <p className="text-xs text-gray-500 mt-0.5 capitalize">{action}</p>
        </div>
      ))}
    </div>
  );
}

// ── Fila del log ──────────────────────────────────────────────────────────────
function LogRow({ row }) {
  const [expanded, setExpanded] = useState(false);
  let detail = row.detail;
  let detailParsed = null;
  try {
    detailParsed = JSON.parse(detail);
  } catch { /* no es JSON */ }

  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{row.id}</td>
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.created_at)}</td>
      <td className="px-3 py-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor(row.action)}`}>
          {row.action || '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">{row.entity || '—'}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{row.entity_id ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-gray-600 max-w-xs">
        {expanded ? (
          <div className="whitespace-pre-wrap break-words font-mono text-[11px] bg-gray-100 rounded p-2 mt-1">
            {detailParsed
              ? JSON.stringify(detailParsed, null, 2)
              : detail || '—'
            }
          </div>
        ) : (
          <span className="truncate block max-w-[280px]">{detail || '—'}</span>
        )}
      </td>
    </tr>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────
export default function ChangeLog() {
  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [stats,      setStats]      = useState(null);
  const [entities,   setEntities]   = useState({ actions: [], entities: [] });
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);

  // Filtros
  const [filterAction,   setFilterAction]   = useState('');
  const [filterEntity,   setFilterEntity]   = useState('');
  const [filterEntityId, setFilterEntityId] = useState('');
  const [filterSearch,   setFilterSearch]   = useState('');

  // Paginación
  const LIMIT = 50;
  const [skip, setSkip] = useState(0);

  const totalPages  = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(skip / LIMIT) + 1;

  // ── Fetch log ───────────────────────────────────────────────────────────────
  const fetchLog = useCallback(async (newSkip = skip) => {
    setLoading(true);
    setError(null);
    try {
      const params = { skip: newSkip, limit: LIMIT };
      if (filterAction)   params.action    = filterAction;
      if (filterEntity)   params.entity    = filterEntity;
      if (filterEntityId) params.entity_id = filterEntityId;
      if (filterSearch)   params.search    = filterSearch;

      const res = await axios.get('/api/changelog', { params });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [skip, filterAction, filterEntity, filterEntityId, filterSearch]);

  // ── Fetch stats + entities (una vez) ────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/changelog/stats').then(r => setStats(r.data)).catch(() => {});
    axios.get('/api/changelog/entities').then(r => setEntities(r.data)).catch(() => {});
  }, []);

  // ── Fetch al cambiar filtros/página ─────────────────────────────────────────
  useEffect(() => {
    fetchLog(skip);
  }, [skip, filterAction, filterEntity, filterEntityId, filterSearch]); // eslint-disable-line

  const resetPage = () => setSkip(0);

  const clearFilters = () => {
    setFilterAction('');
    setFilterEntity('');
    setFilterEntityId('');
    setFilterSearch('');
    resetPage();
  };

  const hasFilters = filterAction || filterEntity || filterEntityId || filterSearch;

  // ── Exportar CSV ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const params = new URLSearchParams();
    if (filterAction) params.set('action', filterAction);
    if (filterEntity) params.set('entity', filterEntity);
    const url = `/api/changelog/export?${params.toString()}`;
    const a   = document.createElement('a');
    a.href    = url;
    a.download = 'changelog.csv';
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock size={20} className="text-gray-500" />
          <h2 className="text-lg font-bold text-gray-800">Historial de Cambios</h2>
          {total > 0 && (
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
              {total.toLocaleString()} registros
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchLog(skip)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
          >
            <RefreshCw size={13} /> Actualizar
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700"
          >
            <Download size={13} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center bg-gray-50 border rounded-lg p-3">
        <Filter size={14} className="text-gray-400 shrink-0" />

        <select
          value={filterAction}
          onChange={e => { setFilterAction(e.target.value); resetPage(); }}
          className="text-xs border rounded px-2 py-1.5 bg-white"
        >
          <option value="">Todas las acciones</option>
          {entities.actions.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={filterEntity}
          onChange={e => { setFilterEntity(e.target.value); resetPage(); }}
          className="text-xs border rounded px-2 py-1.5 bg-white"
        >
          <option value="">Todas las entidades</option>
          {entities.entities.map(e => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="ID registro"
          value={filterEntityId}
          onChange={e => { setFilterEntityId(e.target.value); resetPage(); }}
          className="text-xs border rounded px-2 py-1.5 w-28 bg-white"
        />

        <input
          type="text"
          placeholder="Buscar en detalle..."
          value={filterSearch}
          onChange={e => { setFilterSearch(e.target.value); resetPage(); }}
          className="text-xs border rounded px-2 py-1.5 flex-1 min-w-[150px] bg-white"
        />

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
          >
            <X size={13} /> Limpiar
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-12">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">Fecha</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Acción</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Entidad</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">ID</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  <RefreshCw size={20} className="animate-spin inline mr-2" />
                  Cargando...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                  {hasFilters ? 'Sin resultados para los filtros aplicados.' : 'No hay registros aún.'}
                </td>
              </tr>
            ) : (
              items.map(row => <LogRow key={row.id} row={row} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Mostrando {skip + 1}–{Math.min(skip + LIMIT, total)} de {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={skip === 0}
              onClick={() => setSkip(Math.max(0, skip - LIMIT))}
              className="p-1.5 border rounded hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-3 py-1.5 border rounded bg-white">
              {currentPage} / {totalPages}
            </span>
            <button
              disabled={skip + LIMIT >= total}
              onClick={() => setSkip(skip + LIMIT)}
              className="p-1.5 border rounded hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Nota de uso */}
      <p className="text-xs text-gray-400 mt-2">
        💡 Haz clic en cualquier fila para expandir el detalle completo del registro.
      </p>
    </div>
  );
}
