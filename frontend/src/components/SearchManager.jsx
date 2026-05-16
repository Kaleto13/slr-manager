import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Upload, Plus, Search, BookOpen, Calendar, Database,
  Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Layers, Trash2, Eye, X
} from 'lucide-react';
import ReferenceTable from './ReferenceTable';

const DB_SOURCES = ['Scopus', 'WoS', 'PubMed', 'IEEE', 'ACM', 'Manual', 'Otra'];

// ── Formulario: Crear búsqueda ─────────────────────────────────

function CreateSearchForm({ onCreated }) {
  const [form, setForm] = useState({
    name: '',
    search_date: new Date().toISOString().split('T')[0],
    boolean_string: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/searches', form);
      setForm({ name: '', search_date: new Date().toISOString().split('T')[0], boolean_string: '', notes: '' });
      onCreated(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al crear la búsqueda');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Ej: SLR_MachineLearning_2024"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de búsqueda</label>
          <input
            type="date"
            value={form.search_date}
            onChange={e => setForm({ ...form, search_date: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">String booleano</label>
        <textarea
          value={form.boolean_string}
          onChange={e => setForm({ ...form, boolean_string: e.target.value })}
          placeholder={'("machine learning" OR "deep learning") AND ("systematic review")'}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
        <textarea
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder="Observaciones sobre esta búsqueda..."
          rows={2}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-md">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        Crear búsqueda
      </button>
    </form>
  );
}

// ── Uploader de .bib ───────────────────────────────────────────

function BibUploader({ searches, onImported }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedSearchId, setSelectedSearchId] = useState('');
  const [source, setSource] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  // Pre-cargar fuente desde la búsqueda seleccionada
  const handleSearchChange = (id) => {
    setSelectedSearchId(id);
    if (id) {
      const s = searches.find(s => s.id === parseInt(id));
      if (s?.database_source) setSource(s.database_source);
    } else {
      setSource('');
    }
    setResult(null);
  };

  // Solo guarda el archivo, no importa todavía
  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.bib')) {
      setResult({ error: 'Solo se aceptan archivos .bib' });
      return;
    }
    setSelectedFile(file);
    setResult(null);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Validación antes de importar
  const missingSearch = !selectedSearchId;
  const missingSource = !source;
  const canImport = selectedFile && !missingSearch && !missingSource;

  // Importar al hacer clic en el botón
  const handleImport = async () => {
    if (!canImport) return;
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('search_id', selectedSearchId);
    formData.append('source', source);

    try {
      const res = await axios.post('/api/imports/bib', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onImported();
    } catch (err) {
      setResult({ error: err.response?.data?.detail || 'Error al importar el archivo' });
    } finally {
      setLoading(false);
    }
  };

  const selectedSearch = searches.find(s => s.id === parseInt(selectedSearchId));

  return (
    <div className="space-y-5">

      {/* Paso 1: Zona de selección de archivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Archivo .bib
        </label>
        {selectedFile ? (
          /* Archivo seleccionado — mostrar nombre y opción de cambiar */
          <div className="flex items-center gap-3 border border-blue-300 bg-blue-50 rounded-lg px-4 py-3">
            <Upload size={18} className="text-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-800 truncate">{selectedFile.name}</p>
              <p className="text-xs text-blue-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={handleRemoveFile}
              className="text-xs text-blue-600 hover:text-red-600 underline shrink-0"
            >
              Cambiar
            </button>
          </div>
        ) : (
          /* Zona drag & drop */
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
          >
            <div className="flex flex-col items-center gap-2 text-gray-500">
              <Upload size={32} />
              <span className="text-sm font-medium">Arrastra tu .bib aquí o haz click para seleccionar</span>
              <span className="text-xs text-gray-400">Soporta exportaciones de WoS, Scopus, PubMed, IEEE, ACM</span>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".bib" className="hidden"
          onChange={e => handleFileSelect(e.target.files[0])} />
      </div>

      {/* Paso 2: Búsqueda y fuente — siempre visibles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Búsqueda a vincular <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedSearchId}
            onChange={e => handleSearchChange(e.target.value)}
            className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              selectedFile && missingSearch ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          >
            <option value="">— Selecciona una búsqueda —</option>
            {searches.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {searches.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No hay búsquedas creadas. Crea una primero en "Nueva búsqueda".</p>
          )}
          {selectedFile && missingSearch && (
            <p className="text-xs text-red-500 mt-1">Debes seleccionar una búsqueda antes de importar.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fuente del .bib <span className="text-red-500">*</span>
          </label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              selectedFile && missingSource ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          >
            <option value="">— Base de datos de origen —</option>
            {DB_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {selectedFile && missingSource && (
            <p className="text-xs text-red-500 mt-1">Indica de qué base de datos proviene este archivo.</p>
          )}
        </div>
      </div>

      {/* Banner informativo cuando todo está listo */}
      {selectedSearchId && source && (
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 px-3 py-2 rounded-md">
          <Layers size={15} />
          Las referencias se vincularán a <strong>{selectedSearch?.name}</strong> como fuente <strong>{source}</strong>.
          {selectedSearch?.sources_breakdown?.[source] > 0 && (
            <span className="text-amber-600 ml-1">
              · Ya hay {selectedSearch.sources_breakdown[source]} refs de {source} vinculadas — se vincularán las que falten.
            </span>
          )}
        </div>
      )}

      {/* Botón principal */}
      {selectedFile && (
        <button
          onClick={handleImport}
          disabled={!canImport || loading}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium transition-colors ${
            canImport && !loading
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Procesando...</>
            : <><Upload size={16} /> Importar y vincular</>
          }
        </button>
      )}

      {/* Resultado */}
      {result && (
        result.error ? (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 p-3 rounded-md">
            <AlertCircle size={16} /> {result.error}
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle size={18} /> Importación completada
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="text-center p-2 bg-white rounded border border-gray-200">
                <div className="text-xl font-bold text-gray-600">{result.total_parsed}</div>
                <div className="text-gray-500 text-xs">entradas en .bib</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-xl font-bold text-green-600">{result.imported}</div>
                <div className="text-gray-500 text-xs">referencias creadas</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-blue-200">
                <div className="text-xl font-bold text-blue-600">{result.linked_to_search}</div>
                <div className="text-gray-500 text-xs">vinculadas a búsqueda</div>
              </div>
            </div>
            {result.search_name && (
              <p className="text-xs text-green-700">
                ✓ Vinculadas a <strong>{result.search_name}</strong>
                {result.source && <> · fuente: <strong>{result.source}</strong></>}
              </p>
            )}
            {result.errors?.length > 0 && (
              <p className="text-xs text-red-600">Errores en {result.errors.length} entradas: {result.errors.slice(0,3).map(e => e.title).join(', ')}{result.errors.length > 3 ? '…' : ''}</p>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ── Tarjeta de búsqueda con desglose de fuentes ────────────────

function SearchCard({ s, onDelete, searches = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const hasSources = s.sources_breakdown && Object.keys(s.sources_breakdown).length > 0;

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      await axios.delete(`/api/searches/${s.id}`);
      onDelete(s.id);
    } catch (err) {
      console.error('Error al eliminar:', err);
      setDeleting(false);
      setConfirming(false);
    }
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
        onClick={() => { if (!confirming) setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
            {s.id}
          </div>
          <div>
            <div className="font-medium text-gray-800 text-sm">{s.name}</div>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
              <span className="flex items-center gap-1"><Database size={10} /> {s.database_source || '—'}</span>
              <span className="flex items-center gap-1"><Calendar size={10} /> {s.search_date || '—'}</span>
              <span className="flex items-center gap-1"><BookOpen size={10} /> {s.reference_count} refs</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Píldoras de fuente */}
          {hasSources && !confirming && (
            <div className="hidden sm:flex gap-1">
              {Object.entries(s.sources_breakdown).map(([src, count]) => (
                <span key={src} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full border border-indigo-200">
                  {src}: {count}
                </span>
              ))}
            </div>
          )}

          {/* Botón eliminar / confirmación */}
          {confirming ? (
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <span className="text-xs text-red-600 font-medium">¿Eliminar?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
              <button
                onClick={handleCancelDelete}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-300 hover:border-gray-400"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              title="Eliminar búsqueda"
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            >
              <Trash2 size={15} />
            </button>
          )}

          {!confirming && (
            expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
          {/* Fuentes detalladas */}
          {hasSources && (
            <div>
              <span className="text-xs font-medium text-gray-500">Fuentes importadas:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(s.sources_breakdown).map(([src, count]) => (
                  <div key={src} className="flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs">
                    <Layers size={11} className="text-indigo-500" />
                    <span className="font-medium text-gray-700">{src}</span>
                    <span className="text-gray-400">({count} refs)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {s.boolean_string && (
            <div>
              <span className="text-xs font-medium text-gray-500">String booleano:</span>
              <p className="text-xs font-mono text-gray-700 mt-1 bg-white p-2 rounded border border-gray-200 break-all">{s.boolean_string}</p>
            </div>
          )}
          {s.notes && (
            <div>
              <span className="text-xs font-medium text-gray-500">Notas:</span>
              <p className="text-xs text-gray-700 mt-1">{s.notes}</p>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-gray-400">
              {s.term_count} términos extraídos · Creada {s.created_at ? new Date(s.created_at).toLocaleDateString('es-CL') : '—'}
            </div>
            <button
              onClick={() => setShowReferences(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded"
            >
              <Eye size={14} /> Ver referencias ({s.reference_count})
            </button>
          </div>
        </div>
      )}

      {/* Modal de referencias */}
      {showReferences && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between sticky top-0 bg-white px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">Referencias: {s.name}</h3>
              <button
                onClick={() => setShowReferences(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4">
              <ReferenceTable searchId={s.id} searches={searches} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lista de búsquedas ─────────────────────────────────────────

function SearchList({ searches, loading, onDelete }) {
  if (loading) return (
    <div className="flex items-center justify-center py-8 text-gray-400">
      <Loader2 size={24} className="animate-spin mr-2" /> Cargando búsquedas...
    </div>
  );
  if (!searches.length) return (
    <div className="text-center py-8 text-gray-400">
      <Search size={32} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm">No hay búsquedas registradas aún.</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {searches.map(s => <SearchCard key={s.id} s={s} onDelete={onDelete} searches={searches} />)}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────

export default function SearchManager({ selectedSearch, onSearchChange }) {
  const [searches, setSearches] = useState([]);
  const [loadingSearches, setLoadingSearches] = useState(true);
  const [activeTab, setActiveTab] = useState('searches');
  const [notification, setNotification] = useState(null);

  const loadSearches = async () => {
    setLoadingSearches(true);
    try {
      const res = await axios.get('/api/searches');
      setSearches(res.data);
      return res.data;
    } catch (err) {
      console.error('Error cargando búsquedas:', err);
      return [];
    } finally {
      setLoadingSearches(false);
    }
  };

  useEffect(() => { loadSearches(); }, []);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleSearchCreated = async (data) => {
    await loadSearches();   // primero recarga la lista con la nueva búsqueda
    const n = data.terms_extracted?.length ?? 0;
    showNotification(`Búsqueda "${data.name}" creada${n > 0 ? ` con ${n} términos` : ''}`);
    setActiveTab('searches');  // luego cambia al tab ya con los datos listos
  };

  const handleImported = () => {
    loadSearches();
  };

  const handleDeleteSearch = (id) => {
    setSearches(prev => prev.filter(s => s.id !== id));
    showNotification('Búsqueda eliminada', 'success');
  };

  const tabs = [
    { id: 'searches', label: 'Búsquedas', icon: Search },
    { id: 'create',   label: 'Nueva búsqueda', icon: Plus },
    { id: 'import',   label: 'Importar .bib', icon: Upload },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Gestor de búsquedas</h2>
        <p className="text-sm text-gray-500 mt-1">
          Registra búsquedas e importa .bib desde múltiples fuentes (WoS, Scopus, PubMed…)
        </p>
      </div>

      {notification && (
        <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
          notification.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <CheckCircle size={16} /> {notification.msg}
        </div>
      )}

      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={15} />
                {tab.label}
                {tab.id === 'searches' && searches.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5 rounded-full">
                    {searches.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {activeTab === 'searches' && (
          <SearchList searches={searches} loading={loadingSearches} onDelete={handleDeleteSearch} />
        )}
        {activeTab === 'create' && (
          <CreateSearchForm onCreated={handleSearchCreated} />
        )}
        {activeTab === 'import' && (
          <BibUploader searches={searches} onImported={handleImported} />
        )}
      </div>
    </div>
  );
}
