import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  FileText, Download, Trash2, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, CheckCircle, Globe
} from 'lucide-react';

export default function ReferenceTable({ searchId, searches = [] }) {
  const [selectedSearchId, setSelectedSearchId] = useState(searchId || '');
  const [references, setReferences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [uploadingRef, setUploadingRef] = useState(null);
  const [oaLoading, setOaLoading] = useState(false);
  const [oaResult, setOaResult] = useState(null);
  const [batchLimit, setBatchLimit] = useState(100);

  const pageCount = Math.ceil(total / limit);

  useEffect(() => {
    if (selectedSearchId) loadReferences();
  }, [selectedSearchId, page, limit]);

  const loadReferences = async () => {
    if (!selectedSearchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/references', {
        params: {
          search_id: selectedSearchId,
          skip: page * limit,
          limit,
        },
      });
      setReferences(res.data.references);
      setTotal(res.data.total);
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al cargar referencias');
      setReferences([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadPDF = async (refId, file) => {
    setUploadingRef(refId);
    const formData = new FormData();
    formData.append('file', file);
    try {
      await axios.post(`/api/pdfs/${refId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      loadReferences();
    } catch (err) {
      alert(`Error: ${err.response?.data?.detail || 'Error al subir PDF'}`);
    } finally {
      setUploadingRef(null);
    }
  };

  const handleDeletePDF = async (refId) => {
    if (!confirm('¿Eliminar PDF?')) return;
    try {
      await axios.delete(`/api/pdfs/${refId}`);
      loadReferences();
    } catch (err) {
      alert(`Error: ${err.response?.data?.detail || 'Error al eliminar PDF'}`);
    }
  };

  const handleDownloadPDF = (refId, title) => {
    window.open(`/api/pdfs/${refId}/download`, '_blank');
  };

  const handleDownloadOA = async () => {
    if (!selectedSearchId) return;
    setOaLoading(true);
    setOaResult(null);
    try {
      const res = await axios.post('/api/references/download-oa', null, {
        params: { search_id: selectedSearchId, batch_limit: batchLimit },
        timeout: 600000, // 10 min — puede tomar tiempo con muchas refs
      });
      setOaResult(res.data);
      loadReferences(); // Recargar tabla para ver los nuevos PDFs
    } catch (err) {
      setOaResult({ error: err.response?.data?.detail || 'Error durante la descarga OA' });
    } finally {
      setOaLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Selector de búsqueda */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Búsqueda
        </label>
        <select
          value={selectedSearchId}
          onChange={(e) => {
            setSelectedSearchId(e.target.value);
            setPage(0);
          }}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— Selecciona una búsqueda —</option>
          {searches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.reference_count} refs)
            </option>
          ))}
        </select>
      </div>

      {!selectedSearchId && (
        <div className="text-center py-8 text-gray-400">
          <FileText size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Selecciona una búsqueda para ver sus referencias.</p>
        </div>
      )}

      {selectedSearchId && (
        <>
          {/* Panel descarga OA */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
            <Globe size={16} className="text-indigo-600 shrink-0" />
            <span className="text-sm text-indigo-700 font-medium">Descarga automática Open Access</span>
            <span className="text-xs text-indigo-500">vía Unpaywall</span>
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-indigo-600">Verificar:</label>
              <select
                value={batchLimit}
                onChange={e => setBatchLimit(parseInt(e.target.value))}
                disabled={oaLoading}
                className="border border-indigo-300 rounded px-2 py-1 text-xs text-indigo-700 bg-white"
              >
                <option value={50}>50 refs</option>
                <option value={100}>100 refs</option>
                <option value={200}>200 refs</option>
                <option value={500}>500 refs</option>
              </select>
              <button
                onClick={handleDownloadOA}
                disabled={oaLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  oaLoading
                    ? 'bg-indigo-200 text-indigo-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {oaLoading
                  ? <><Loader2 size={13} className="animate-spin" /> Procesando…</>
                  : <><Download size={13} /> Descargar disponibles</>
                }
              </button>
            </div>
          </div>

          {/* Mensaje de progreso durante descarga */}
          {oaLoading && (
            <div className="flex items-center gap-2 text-sm text-indigo-700 bg-indigo-50 px-3 py-2 rounded border border-indigo-200">
              <Loader2 size={15} className="animate-spin shrink-0" />
              Consultando Unpaywall y descargando PDFs disponibles… Esto puede tomar varios minutos dependiendo del lote.
            </div>
          )}

          {/* Resultado descarga OA */}
          {oaResult && !oaLoading && (
            oaResult.error ? (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded border border-red-200">
                <AlertCircle size={16} /> {oaResult.error}
              </div>
            ) : (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-indigo-700 font-medium text-sm">
                  <CheckCircle size={16} /> Descarga OA completada — {oaResult.search_name}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                  {[
                    { label: 'Verificadas', value: oaResult.checked, color: 'text-gray-700' },
                    { label: 'Con OA', value: oaResult.oa_found, color: 'text-indigo-600' },
                    { label: 'Descargadas', value: oaResult.downloaded, color: 'text-green-600' },
                    { label: 'Sin OA', value: oaResult.not_available, color: 'text-gray-400' },
                    { label: 'Sin DOI', value: oaResult.no_doi, color: 'text-amber-500' },
                    { label: 'Errores', value: oaResult.download_errors, color: 'text-red-500' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center bg-white rounded border border-indigo-100 p-2">
                      <div className={`text-lg font-bold ${color}`}>{value ?? '—'}</div>
                      <div className="text-gray-500">{label}</div>
                    </div>
                  ))}
                </div>
                {oaResult.landing_page_only > 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                    ℹ️ {oaResult.landing_page_only} artículo(s) sin enlace PDF directo (se intentó extraer desde la página del repositorio).
                  </p>
                )}
                {oaResult.batch_limit <= oaResult.checked && (
                  <p className="text-xs text-indigo-600">
                    ℹ️ Se procesaron {oaResult.batch_limit} refs. Ejecuta de nuevo para continuar con el resto.
                  </p>
                )}
              </div>
            )
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-md border border-red-200">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" /> Cargando referencias...
            </div>
          )}

          {!loading && references.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <FileText size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No hay referencias en esta búsqueda.</p>
            </div>
          )}

          {!loading && references.length > 0 && (
            <>
              {/* Tabla */}
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Título</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Autores</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-700 w-16">Año</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">DOI</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-700 w-20">PDF</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-700 w-24">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {references.map((ref, idx) => (
                      <tr key={ref.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-gray-800 font-medium max-w-xs truncate">
                          {ref.title || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                          {ref.authors ? ref.authors.split(';')[0] : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-center">
                          {ref.year || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                          {ref.doi ? (
                            <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-xs">
                              {ref.doi}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ref.pdf_file ? (
                            <CheckCircle size={18} className="mx-auto text-green-600" title="PDF subido" />
                          ) : (
                            <span className="text-xs text-gray-400">✗</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center space-x-2 flex justify-center">
                          {/* Subir/descargar PDF */}
                          {ref.pdf_file ? (
                            <>
                              <button
                                onClick={() => handleDownloadPDF(ref.id, ref.title)}
                                title="Descargar PDF"
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                              >
                                <Download size={16} />
                              </button>
                              <button
                                onClick={() => handleDeletePDF(ref.id)}
                                title="Eliminar PDF"
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <label className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer">
                              <FileText size={16} />
                              <input
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files[0]) {
                                    handleUploadPDF(ref.id, e.target.files[0]);
                                  }
                                }}
                                disabled={uploadingRef === ref.id}
                              />
                            </label>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              <div className="flex items-center justify-between text-sm text-gray-600">
                <div>
                  Mostrando {page * limit + 1} – {Math.min((page + 1) * limit, total)} de {total}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={limit}
                    onChange={(e) => {
                      setLimit(parseInt(e.target.value));
                      setPage(0);
                    }}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value={10}>10/página</option>
                    <option value={25}>25/página</option>
                    <option value={50}>50/página</option>
                  </select>
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="px-2 text-xs">Página {page + 1} de {pageCount || 1}</span>
                  <button
                    onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                    disabled={page >= pageCount - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
