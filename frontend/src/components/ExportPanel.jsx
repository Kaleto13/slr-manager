/**
 * ExportPanel.jsx
 * Panel de exportación de una búsqueda:
 *   - CSV (con campos de extracción personalizados, delimitador |)
 *   - BibTeX (.bib)
 *   - RIS (.ris)
 */

import { useState } from 'react';
import { Download, FileText, Table, BookOpen } from 'lucide-react';

function ExportButton({ label, description, icon: Icon, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`
        flex items-start gap-3 w-full p-4 rounded-lg border-2 text-left
        transition-all duration-150 hover:shadow-md
        ${loading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        ${color}
      `}
    >
      <div className="mt-0.5 shrink-0">
        {loading
          ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          : <Icon size={20} />
        }
      </div>
      <div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs opacity-70 mt-0.5">{description}</p>
      </div>
      {!loading && <Download size={14} className="ml-auto mt-1 opacity-50 shrink-0" />}
    </button>
  );
}

export default function ExportPanel({ searchId, searchName }) {
  const [loadingFormat, setLoadingFormat] = useState(null);
  const [error, setError] = useState(null);

  const triggerDownload = async (format) => {
    if (!searchId) return;
    setLoadingFormat(format);
    setError(null);
    try {
      const url = `/api/stats/${searchId}/export/${format}`;
      const response = await fetch(url);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Error ${response.status}`);
      }
      const blob = await response.blob();
      const ext = { csv: 'csv', bibtex: 'bib', ris: 'ris' }[format];
      const filename = `slr_${searchId}_${new Date().toISOString().slice(0,10)}.${ext}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFormat(null);
    }
  };

  if (!searchId) return (
    <div className="text-center text-gray-400 py-10 text-sm">
      Selecciona una búsqueda para exportar
    </div>
  );

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Exportar todas las referencias de <strong>{searchName}</strong> incluyendo
        metadatos, decisiones de cribado y campos de extracción.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ExportButton
          label="CSV"
          description="Todos los campos + extracción personalizada. Delimitador: |"
          icon={Table}
          color="border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-400 hover:bg-blue-100"
          onClick={() => triggerDownload('csv')}
          loading={loadingFormat === 'csv'}
        />
        <ExportButton
          label="BibTeX"
          description="Formato .bib para gestores bibliográficos (Zotero, Mendeley, LaTeX)"
          icon={BookOpen}
          color="border-green-200 bg-green-50 text-green-800 hover:border-green-400 hover:bg-green-100"
          onClick={() => triggerDownload('bibtex')}
          loading={loadingFormat === 'bibtex'}
        />
        <ExportButton
          label="RIS"
          description="Formato .ris estándar (compatible con EndNote, RefWorks, Zotero)"
          icon={FileText}
          color="border-purple-200 bg-purple-50 text-purple-800 hover:border-purple-400 hover:bg-purple-100"
          onClick={() => triggerDownload('ris')}
          loading={loadingFormat === 'ris'}
        />
      </div>

      {error && (
        <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <p>• El CSV incluye todos los campos de extracción personalizados definidos para esta búsqueda.</p>
        <p>• Los archivos BibTeX y RIS pueden importarse directamente en Zotero, Mendeley o EndNote.</p>
        <p>• Los exportadores incluyen todas las referencias (no solo las incluidas en cribado).</p>
      </div>
    </div>
  );
}
