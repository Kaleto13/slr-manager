import { useState, useRef } from 'react';
import axios from 'axios';
import { Upload, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';

export default function PDFUpload({ referenceId, onUpload, onClose }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();
  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

  const handleFileSelect = (f) => {
    if (!f || !f.name.endsWith('.pdf')) {
      setResult({ error: 'Solo se aceptan archivos PDF' });
      return;
    }
    if (f.size > MAX_SIZE) {
      setResult({ error: `Archivo demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB > 50 MB)` });
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`/api/pdfs/${referenceId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      if (onUpload) onUpload();
      setTimeout(() => {
        setFile(null);
        if (onClose) onClose();
      }, 2000);
    } catch (err) {
      setResult({ error: err.response?.data?.detail || 'Error al subir PDF' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Subir PDF</h3>
          {onClose && (
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {!result && (
            <>
              {!file ? (
                /* Zona de drag & drop */
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    handleFileSelect(e.dataTransfer.files[0]);
                  }}
                  onClick={() => fileRef.current.click()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}
                >
                  <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">Arrastra PDF aquí o haz click</p>
                  <p className="text-xs text-gray-400 mt-1">Máx 50 MB</p>
                </div>
              ) : (
                /* Archivo seleccionado */
                <div className="border border-blue-300 bg-blue-50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-800 truncate">{file.name}</p>
                    <p className="text-xs text-blue-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                    className="text-blue-600 hover:text-red-600 ml-2"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files[0])}
              />

              {/* Botón subir */}
              {file && (
                <button
                  onClick={handleUpload}
                  disabled={loading}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                    loading
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Subiendo...
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> Subir PDF
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {/* Resultado */}
          {result && (
            <div>
              {result.error ? (
                <div className="flex items-center gap-3 text-red-600 bg-red-50 p-3 rounded-md border border-red-200">
                  <AlertCircle size={18} className="shrink-0" />
                  <span className="text-sm">{result.error}</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-green-600 bg-green-50 p-3 rounded-md border border-green-200">
                  <CheckCircle size={18} className="shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">PDF subido correctamente</p>
                    <p className="text-xs text-green-500 mt-0.5">{result.filename} ({result.size_mb} MB)</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
