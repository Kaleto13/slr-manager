import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  Database, Plus, Trash2, Settings, Loader, AlertTriangle,
  Download, RefreshCw, ChevronDown, ChevronUp, ExternalLink,
  FileCheck, Hash, Type, ToggleLeft, BookOpen, Tag, Link,
  Users, Eye, List, Layers, X, Search,
} from 'lucide-react';
import PDFViewer from './PDFViewer';

// ── Tipos de campo ────────────────────────────────────────────────────────────
const FIELD_TYPE_ICON = {
  text:        Type,
  number:      Hash,
  boolean:     ToggleLeft,
  select:      List,
  multiselect: Layers,
};
const FIELD_TYPE_LABEL = {
  text:        'Texto',
  number:      'Número',
  boolean:     'Sí/No',
  select:      'Selector',
  multiselect: 'Multi-selector',
};

// ── Columnas del .bib disponibles como columnas opcionales ─────────────────────
const BIB_COLS = [
  { key: 'abstract', label: 'Abstract',       icon: BookOpen, minW: 280 },
  { key: 'keywords', label: 'Palabras clave',  icon: Tag,      minW: 160 },
  { key: 'authors',  label: 'Autores',         icon: Users,    minW: 160 },
  { key: 'journal',  label: 'Revista',         icon: BookOpen, minW: 130 },
  { key: 'url',      label: 'URL',             icon: Link,     minW: 130 },
];

// ── Celda solo lectura (.bib) ─────────────────────────────────────────────────
function BibCell({ value, colKey }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) return <span className="text-gray-300 text-xs px-1.5 py-1 block">—</span>;

  if (colKey === 'url') {
    return (
      <a href={value.startsWith('http') ? value : `https://${value}`}
        target="_blank" rel="noopener noreferrer"
        className="text-xs text-blue-500 hover:underline px-1.5 py-1 block truncate" title={value}>
        {value}
      </a>
    );
  }

  const isLong = value.length > 120;
  const display = isLong && !expanded ? value.slice(0, 120) + '…' : value;
  return (
    <div className="px-1.5 py-1 text-xs text-gray-600 leading-snug">
      {display}
      {isLong && (
        <button onClick={() => setExpanded(!expanded)}
          className="ml-1 text-[10px] text-blue-400 hover:text-blue-600 font-medium whitespace-nowrap">
          {expanded ? 'menos ▲' : 'más ▼'}
        </button>
      )}
    </div>
  );
}

// ── Celda editable: boolean ───────────────────────────────────────────────────
function BooleanCell({ value, onSave }) {
  const [val, setVal]     = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(false);

  useEffect(() => { setVal(value ?? ''); }, [value]);

  return (
    <select value={val}
      onChange={async e => {
        const v = e.target.value;
        setVal(v);
        setSaving(true);
        try {
          await onSave(v === '' ? null : v);
          setFlash(true); setTimeout(() => setFlash(false), 1200);
        } finally { setSaving(false); }
      }}
      className={`w-full text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 transition-colors ${
        flash       ? 'bg-green-50 border-green-300' :
        val === 'Sí'? 'bg-green-50 border-green-200 text-green-700' :
        val === 'No'? 'bg-red-50 border-red-200 text-red-700' :
                      'border-gray-200 text-gray-500'
      }`}
    >
      <option value="">—</option>
      <option value="Sí">Sí</option>
      <option value="No">No</option>
      <option value="N/A">N/A</option>
    </select>
  );
}

// ── Celda editable: select (una opción) ──────────────────────────────────────
function SelectCell({ value, options, onSave }) {
  const [val, setVal]       = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(false);

  useEffect(() => { setVal(value ?? ''); }, [value]);

  return (
    <select value={val}
      onChange={async e => {
        const v = e.target.value;
        setVal(v);
        setSaving(true);
        try {
          await onSave(v === '' ? null : v);
          setFlash(true); setTimeout(() => setFlash(false), 1200);
        } finally { setSaving(false); }
      }}
      className={`w-full text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 transition-colors ${
        flash ? 'bg-green-50 border-green-300' :
        val   ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'border-gray-200 text-gray-500'
      }`}
    >
      <option value="">—</option>
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}

// ── Celda editable: multiselect (varias opciones con chips) ───────────────────
function MultiSelectCell({ value, options, onSave }) {
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 170 });
  const containerRef          = useRef(null);
  const dropRef               = useRef(null);

  const toArr = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
  const [selected, setSelected] = useState(toArr(value));

  // Ref siempre actualizado — evita closures obsoletos en el listener del documento
  const selectedRef = useRef(selected);

  useEffect(() => {
    const s = toArr(value);
    setSelected(s);
    selectedRef.current = s;
  }, [value]);

  const toggle = opt =>
    setSelected(prev => {
      const next = prev.includes(opt) ? prev.filter(s => s !== opt) : [...prev, opt];
      selectedRef.current = next;   // sincroniza el ref inmediatamente
      return next;
    });

  const handleClose = async () => {
    setOpen(false);
    const newVal = selectedRef.current.length ? selectedRef.current.join(', ') : null;
    const oldVal = value || null;
    if (newVal === oldVal) return;
    setSaving(true);
    try { await onSave(newVal); } finally { setSaving(false); }
  };

  // Ref para handleClose: el useEffect nunca queda obsoleto aunque value cambie
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  const handleOpen = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropPos({
        top:   rect.bottom + 4,
        left:  rect.left,
        width: Math.max(180, rect.width),
      });
    }
    setOpen(v => !v);
  };

  // Cerrar al hacer clic fuera — solo depende de `open`, no re-monta en cada selección
  useEffect(() => {
    if (!open) return;
    const handler = e => {
      const inTrigger = containerRef.current?.contains(e.target);
      const inDrop    = dropRef.current?.contains(e.target);
      if (!inTrigger && !inDrop) handleCloseRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const chips = (
    <div className="flex flex-wrap gap-0.5">
      {selected.length > 0
        ? selected.map(tag => (
            <span key={tag} className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full leading-none">
              {tag}
            </span>
          ))
        : <span className="text-gray-300 text-xs select-none">—</span>
      }
    </div>
  );

  // Dropdown renderizado en <body> mediante portal para escapar overflow:hidden
  const dropdown = open && createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-2xl max-h-52 overflow-y-auto"
    >
      <div className="px-2 py-1.5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-[10px] font-semibold text-gray-500 uppercase">Seleccionar</span>
        <button
          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
          onClick={handleClose}
          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold">
          ✓ Listo
        </button>
      </div>
      {options.length === 0
        ? <p className="text-xs text-gray-400 p-3 italic">Sin opciones definidas</p>
        : options.map(opt => (
            <label key={opt}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs"
              onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggle(opt); }}
            >
              <input type="checkbox" checked={selected.includes(opt)}
                onChange={() => {}} className="shrink-0 accent-indigo-600" />
              <span className={selected.includes(opt) ? 'text-indigo-700 font-medium' : 'text-gray-700'}>
                {opt}
              </span>
            </label>
          ))
      }
    </div>,
    document.body
  );

  return (
    <div ref={containerRef}>
      <div onClick={handleOpen}
        className={`min-h-[28px] px-1.5 py-1 cursor-pointer rounded transition-colors ${
          open ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-blue-50'
        } ${saving ? 'opacity-50' : ''}`}
      >
        {saving ? <Loader size={10} className="animate-spin text-blue-400" /> : chips}
      </div>
      {dropdown}
    </div>
  );
}

// ── Celda editable: texto o número ────────────────────────────────────────────
function TextNumberCell({ value, fieldType, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(value ?? '');
  const [saving, setSaving]   = useState(false);
  const [flash, setFlash]     = useState(false);

  useEffect(() => { if (!editing) setVal(value ?? ''); }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    const newVal = val.trim();
    if (newVal === (value ?? '')) return;
    setSaving(true);
    try {
      await onSave(newVal === '' ? null : newVal);
      setFlash(true); setTimeout(() => setFlash(false), 1200);
    } catch { setVal(value ?? ''); }
    finally { setSaving(false); }
  };

  if (editing) {
    return (
      <input autoFocus type={fieldType === 'number' ? 'number' : 'text'}
        value={val} onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  e.target.blur();
          if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); }
        }}
        className="w-full text-xs border border-blue-400 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
      />
    );
  }
  return (
    <div onClick={() => setEditing(true)} title="Clic para editar"
      className={`min-h-[28px] min-w-[80px] px-1.5 py-1 text-xs cursor-pointer rounded transition-colors ${
        flash  ? 'bg-green-50' : saving ? 'opacity-50' : val ? 'hover:bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {saving
        ? <Loader size={10} className="animate-spin text-blue-400" />
        : val
          ? <span className="text-gray-800">{val}</span>
          : <span className="text-gray-300 select-none">—</span>
      }
    </div>
  );
}

// ── Router: elige el componente según fieldType ───────────────────────────────
function EditableCell({ value, fieldType, options = [], onSave }) {
  if (fieldType === 'boolean')     return <BooleanCell     value={value} onSave={onSave} />;
  if (fieldType === 'select')      return <SelectCell      value={value} options={options} onSave={onSave} />;
  if (fieldType === 'multiselect') return <MultiSelectCell value={value} options={options} onSave={onSave} />;
  return <TextNumberCell value={value} fieldType={fieldType} onSave={onSave} />;
}

// ── Gestor de campos personalizados ───────────────────────────────────────────
function FieldsManager({ searchId, fields, onReload }) {
  const [expanded, setExpanded]       = useState(true);
  const [newName, setNewName]         = useState('');
  const [newType, setNewType]         = useState('text');
  const [newOptions, setNewOptions]   = useState([]);   // para select/multiselect
  const [optionInput, setOptionInput] = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  // Resetear opciones al cambiar de tipo
  useEffect(() => { setNewOptions([]); setOptionInput(''); }, [newType]);

  const addOption = () => {
    const t = optionInput.trim();
    if (!t || newOptions.includes(t)) return;
    setNewOptions(prev => [...prev, t]);
    setOptionInput('');
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (['select', 'multiselect'].includes(newType) && newOptions.length === 0) {
      setError('Agrega al menos una opción para este tipo de campo');
      return;
    }
    setSaving(true); setError(null);
    try {
      await axios.post(`/api/extraction/${searchId}/fields`, {
        name:       newName.trim(),
        field_type: newType,
        options:    ['select', 'multiselect'].includes(newType) ? newOptions : undefined,
      });
      setNewName(''); setNewOptions([]); setOptionInput('');
      onReload();
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al crear campo');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este campo y todos sus valores?')) return;
    try { await axios.delete(`/api/extraction/fields/${id}`); onReload(); } catch {}
  };

  const needsOptions = ['select', 'multiselect'].includes(newType);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-700">
        <span className="flex items-center gap-2">
          <Settings size={14} />
          Campos de extracción personalizados ({fields.length})
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="p-4 space-y-3">
          {/* Campos existentes */}
          {fields.length === 0
            ? <p className="text-xs text-gray-400 italic">No hay campos. Agrega al menos uno.</p>
            : (
              <div className="flex flex-wrap gap-2">
                {fields.map(f => {
                  const Icon = FIELD_TYPE_ICON[f.field_type] || Type;
                  return (
                    <div key={f.id}
                      className="flex items-start gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs max-w-xs">
                      <Icon size={11} className="text-indigo-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-medium text-gray-700">{f.name}</span>
                        <span className="text-gray-400 ml-1 text-[10px]">({FIELD_TYPE_LABEL[f.field_type]})</span>
                        {/* Mostrar opciones si es select/multiselect */}
                        {f.options?.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {f.options.map(opt => (
                              <span key={opt}
                                className="bg-indigo-50 text-indigo-600 text-[10px] px-1 py-0.5 rounded">
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={() => handleDelete(f.id)} className="ml-1 text-gray-300 hover:text-red-500 shrink-0 mt-0.5">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          }

          {/* Nuevo campo */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Nuevo campo</p>

            <div className="flex gap-2">
              {/* Tipo */}
              <select value={newType} onChange={e => setNewType(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 shrink-0">
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="boolean">Sí/No</option>
                <option value="select">Selector</option>
                <option value="multiselect">Multi-selector</option>
              </select>

              {/* Nombre */}
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !needsOptions && handleAdd()}
                placeholder="Nombre del campo…"
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />

              {/* Botón agregar (solo si no necesita opciones o ya las tiene) */}
              {!needsOptions && (
                <button onClick={handleAdd} disabled={!newName.trim() || saving}
                  className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1.5 rounded shrink-0">
                  {saving ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
                  Agregar
                </button>
              )}
            </div>

            {/* Input de opciones (para select / multiselect) */}
            {needsOptions && (
              <div className="space-y-1.5 pl-1 border-l-2 border-indigo-200">
                <p className="text-[11px] font-semibold text-indigo-600">
                  Opciones / Tags del {FIELD_TYPE_LABEL[newType]}:
                </p>

                {/* Tags ya agregados */}
                <div className="flex flex-wrap gap-1 min-h-[28px]">
                  {newOptions.map((opt, i) => (
                    <span key={i}
                      className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-[11px] px-2 py-0.5 rounded-full">
                      {opt}
                      <button onClick={() => setNewOptions(prev => prev.filter((_, j) => j !== i))}
                        className="hover:text-red-500">
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  {newOptions.length === 0 && (
                    <span className="text-[11px] text-gray-400 italic">Ninguna opción aún…</span>
                  )}
                </div>

                {/* Agregar opción */}
                <div className="flex gap-1.5">
                  <input value={optionInput} onChange={e => setOptionInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault(); addOption();
                      }
                    }}
                    placeholder="Escribe una opción y presiona Enter…"
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button onClick={addOption} disabled={!optionInput.trim()}
                    className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2 py-1 rounded disabled:opacity-40">
                    + Tag
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">Enter o coma para agregar · Clic × para quitar</p>

                {/* Botón Agregar campo */}
                <button onClick={handleAdd}
                  disabled={!newName.trim() || newOptions.length === 0 || saving}
                  className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1.5 rounded mt-1">
                  {saving ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
                  Crear campo "{newName || '…'}" con {newOptions.length} opciones
                </button>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={11} /> {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ancho inicial de columnas fijas ──────────────────────────────────────────
const DEFAULT_COL_WIDTHS = {
  id:   44,
  ref:  240,
  year: 56,
  pdf:  48,
};

// ── Panel principal ───────────────────────────────────────────────────────────
export default function ExtractionPanel({ selectedSearch, onSearchChange }) {
  const [searches, setSearches]       = useState([]);
  // selectedId derivado del prop — sin copia local
  const selectedId = selectedSearch?.id ? String(selectedSearch.id) : '';
  const [fields, setFields]           = useState([]);
  const [criteria, setCriteria]       = useState([]);  // criterios de screening
  const [refs, setRefs]               = useState([]);
  const [phase, setPhase]             = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);

  const [visibleBibCols, setVisibleBibCols] = useState(new Set());
  const [expandedRows, setExpandedRows]     = useState(new Set());

  // Visor PDF lateral
  const [viewingRef, setViewingRef]         = useState(null);

  // Ancho del panel PDF redimensionable
  const [pdfPanelWidth, setPdfPanelWidth]   = useState(480);
  const pdfDragRef                          = useRef(false);
  const pdfDragStartX                       = useRef(0);
  const pdfDragStartW                       = useRef(0);

  // Anchos de columnas redimensionables
  const [colWidths, setColWidths]           = useState(DEFAULT_COL_WIDTHS);
  const colDragRef                          = useRef(null);

  // Ordenamiento y filtrado de la tabla
  const [sortState, setSortState] = useState({ col: null, dir: 'asc' });
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    axios.get('/api/searches').then(r => setSearches(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) { setFields([]); setRefs([]); setPhase(null); setExpandedRows(new Set()); return; }
    loadData();
  }, [selectedId]);

  // ── Resize del panel PDF (drag del divisor) ───────────────────────────────
  const startPdfResize = useCallback((e) => {
    e.preventDefault();
    pdfDragRef.current   = true;
    pdfDragStartX.current = e.clientX;
    pdfDragStartW.current = pdfPanelWidth;
    const onMove = (ev) => {
      if (!pdfDragRef.current) return;
      const delta = pdfDragStartX.current - ev.clientX;
      setPdfPanelWidth(Math.max(300, Math.min(900, pdfDragStartW.current + delta)));
    };
    const onUp = () => {
      pdfDragRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pdfPanelWidth]);

  // ── Resize de columnas de tabla (drag del borde derecho del <th>) ─────────
  const startColResize = useCallback((key, initialW, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const minW  = key === 'ref' ? 60 : key === 'id' ? 28 : 36;
      setColWidths(prev => ({
        ...prev,
        [key]: Math.max(minW, initialW + delta),
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const r = await axios.get(`/api/extraction/${selectedId}/refs`);
      setRefs(r.data.refs || []);
      setFields(r.data.fields || []);
      setCriteria(r.data.criteria || []);
      setPhase(r.data.phase);
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar datos de extracción');
    } finally { setLoading(false); }
  }, [selectedId]);

  const handleSaveValue = useCallback(async (refId, fieldId, value) => {
    await axios.post('/api/extraction/values', { reference_id: refId, field_id: fieldId, value });
    setRefs(prev => prev.map(r =>
      r.id === refId ? { ...r, values: { ...r.values, [fieldId]: value } } : r
    ));
  }, []);

  const toggleSort = useCallback((col) => {
    setSortState(prev =>
      prev.col === col
        ? prev.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' }
        : { col, dir: 'asc' }
    );
  }, []);

  // Refs filtradas y ordenadas para mostrar en la tabla
  const displayedRefs = useMemo(() => {
    let result = [...refs];
    // Filtrar
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      result = result.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.authors?.toLowerCase().includes(q) ||
        r.journal?.toLowerCase().includes(q) ||
        String(r.year ?? '').includes(q)
      );
    }
    // Ordenar
    if (sortState.col) {
      const dir = sortState.dir === 'asc' ? 1 : -1;
      const col = sortState.col;
      result = [...result].sort((a, b) => {
        if (col === 'id')   return dir * (a.id - b.id);
        if (col === 'year') return dir * ((a.year ?? 0) - (b.year ?? 0));
        if (col.startsWith('crit_')) {
          const cid = col.slice(5);
          return dir * ((a.criteria_applied?.[cid] ?? 0) - (b.criteria_applied?.[cid] ?? 0));
        }
        const va = col.startsWith('f_')
          ? (a.values[parseInt(col.slice(2))] ?? '')
          : (a[col === 'ref' ? 'title' : col] ?? '');
        const vb = col.startsWith('f_')
          ? (b.values[parseInt(col.slice(2))] ?? '')
          : (b[col === 'ref' ? 'title' : col] ?? '');
        return dir * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    return result;
  }, [refs, filterText, sortState]);

  // Indicador visual de columna ordenada
  const sortIcon = (col) => {
    if (sortState.col !== col)
      return <span className="text-gray-300 ml-0.5 text-[9px] leading-none select-none">⇅</span>;
    return sortState.dir === 'asc'
      ? <ChevronUp   size={9} className="text-indigo-500 ml-0.5 shrink-0" />
      : <ChevronDown size={9} className="text-indigo-500 ml-0.5 shrink-0" />;
  };

  const toggleBibCol = key => setVisibleBibCols(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleRow = id => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAllRows = () => {
    setExpandedRows(expandedRows.size === displayedRefs.length
      ? new Set()
      : new Set(displayedRefs.map(r => r.id)));
  };

  const completeness = (() => {
    if (!refs.length || !fields.length) return null;
    const total  = refs.length * fields.length;
    const filled = refs.reduce((acc, r) =>
      acc + fields.filter(f => r.values[f.id] != null && r.values[f.id] !== '').length, 0);
    return Math.round((filled / total) * 100);
  })();

  const activeBibCols = BIB_COLS.filter(c => visibleBibCols.has(c.key));
  // colspan: expand + ref + año + id + pdf + bibCols + customCols + criteria
  const totalCols = 2 + 1 + 1 + 1 + activeBibCols.length + fields.length + criteria.length;

  return (
    <div className="flex h-full overflow-hidden bg-gray-50">

      {/* ── Panel izquierdo: tabla ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-gray-50">
      <div className="flex-1 overflow-auto p-6 space-y-5 bg-gray-50">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Database size={20} className="text-indigo-600" />
            Extracción de datos
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Define campos personalizados y extrae información de cada artículo incluido.
          </p>
        </div>
        {viewingRef && (
          <button onClick={() => setViewingRef(null)}
            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg shrink-0">
            <X size={12} /> Cerrar PDF
          </button>
        )}
      </div>

      {/* Selector de búsqueda */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Búsqueda</label>
        <select value={selectedId}
          onChange={e => {
            const id  = e.target.value;
            const obj = searches.find(s => String(s.id) === id);
            setExpandedRows(new Set());
            if (onSearchChange) onSearchChange(obj ? { id: obj.id, name: obj.name } : null);
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">— Selecciona una búsqueda —</option>
          {searches.map(s => (
            <option key={s.id} value={s.id}>{s.name}  ({s.reference_count ?? '?'} refs)</option>
          ))}
        </select>
      </div>

      {!selectedId && (
        <div className="text-center py-16 text-gray-300">
          <Database size={48} className="mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Selecciona una búsqueda para comenzar</p>
        </div>
      )}

      {selectedId && (
        <>
          {/* Gestor de campos */}
          <FieldsManager searchId={selectedId} fields={fields} onReload={loadData} />

          {/* Toggle de columnas del .bib */}
          <div className="border border-sky-200 rounded-lg bg-sky-50/40 px-4 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 shrink-0">
              <Eye size={13} /> Columnas del .bib:
            </span>
            {BIB_COLS.map(col => {
              const Icon = col.icon;
              const active = visibleBibCols.has(col.key);
              return (
                <button key={col.key} onClick={() => toggleBibCol(col.key)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'border-sky-200 text-sky-600 hover:border-sky-400 bg-white'
                  }`}
                >
                  <Icon size={10} /> {col.label}
                </button>
              );
            })}
            <span className="text-xs text-sky-400 italic ml-1">Solo lectura · tomadas del .bib</span>
          </div>

          {/* Estados */}
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-indigo-600">
              <Loader size={22} className="animate-spin" />
              <span className="text-sm font-medium">Cargando referencias incluidas…</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {!loading && !error && refs.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <AlertTriangle size={32} className="text-amber-400 mx-auto mb-2" />
              <p className="text-amber-700 font-semibold mb-1">No hay referencias incluidas</p>
              <p className="text-amber-600 text-sm">
                Completa el Screening primero. Este paso requiere al menos una referencia con decisión "Incluido".
              </p>
            </div>
          )}

          {!loading && refs.length > 0 && (
            <>
              {/* Barra de progreso + filtro + exportar */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="shrink-0">
                    <span className="text-sm font-semibold text-gray-700">
                      {filterText
                        ? <>{displayedRefs.length} <span className="font-normal text-gray-400">de</span> {refs.length}</>
                        : refs.length
                      } artículo{refs.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">
                      (fase: {phase === 'full_text' ? 'Texto completo R2' : 'Título/Abstract R1'})
                    </span>
                  </div>
                  {/* Filtro */}
                  <div className="relative flex-1 min-w-[160px] max-w-xs">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                    <input
                      value={filterText}
                      onChange={e => setFilterText(e.target.value)}
                      placeholder="Filtrar por título, autores, año…"
                      className="w-full text-xs border border-gray-200 rounded-lg pl-7 pr-6 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                    />
                    {filterText && (
                      <button onClick={() => setFilterText('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <button onClick={loadData} className="text-gray-400 hover:text-indigo-500" title="Recargar">
                      <RefreshCw size={14} />
                    </button>
                    <button onClick={() => window.open(`/api/extraction/${selectedId}/export-csv`, '_blank')}
                      className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">
                      <Download size={13} /> Exportar CSV
                    </button>
                  </div>
                </div>
                {fields.length > 0 && completeness !== null && (
                  <>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Completitud (campos personalizados)</span>
                      <span className="font-semibold">{completeness}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${
                        completeness === 100 ? 'bg-green-500' : completeness >= 50 ? 'bg-indigo-500' : 'bg-amber-400'
                      }`} style={{ width: `${completeness}%` }} />
                    </div>
                  </>
                )}
              </div>

              {fields.length === 0 && activeBibCols.length === 0 ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 text-center">
                  <Settings size={28} className="text-blue-400 mx-auto mb-2" />
                  <p className="text-blue-700 font-semibold">Configura la tabla</p>
                  <p className="text-blue-600 text-sm mt-1">
                    Agrega campos de extracción personalizados y/o activa columnas del .bib.
                  </p>
                </div>
              ) : (

                /* ── Tabla ──────────────────────────────────────────────── */
                <div className="border border-gray-200 rounded-lg" style={{ overflow: 'clip' }}>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse"
                      style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {/* Expand toggle */}
                          <th className="sticky left-0 z-10 bg-gray-50 w-7 px-1 py-2.5 border-r border-gray-200">
                            <button onClick={toggleAllRows} title="Expandir/colapsar todo"
                              className="text-gray-400 hover:text-indigo-500 block mx-auto">
                              {expandedRows.size > 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </th>
                          {/* ID (sticky + resize + sort) */}
                          <th className="sticky z-10 bg-gray-50 px-1 py-2.5 text-center font-semibold text-gray-500 border-r border-gray-200 select-none cursor-pointer hover:bg-gray-100 relative"
                            style={{ left: 28, width: colWidths.id, minWidth: 28 }}
                            onClick={() => toggleSort('id')}
                            title="Ordenar por ID">
                            <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-bold tracking-wide">
                              ID {sortIcon('id')}
                            </span>
                            <div onMouseDown={e => startColResize('id', colWidths.id, e)}
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50" />
                          </th>
                          {/* Referencia (sticky + resize + sort) */}
                          <th className="sticky z-10 bg-gray-50 px-3 py-2.5 text-left font-semibold text-gray-600 border-r border-gray-200 relative select-none cursor-pointer hover:bg-gray-100"
                            style={{ left: 28 + colWidths.id, width: colWidths.ref, minWidth: 60 }}
                            onClick={() => toggleSort('ref')}
                            title="Ordenar por título">
                            <span className="inline-flex items-center gap-0.5">
                              Referencia {sortIcon('ref')}
                            </span>
                            <div onMouseDown={e => startColResize('ref', colWidths.ref, e)}
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50" />
                          </th>
                          {/* Año (resize + sort) */}
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-600 border-r border-gray-100 relative select-none cursor-pointer hover:bg-gray-100"
                            style={{ width: colWidths.year, minWidth: 42 }}
                            onClick={() => toggleSort('year')}
                            title="Ordenar por año">
                            <span className="inline-flex items-center gap-0.5">
                              Año {sortIcon('year')}
                            </span>
                            <div onMouseDown={e => startColResize('year', colWidths.year, e)}
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50" />
                          </th>
                          {/* PDF (resize) */}
                          <th className="px-2 py-2.5 text-center font-semibold text-gray-400 select-none border-r border-gray-100 relative"
                            style={{ width: colWidths.pdf, minWidth: 36 }}>
                            <span className="text-[10px] font-bold tracking-wide">PDF</span>
                            <div onMouseDown={e => startColResize('pdf', colWidths.pdf, e)}
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50" />
                          </th>
                          {/* Criterios (resize + sort) */}
                          {criteria.map(c => {
                            const w = colWidths[`crit_${c.id}`] ?? 64;
                            return (
                              <th key={`crit-${c.id}`}
                                className={`px-2 py-2.5 text-center font-semibold border-r relative select-none text-[10px] leading-tight cursor-pointer ${
                                  c.type === 'exclusion'
                                    ? 'text-red-600 border-red-100 bg-red-50/40 hover:bg-red-100/50'
                                    : 'text-green-700 border-green-100 bg-green-50/40 hover:bg-green-100/50'
                                }`}
                                style={{ width: w, minWidth: 40 }}
                                onClick={() => toggleSort(`crit_${c.id}`)}
                                title={`${c.type === 'exclusion' ? 'Excl.' : 'Incl.'}: ${c.label}`}>
                                <span className="flex items-center justify-center gap-0.5">
                                  <span className="truncate">{c.label}</span>
                                  {sortIcon(`crit_${c.id}`)}
                                </span>
                                <div onMouseDown={e => startColResize(`crit_${c.id}`, w, e)}
                                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-300/50" />
                              </th>
                            );
                          })}
                          {/* Columnas .bib (resize + sort) */}
                          {activeBibCols.map(col => {
                            const Icon = col.icon;
                            const w    = colWidths[col.key] ?? col.minW;
                            return (
                              <th key={col.key}
                                className="px-3 py-2.5 text-left font-semibold text-sky-700 border-r border-sky-100 bg-sky-50 relative select-none cursor-pointer hover:bg-sky-100/70"
                                style={{ width: w, minWidth: 80 }}
                                onClick={() => toggleSort(col.key)}
                                title={`Ordenar por ${col.label}`}>
                                <div className="flex items-center gap-1 pr-2">
                                  <Icon size={11} className="text-sky-400 shrink-0" />
                                  {col.label}
                                  <span className="text-[9px] text-sky-400 font-normal ml-0.5">.bib</span>
                                  {sortIcon(col.key)}
                                </div>
                                <div onMouseDown={e => startColResize(col.key, w, e)}
                                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-sky-300/50" />
                              </th>
                            );
                          })}
                          {/* Campos personalizados (resize + sort) */}
                          {fields.map(f => {
                            const Icon = FIELD_TYPE_ICON[f.field_type] || Type;
                            const defW = ['select','multiselect'].includes(f.field_type) ? 160 : 130;
                            const w    = colWidths[`f_${f.id}`] ?? defW;
                            return (
                              <th key={f.id}
                                className="px-3 py-2.5 text-left font-semibold text-gray-600 border-r border-gray-100 relative select-none cursor-pointer hover:bg-gray-100"
                                style={{ width: w, minWidth: 80 }}
                                onClick={() => toggleSort(`f_${f.id}`)}
                                title={`Ordenar por ${f.name}`}>
                                <div className="flex items-center gap-1 pr-2">
                                  <Icon size={11} className="text-indigo-400 shrink-0" />
                                  {f.name}
                                  <span className="text-[9px] text-gray-400 font-normal hidden lg:inline">
                                    ({FIELD_TYPE_LABEL[f.field_type]})
                                  </span>
                                  {sortIcon(`f_${f.id}`)}
                                </div>
                                <div onMouseDown={e => startColResize(`f_${f.id}`, w, e)}
                                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50" />
                              </th>
                            );
                          })}
                        </tr>
                      </thead>

                      <tbody>
                        {displayedRefs.map((ref, idx) => {
                          const isExpanded = expandedRows.has(ref.id);
                          const rowBg    = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40';
                          const stickyBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'; // opaco — evita transparencia en sticky

                          return (
                            <>
                              <tr key={`row-${ref.id}`}
                                className={`border-b ${isExpanded ? 'border-indigo-100' : 'border-gray-100'} hover:bg-indigo-50/20 transition-colors ${rowBg}`}
                              >
                                {/* Expand */}
                                <td className={`sticky left-0 z-10 px-1 py-2 text-center border-r border-gray-200 align-top ${stickyBg}`}>
                                  <button onClick={() => toggleRow(ref.id)}
                                    className="text-gray-300 hover:text-indigo-500 transition-colors">
                                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                  </button>
                                </td>

                                {/* ID */}
                                <td className={`sticky z-10 px-1 py-2 text-center border-r border-gray-200 align-top ${stickyBg}`}
                                  style={{ left: 28, width: colWidths.id }}>
                                  <span className="text-[11px] text-gray-400 font-mono tabular-nums select-all"
                                    title={`ID: ${ref.id} — el PDF se llama ${ref.id}_*.pdf`}>
                                    {ref.id}
                                  </span>
                                </td>

                                {/* Referencia */}
                                <td className={`sticky z-10 px-3 py-2 border-r border-gray-200 align-top ${stickyBg}`}
                                  style={{ left: 28 + colWidths.id, width: colWidths.ref, maxWidth: colWidths.ref, overflow: 'hidden' }}>
                                  <p className="font-medium text-gray-800 leading-snug line-clamp-2 break-words" title={ref.title}>
                                    {ref.title}
                                  </p>
                                  <p className="text-gray-400 mt-0.5 truncate text-[10px]">
                                    {ref.authors?.split(';')[0]?.trim() || '—'}
                                    {ref.journal ? ` · ${ref.journal}` : ''}
                                  </p>
                                  {ref.doi && (
                                    <a href={ref.doi.startsWith('http') ? ref.doi : `https://doi.org/${ref.doi}`}
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-600 hover:underline mt-0.5">
                                      <ExternalLink size={9} />DOI
                                    </a>
                                  )}
                                </td>

                                {/* Año */}
                                <td className="px-3 py-2 text-center text-gray-500 align-top border-r border-gray-100">
                                  {ref.year || '—'}
                                </td>

                                {/* PDF — abre visor lateral */}
                                <td className="px-2 py-2 text-center align-top border-r border-gray-100">
                                  {ref.has_pdf
                                    ? <button
                                        onClick={() => setViewingRef(
                                          viewingRef?.id === ref.id ? null : { id: ref.id, title: ref.title }
                                        )}
                                        title="Ver PDF"
                                        className={`inline-flex items-center justify-center rounded p-0.5 transition-colors
                                          ${viewingRef?.id === ref.id
                                            ? 'text-white bg-indigo-500'
                                            : 'text-purple-400 hover:text-purple-700 hover:bg-purple-50'}`}>
                                        <span className="text-[10px] font-bold tracking-wide leading-none">PDF</span>
                                      </button>
                                    : <span className="text-gray-200">—</span>
                                  }
                                </td>

                                {/* Criterios de screening (binarios 1/0) */}
                                {criteria.map(c => {
                                  const val = ref.criteria_applied?.[String(c.id)];
                                  return (
                                    <td key={`crit-${c.id}`}
                                      className={`px-2 py-2 text-center align-top border-r text-xs font-bold ${
                                        val === 1
                                          ? c.type === 'exclusion'
                                            ? 'text-red-600 bg-red-50/60 border-red-100'
                                            : 'text-green-700 bg-green-50/60 border-green-100'
                                          : 'text-gray-200 border-gray-100'
                                      }`}
                                      title={val === 1 ? c.label : '—'}
                                    >
                                      {val === 1 ? '1' : '—'}
                                    </td>
                                  );
                                })}

                                {/* Celdas .bib (solo lectura) */}
                                {activeBibCols.map(col => {
                                  const w = colWidths[col.key] ?? col.minW;
                                  return (
                                    <td key={col.key} className="align-top border-r border-sky-100 bg-sky-50/60"
                                      style={{ width: w, maxWidth: w, overflow: 'hidden' }}>
                                      <BibCell value={ref[col.key]} colKey={col.key} />
                                    </td>
                                  );
                                })}

                                {/* Campos personalizados (editables) */}
                                {fields.map(f => {
                                  const defW = ['select','multiselect'].includes(f.field_type) ? 160 : 130;
                                  const w    = colWidths[`f_${f.id}`] ?? defW;
                                  return (
                                    <td key={f.id} className="px-1.5 py-1 align-top border-r border-gray-100"
                                      style={{ width: w, maxWidth: w, overflow: 'hidden' }}>
                                      <EditableCell
                                        value={ref.values[f.id] ?? ''}
                                        fieldType={f.field_type}
                                        options={f.options || []}
                                        onSave={value => handleSaveValue(ref.id, f.id, value)}
                                      />
                                    </td>
                                  );
                                })}

                              </tr>

                              {/* Fila expandida: datos completos del .bib */}
                              {isExpanded && (
                                <tr key={`exp-${ref.id}`} className={`border-b border-indigo-100 ${rowBg}`}>
                                  <td />
                                  <td colSpan={totalCols - 1} className="px-4 py-3 bg-indigo-50/30">
                                    <div className="space-y-2 text-xs">
                                      {ref.abstract && (
                                        <div>
                                          <p className="font-semibold text-indigo-700 mb-0.5 flex items-center gap-1">
                                            <BookOpen size={11} /> Abstract
                                          </p>
                                          <p className="text-gray-700 leading-relaxed">{ref.abstract}</p>
                                        </div>
                                      )}
                                      {ref.keywords && (
                                        <div>
                                          <p className="font-semibold text-indigo-700 mb-0.5 flex items-center gap-1">
                                            <Tag size={11} /> Palabras clave
                                          </p>
                                          <p className="text-gray-600">{ref.keywords}</p>
                                        </div>
                                      )}
                                      {ref.authors && (
                                        <div>
                                          <p className="font-semibold text-indigo-700 mb-0.5 flex items-center gap-1">
                                            <Users size={11} /> Autores completos
                                          </p>
                                          <p className="text-gray-600">{ref.authors}</p>
                                        </div>
                                      )}
                                      {ref.url && (
                                        <div>
                                          <p className="font-semibold text-indigo-700 mb-0.5 flex items-center gap-1">
                                            <Link size={11} /> URL
                                          </p>
                                          <a href={ref.url} target="_blank" rel="noopener noreferrer"
                                            className="text-blue-500 hover:underline break-all">{ref.url}</a>
                                        </div>
                                      )}
                                      {!ref.abstract && !ref.keywords && !ref.url && (
                                        <p className="text-gray-400 italic">No hay datos adicionales del .bib para esta referencia.</p>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {filterText
                        ? `${displayedRefs.length} de ${refs.length} artículos`
                        : `${refs.length} artículo${refs.length !== 1 ? 's' : ''}`
                      } ·{' '}
                      {fields.length} campo{fields.length !== 1 ? 's' : ''} ·{' '}
                      {activeBibCols.length} col. .bib
                      {sortState.col && <> · ordenado por <strong className="text-indigo-400">{sortState.col}</strong></>}
                    </span>
                    <span>▼ expandir · arrastra borde · clic encabezado para ordenar · clic celda para editar</span>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      </div>{/* fin overflow-auto */}
      </div>{/* fin panel izquierdo */}

      {/* ── Divisor redimensionable + Panel PDF ──────────────────────────── */}
      {viewingRef && (
        <>
          {/* Divisor drag */}
          <div
            onMouseDown={startPdfResize}
            className="w-1.5 bg-gray-200 hover:bg-indigo-400 cursor-col-resize shrink-0 transition-colors"
            title="Arrastra para redimensionar"
          />
          {/* Panel PDF */}
          <div className="shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-hidden"
            style={{ width: pdfPanelWidth }}>
            <PDFViewer
              referenceId={viewingRef.id}
              title={viewingRef.title}
              onClose={() => setViewingRef(null)}
              embedded={true}
            />
          </div>
        </>
      )}

    </div>
  );
}
