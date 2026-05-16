/**
 * ResultsPanel.jsx — PASO 12
 * Vista principal de Resultados con 3 pestañas:
 *   1. Diagrama PRISMA
 *   2. Gráficos
 *   3. Exportar
 *
 * Incluye un selector de búsqueda en la parte superior.
 */

import { useEffect, useState } from 'react';
import axios from 'axios';
import { GitBranch, BarChart2, Download } from 'lucide-react';
import PRISMADiagram from './PRISMADiagram';
import StatsPanel from './StatsPanel';
import ExportPanel from './ExportPanel';

const TABS = [
  { id: 'prisma',  label: 'Diagrama PRISMA', icon: GitBranch },
  { id: 'charts',  label: 'Gráficos',        icon: BarChart2  },
  { id: 'export',  label: 'Exportar',         icon: Download   },
];

// ── Selector de búsqueda ─────────────────────────────────────────
function SearchSelector({ selected, onSelect }) {
  const [searches, setSearches] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    axios.get('/api/stats/searches')
      .then(r => {
        setSearches(r.data);
        // Auto-seleccionar la primera si no hay selección
        if (!selected && r.data.length > 0) onSelect(r.data[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-xs text-gray-400">Cargando búsquedas...</div>;
  if (searches.length === 0) return (
    <div className="text-sm text-gray-400">No hay búsquedas disponibles.</div>
  );

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-700 shrink-0">Búsqueda:</label>
      <select
        value={selected?.id || ''}
        onChange={e => {
          const s = searches.find(x => x.id === parseInt(e.target.value));
          if (s) onSelect(s);
        }}
        className="text-sm border border-gray-200 rounded-md px-3 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        {searches.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.ref_count} refs)
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────
export default function ResultsPanel() {
  const [activeTab, setActiveTab] = useState('prisma');
  const [selectedSearch, setSelectedSearch] = useState(null);

  return (
    <div>
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Resultados y Exportación</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Diagrama PRISMA 2020, estadísticas y exportación de la búsqueda
          </p>
        </div>
        <SearchSelector
          selected={selectedSearch}
          onSelect={setSelectedSearch}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-md
                  border-b-2 transition-colors
                  ${active
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenido de la pestaña */}
      <div className="min-h-64">
        {activeTab === 'prisma' && (
          <PRISMADiagram searchId={selectedSearch?.id} />
        )}
        {activeTab === 'charts' && (
          <StatsPanel searchId={selectedSearch?.id} />
        )}
        {activeTab === 'export' && (
          <ExportPanel
            searchId={selectedSearch?.id}
            searchName={selectedSearch?.name}
          />
        )}
      </div>
    </div>
  );
}
