/**
 * PRISMADiagram.jsx
 * Diagrama de flujo PRISMA 2020 renderizado como SVG.
 * Recibe los datos de /stats/{search_id}/prisma y los pinta
 * en el formato estándar de 4 fases.
 */

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// ── Paleta de colores por fase ──────────────────────────────────
const COLORS = {
  identification : { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  screening      : { bg: '#dcfce7', border: '#22c55e', text: '#15803d' },
  eligibility    : { bg: '#fef9c3', border: '#eab308', text: '#854d0e' },
  included       : { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8' },
  excluded       : { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
  label          : { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' },
};

// ── Componentes SVG primitivos ──────────────────────────────────

function Box({ x, y, w, h, color, title, subtitle, lines = [] }) {
  const { bg, border, text } = color;
  const lineH = 15;
  const bodyH = lines.length * lineH;
  const totalH = h + (bodyH > 0 ? bodyH + 8 : 0);

  return (
    <g>
      <rect x={x} y={y} width={w} height={totalH}
        rx="6" ry="6"
        fill={bg} stroke={border} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 16}
        textAnchor="middle" fontSize="11" fontWeight="700" fill={text}>
        {title}
      </text>
      {subtitle && (
        <text x={x + w / 2} y={y + 30}
          textAnchor="middle" fontSize="13" fontWeight="800" fill={text}>
          {subtitle}
        </text>
      )}
      {lines.map((line, i) => (
        <text key={i}
          x={x + 10} y={y + h + 6 + (i + 1) * lineH}
          fontSize="10" fill={text}>
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, label = '' }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6"
          refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="#64748b" strokeWidth="1.5"
        markerEnd="url(#arrowhead)" />
      {label && (
        <text x={mx + 4} y={my - 4} fontSize="9" fill="#64748b">{label}</text>
      )}
    </g>
  );
}

function PhaseLabel({ x, y, h, label, color }) {
  const { bg, border, text } = color;
  return (
    <g>
      <rect x={x} y={y} width={90} height={h}
        rx="4" fill={bg} stroke={border} strokeWidth="1.2" />
      <text
        x={x + 45} y={y + h / 2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontWeight="700" fill={text}
        style={{ writingMode: 'horizontal-tb' }}
        transform={`rotate(-90, ${x + 45}, ${y + h / 2})`}>
        {label}
      </text>
    </g>
  );
}

// ── Diagrama principal ──────────────────────────────────────────

export default function PRISMADiagram({ searchId }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!searchId) return;
    setLoading(true);
    setError(null);
    axios.get(`/api/stats/${searchId}/prisma`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [searchId]);

  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prisma_${searchId}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!searchId) return (
    <div className="text-center text-gray-400 py-10 text-sm">
      Selecciona una búsqueda para ver el diagrama PRISMA
    </div>
  );
  if (loading) return <div className="text-center py-10 text-gray-500 text-sm">Cargando diagrama...</div>;
  if (error)   return <div className="text-center py-10 text-red-500 text-sm">Error: {error}</div>;
  if (!data)   return null;

  const { identification: ident, screening: screen, eligibility: elig, included: inc } = data;

  // ── Geometría ──
  const SVG_W = 620;
  const BOX_W = 200;
  const LEFT_BOX_X = 110;   // columna principal
  const RIGHT_BOX_X = 380;  // columna de exclusiones
  const LABEL_X = 8;

  // Fases y posiciones Y
  const PHASE_PAD = 16;
  const phases = [
    { label: 'Identificación', color: COLORS.identification, yStart: 20,  height: 90  },
    { label: 'Cribado',        color: COLORS.screening,      yStart: 130, height: 90  },
    { label: 'Elegibilidad',   color: COLORS.eligibility,    yStart: 240, height: 90  },
    { label: 'Incluidos',      color: COLORS.included,       yStart: 350, height: 70  },
  ];
  const SVG_H = 450;

  // Posiciones de las cajas principales (centro de la caja)
  const BOX_H = 52;
  const bx = LEFT_BOX_X;

  const b1y = 30;   // Identificados
  const b2y = 140;  // Cribados
  const b3y = 250;  // Evaluados elegibilidad
  const b4y = 360;  // Incluidos

  // Cajas de exclusión
  const ex = RIGHT_BOX_X;
  const e2y = 140;  // Excluidos en cribado
  const e3y = 250;  // Excluidos en elegibilidad

  // Exclusion criteria lines
  const exclLines = screen.exclusion_criteria.slice(0, 5).map(
    ec => `• ${ec.label}: n=${ec.count}`
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-semibold text-gray-700">Diagrama de flujo PRISMA 2020</h3>
        <button
          onClick={handleExportSVG}
          className="text-xs px-3 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100"
        >
          Exportar SVG
        </button>
      </div>

      <div className="overflow-auto">
        <svg ref={svgRef} width={SVG_W} height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ fontFamily: 'system-ui, sans-serif' }}>

          {/* ── Etiquetas de fase (izquierda) ── */}
          {phases.map(ph => (
            <PhaseLabel key={ph.label}
              x={LABEL_X} y={ph.yStart} h={ph.height}
              label={ph.label} color={ph.color} />
          ))}

          {/* ── Flechas verticales (flujo principal) ── */}
          <Arrow x1={bx + BOX_W/2} y1={b1y + BOX_H}
                 x2={bx + BOX_W/2} y2={b2y} />
          <Arrow x1={bx + BOX_W/2} y1={b2y + BOX_H}
                 x2={bx + BOX_W/2} y2={b3y} />
          <Arrow x1={bx + BOX_W/2} y1={b3y + BOX_H}
                 x2={bx + BOX_W/2} y2={b4y} />

          {/* ── Flechas horizontales hacia exclusiones ── */}
          <Arrow x1={bx + BOX_W} y1={b2y + BOX_H/2}
                 x2={ex}          y2={e2y + BOX_H/2} />
          {elig.has_full_text_phase && (
            <Arrow x1={bx + BOX_W} y1={b3y + BOX_H/2}
                   x2={ex}          y2={e3y + BOX_H/2} />
          )}

          {/* ── CAJAS PRINCIPALES ── */}

          {/* Identificados */}
          <Box x={bx} y={b1y} w={BOX_W} h={BOX_H}
            color={COLORS.identification}
            title="Registros identificados"
            subtitle={`n = ${ident.total_identified}`}
            lines={[`Duplicados eliminados: n = ${ident.duplicates_removed}`]}
          />

          {/* Cribados */}
          <Box x={bx} y={b2y} w={BOX_W} h={BOX_H}
            color={COLORS.screening}
            title="Registros cribados"
            subtitle={`n = ${screen.screened}`}
          />

          {/* Evaluados elegibilidad */}
          <Box x={bx} y={b3y} w={BOX_W} h={BOX_H}
            color={COLORS.eligibility}
            title={elig.has_full_text_phase ? "Texto completo evaluado" : "Potencialmente elegibles"}
            subtitle={`n = ${elig.assessed}`}
          />

          {/* Incluidos */}
          <Box x={bx} y={b4y} w={BOX_W} h={BOX_H}
            color={COLORS.included}
            title="Estudios incluidos"
            subtitle={`n = ${inc.final}`}
            lines={[`Con PDF extraído: n = ${inc.with_pdf}`]}
          />

          {/* ── CAJAS DE EXCLUSIÓN ── */}

          {/* Excluidos en cribado */}
          <Box x={ex} y={e2y} w={BOX_W} h={BOX_H}
            color={COLORS.excluded}
            title="Registros excluidos"
            subtitle={`n = ${screen.excluded}`}
            lines={exclLines}
          />

          {/* Excluidos en elegibilidad */}
          {elig.has_full_text_phase && (
            <Box x={ex} y={e3y} w={BOX_W} h={BOX_H}
              color={COLORS.excluded}
              title="Texto completo excluido"
              subtitle={`n = ${elig.excluded}`}
            />
          )}

          {/* Pendientes badge */}
          {screen.pending > 0 && (
            <g>
              <rect x={bx + BOX_W - 28} y={b2y - 10} width={56} height={18}
                rx="9" fill="#f59e0b" />
              <text x={bx + BOX_W} y={b2y - 1}
                textAnchor="middle" fontSize="9" fill="white" fontWeight="700">
                {screen.pending} pend.
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Leyenda numérica */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div className="bg-blue-50 rounded p-2">
          <span className="font-semibold text-blue-700">Identificados:</span> {ident.total_identified} registros
          &nbsp;·&nbsp; {ident.duplicates_removed} duplicados eliminados
        </div>
        <div className="bg-green-50 rounded p-2">
          <span className="font-semibold text-green-700">Cribado:</span> {screen.screened} cribados
          &nbsp;·&nbsp; {screen.excluded} excluidos &nbsp;·&nbsp; {screen.included} incluidos
        </div>
        <div className="bg-yellow-50 rounded p-2">
          <span className="font-semibold text-yellow-700">Elegibilidad:</span> {elig.assessed} evaluados
          &nbsp;·&nbsp; {elig.excluded} excluidos
        </div>
        <div className="bg-purple-50 rounded p-2">
          <span className="font-semibold text-purple-700">Incluidos:</span> {inc.final} estudios
          &nbsp;·&nbsp; {inc.with_pdf} con PDF
        </div>
      </div>
    </div>
  );
}
