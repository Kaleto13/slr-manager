import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Menu, FileText, Settings, Search, Copy,
  Filter, Database, Download, Clock,
} from 'lucide-react';
import SearchManager   from './components/SearchManager';
import DedupPanel      from './components/DedupPanel';
import ScreeningPanel  from './components/ScreeningPanel';
import ExtractionPanel from './components/ExtractionPanel';
import PDFDownloader   from './components/PDFDownloader';
import ChangeLog       from './components/ChangeLog';

const VIEWS = {
  searches:   'searches',
  dedup:      'dedup',
  screening:  'screening',
  pdfs:       'pdfs',
  extraction: 'extraction',
  changelog:  'changelog',
};

function App() {
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [healthStatus,   setHealthStatus]   = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [activeView,     setActiveView]     = useState(VIEWS.searches);

  // ── Búsqueda activa compartida entre todas las vistas ────────────────────────
  const [selectedSearch, setSelectedSearch] = useState(null); // {id, name}

  // ── Health check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/health')
      .then(r  => setHealthStatus({ ok: true,  data: r.data }))
      .catch(e => setHealthStatus({ ok: false, error: e.message }))
      .finally(()  => setLoading(false));
  }, []);

  const navItems = [
    { id: VIEWS.searches,   label: 'Búsquedas',              icon: Search   },
    { id: VIEWS.dedup,      label: 'Análisis de Duplicados', icon: Copy     },
    { id: VIEWS.screening,  label: 'Screening',              icon: Filter   },
    { id: VIEWS.pdfs,       label: 'Descarga de PDF',        icon: Download },
    { id: VIEWS.extraction, label: 'Extracción de datos',    icon: Database },
    { id: VIEWS.changelog,  label: 'Historial de cambios',   icon: Clock    },
  ];

  return (
    <div className="flex h-screen bg-gray-100">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div className={`${sidebarOpen ? 'w-56' : 'w-16'} bg-gray-900 text-white transition-all duration-300 flex flex-col shrink-0`}>

        {/* Logo */}
        <div className="p-4 border-b border-gray-700 flex items-center gap-3">
          <FileText size={28} className="text-blue-400 shrink-0" />
          {sidebarOpen && <span className="font-bold text-base">SLR Manager</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map(item => {
            const Icon     = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                title={!sidebarOpen ? item.label : undefined}
                className={`w-full p-2.5 rounded-lg flex items-center gap-3 text-left transition-colors
                  ${isActive
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-800 text-gray-300'
                  }`}
              >
                <Icon size={18} className="shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Búsqueda activa (badge en sidebar) */}
        {selectedSearch && sidebarOpen && (
          <div className="mx-3 mb-3 px-3 py-2 bg-gray-800 rounded-lg">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-0.5">Búsqueda activa</p>
            <p className="text-xs text-blue-300 font-medium truncate" title={selectedSearch.name}>
              {selectedSearch.name}
            </p>
          </div>
        )}

        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 hover:bg-gray-800 w-full flex justify-center border-t border-gray-700"
        >
          <Menu size={18} />
        </button>
      </div>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Topbar */}
        <nav className="bg-white shadow-sm px-6 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-800">SLR-Manager</h1>
            {selectedSearch && (
              <span className="text-xs bg-blue-50 border border-blue-200 text-blue-600 px-2.5 py-0.5 rounded-full font-medium">
                {selectedSearch.name}
              </span>
            )}
          </div>
          <div>
            {loading ? (
              <span className="text-gray-400 text-sm">Verificando conexión…</span>
            ) : healthStatus?.ok ? (
              <span className="text-green-600 text-sm font-semibold">✓ Conectado</span>
            ) : (
              <span className="text-red-600 text-sm font-semibold">✗ Sin conexión</span>
            )}
          </div>
        </nav>

        {/* Content */}
        <main className={`flex-1 ${activeView === VIEWS.extraction ? 'overflow-hidden flex flex-col' : 'overflow-auto'}`}>

          {activeView === VIEWS.searches && (
            <div className="p-6">
              <SearchManager
                selectedSearch={selectedSearch}
                onSearchChange={setSelectedSearch}
              />
            </div>
          )}

          {activeView === VIEWS.dedup && (
            <div className="p-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <DedupPanel
                  selectedSearch={selectedSearch}
                  onSearchChange={setSelectedSearch}
                />
              </div>
            </div>
          )}

          {activeView === VIEWS.screening && (
            <div className="p-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <ScreeningPanel
                  selectedSearch={selectedSearch}
                  onSearchChange={setSelectedSearch}
                />
              </div>
            </div>
          )}

          {activeView === VIEWS.pdfs && (
            <div className="p-6">
              <PDFDownloader
                selectedSearch={selectedSearch}
                onSearchChange={setSelectedSearch}
              />
            </div>
          )}

          {activeView === VIEWS.extraction && (
            <ExtractionPanel
              selectedSearch={selectedSearch}
              onSearchChange={setSelectedSearch}
            />
          )}

          {activeView === VIEWS.changelog && (
            <div className="p-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <ChangeLog />
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default App;
