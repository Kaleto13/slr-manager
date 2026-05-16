/**
 * StatsPanel.jsx
 * Gráficos de la búsqueda:
 *   - Publicaciones por año (BarChart)
 *   - Por base de datos / fuente (PieChart)
 *   - Decisiones de screening (PieChart)
 *   - Top revistas (HorizontalBarChart)
 */

import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  LabelList,
} from 'recharts';

const PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
];

const DECISION_COLORS = {
  include : '#22c55e',
  exclude : '#ef4444',
  maybe   : '#f59e0b',
  pending : '#94a3b8',
};

const DECISION_LABELS = {
  include : 'Incluir',
  exclude : 'Excluir',
  maybe   : 'Dudoso',
  pending : 'Pendiente',
};

function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">{title}</h4>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
      Sin datos suficientes
    </div>
  );
}

// ── Gráfico de barras: publicaciones por año ─────────────────────
function ByYearChart({ data }) {
  if (!data || data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="year" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [v, 'Registros']}
          labelFormatter={(l) => `Año: ${l}`}
        />
        <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]}>
          <LabelList dataKey="count" position="top" style={{ fontSize: 10, fill: '#374151' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Pie chart genérico ───────────────────────────────────────────
function SimplePie({ data, nameKey, valueKey, colorMap = null }) {
  if (!data || data.length === 0) return <EmptyChart />;
  const total = data.reduce((s, d) => s + d[valueKey], 0);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={75}
          label={({ name, percent }) =>
            percent > 0.04 ? `${name} (${(percent * 100).toFixed(0)}%)` : ''
          }
          labelLine={false}
        >
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorMap ? (colorMap[entry[nameKey]] || PALETTE[i % PALETTE.length]) : PALETTE[i % PALETTE.length]}
            />
          ))}
        </Pie>
        <Tooltip formatter={(v, n) => [`${v} (${((v / total) * 100).toFixed(1)}%)`, n]} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => DECISION_LABELS[value] || value}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Barras horizontales: top revistas ───────────────────────────
function TopJournalsChart({ data }) {
  if (!data || data.length === 0) return <EmptyChart />;
  const top = data.slice(0, 10);
  // Truncar nombres largos
  const formatted = top.map(d => ({
    ...d,
    journal: d.journal.length > 35 ? d.journal.slice(0, 34) + '…' : d.journal,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, formatted.length * 28)}>
      <BarChart
        layout="vertical"
        data={formatted}
        margin={{ top: 0, right: 30, left: 4, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey="journal" width={200} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => [v, 'Registros']} />
        <Bar dataKey="count" fill="#a855f7" radius={[0, 3, 3, 0]}>
          <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#374151' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Componente principal ─────────────────────────────────────────
export default function StatsPanel({ searchId }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!searchId) return;
    setLoading(true);
    setError(null);
    axios.get(`/api/stats/${searchId}/charts`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [searchId]);

  if (!searchId) return (
    <div className="text-center text-gray-400 py-10 text-sm">
      Selecciona una búsqueda para ver los gráficos
    </div>
  );
  if (loading) return <div className="text-center py-10 text-gray-500 text-sm">Cargando gráficos...</div>;
  if (error)   return <div className="text-center py-6 text-red-500 text-sm">Error: {error}</div>;
  if (!data)   return null;

  // Formatear decisiones para el pie
  const decisionData = (data.by_decision || []).map(d => ({
    ...d,
    label: DECISION_LABELS[d.decision] || d.decision,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Publicaciones por año">
        <ByYearChart data={data.by_year} />
      </ChartCard>

      <ChartCard title="Por base de datos / fuente">
        <SimplePie data={data.by_source} nameKey="source" valueKey="count" />
      </ChartCard>

      <ChartCard title="Decisiones de cribado (título/resumen)">
        <SimplePie
          data={decisionData}
          nameKey="decision"
          valueKey="count"
          colorMap={DECISION_COLORS}
        />
      </ChartCard>

      <ChartCard title="Top revistas / journals">
        <TopJournalsChart data={data.by_journal} />
      </ChartCard>
    </div>
  );
}
