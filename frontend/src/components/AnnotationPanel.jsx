/**
 * AnnotationPanel.jsx
 *
 * Panel lateral del visor PDF. Muestra las anotaciones de una referencia,
 * permite filtrar por tag, editar comentarios y borrar anotaciones.
 * Se sincroniza con PDFViewer via la prop `refresh`.
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  MessageSquare, Trash2, Edit2, Check, X,
  Tag, FileText, ChevronDown, ChevronUp, Loader,
} from 'lucide-react';

// ── Colores por tag ───────────────────────────────────────────────────────────
const TAG_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-red-100 text-red-700 border-red-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
];
const tagColor = (tag) => {
  if (!tag) return 'bg-gray-100 text-gray-500 border-gray-200';
  let hash = 0;
  for (const c of tag) hash = (hash * 31 + c.charCodeAt(0)) % TAG_COLORS.length;
  return TAG_COLORS[Math.abs(hash)];
};

// ── Fila de anotación ─────────────────────────────────────────────────────────
function AnnotationRow({ ann, currentPage, onGoToPage, onDelete, onUpdate }) {
  const [editing,     setEditing]  = useState(false);
  const [editComment, setEditComment] = useState(ann.comment);
  const [editTag,     setEditTag]  = useState(ann.tag || '');
  const [saving,      setSaving]   = useState(false);
  const [expanded,    setExpanded] = useState(false);

  const isCurrentPage = ann.page === currentPage;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await axios.put(`/api/annotations/${ann.id}`, {
        comment: editComment.trim(),
        tag:     editTag.trim() || null,
      });
      onUpdate(updated.data);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border rounded-lg mb-2 text-sm transition-colors ${
      isCurrentPage ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Header de la anotación */}
      <div className="flex items-start justify-between gap-2 p-2.5">
        <div className="flex-1 min-w-0">
          {/* Página + tag */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {ann.page != null && (
              <button
                onClick={() => onGoToPage(ann.page)}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Pág. {ann.page}
              </button>
            )}
            {ann.tag && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${tagColor(ann.tag)}`}>
                {ann.tag}
              </span>
            )}
          </div>

          {/* Texto seleccionado (si existe) */}
          {ann.text && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-full text-left"
            >
              <p className={`text-xs text-gray-500 italic mb-1 ${expanded ? '' : 'line-clamp-2'}`}>
                "{ann.text}"
              </p>
            </button>
          )}

          {/* Comentario */}
          {editing ? (
            <div className="space-y-1.5 mt-1">
              <textarea
                autoFocus
                value={editComment}
                onChange={e => setEditComment(e.target.value)}
                rows={3}
                className="w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                type="text"
                value={editTag}
                onChange={e => setEditTag(e.target.value)}
                placeholder="Etiqueta..."
                className="w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
                  Guardar
                </button>
                <button
                  onClick={() => { setEditing(false); setEditComment(ann.comment); setEditTag(ann.tag || ''); }}
                  className="flex items-center gap-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                >
                  <X size={11} /> Cancelar
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{ann.comment}</p>
          )}
        </div>

        {/* Acciones */}
        {!editing && (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="p-1 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50"
              title="Editar"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={() => onDelete(ann.id)}
              className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
              title="Borrar"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────
export default function AnnotationPanel({ referenceId, currentPage, refresh, onGoToPage }) {
  const [annotations, setAnnotations] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filterTag,   setFilterTag]   = useState('');
  const [allTags,     setAllTags]     = useState([]);

  // Cargar anotaciones
  useEffect(() => {
    if (!referenceId) return;
    setLoading(true);
    axios.get(`/api/annotations/${referenceId}`)
      .then(r => {
        setAnnotations(r.data);
        const tags = [...new Set(r.data.map(a => a.tag).filter(Boolean))];
        setAllTags(tags);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [referenceId, refresh]);

  const handleDelete = async (id) => {
    await axios.delete(`/api/annotations/${id}`);
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const handleUpdate = (updated) => {
    setAnnotations(prev => prev.map(a => a.id === updated.id ? updated : a));
  };

  const filtered = filterTag
    ? annotations.filter(a => a.tag === filterTag)
    : annotations;

  // Anotaciones de la página actual vs resto
  const onCurrentPage = filtered.filter(a => a.page === currentPage);
  const onOtherPages  = filtered.filter(a => a.page !== currentPage);

  return (
    <div className="w-72 bg-gray-50 border-l flex flex-col overflow-hidden shrink-0">
      {/* Cabecera */}
      <div className="p-3 border-b bg-white">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
            <MessageSquare size={15} className="text-blue-500" />
            Anotaciones
            {annotations.length > 0 && (
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">
                {annotations.length}
              </span>
            )}
          </h3>
        </div>

        {/* Filtro por tag */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterTag('')}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${!filterTag ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'}`}
            >
              Todas
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? '' : tag)}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${filterTag === tag ? tagColor(tag) + ' font-medium' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader size={20} className="animate-spin mr-2" /> Cargando...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">
              {annotations.length === 0
                ? 'Sin anotaciones aún.\nSelecciona texto en el PDF para crear una.'
                : 'Sin anotaciones con este filtro.'
              }
            </p>
          </div>
        )}

        {/* Página actual primero */}
        {onCurrentPage.length > 0 && (
          <>
            <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide mb-2">
              📍 Página {currentPage}
            </p>
            {onCurrentPage.map(ann => (
              <AnnotationRow
                key={ann.id}
                ann={ann}
                currentPage={currentPage}
                onGoToPage={onGoToPage}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))}
            {onOtherPages.length > 0 && (
              <div className="border-t my-3" />
            )}
          </>
        )}

        {/* Otras páginas */}
        {onOtherPages.map(ann => (
          <AnnotationRow
            key={ann.id}
            ann={ann}
            currentPage={currentPage}
            onGoToPage={onGoToPage}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
          />
        ))}
      </div>

      {/* Pie */}
      <div className="p-2.5 border-t bg-white">
        <p className="text-[11px] text-gray-400 text-center">
          💡 Selecciona texto en el PDF para anotar
        </p>
      </div>
    </div>
  );
}
