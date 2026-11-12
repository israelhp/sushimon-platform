import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { ReportCharts } from '../reports-view';

/**
 * Gráficos del resumen: barras HTML/CSS propias (sin librería), como el prototipo. Cada gráfico es `role="img"` con
 * nombre accesible y una tabla equivalente solo para lectores de pantalla (los hijos de un `img` no se exponen).
 */

interface ChartProps {
  charts: ReportCharts;
  /** Etiqueta del periodo para el nombre accesible. */
  rangeText: string;
  totalOrders: number;
  totalSales: number;
}

export function OrdersChart({ charts, rangeText, totalOrders }: ChartProps) {
  const t = useTranslations('backoffice.reports');
  const unit = t(charts.unit === 'hour' ? 'unitHour' : 'unitDay');
  return (
    <>
      <div
        className="chart"
        style={{ minWidth: charts.minWidth || undefined, gap: charts.gap }}
        role="img"
        aria-label={t('ordersChartLabel', { unit, total: totalOrders, range: rangeText })}
      >
        {charts.orderGroups.map((g) => (
          <div key={g.key} className="bcol">
            <span className="bval">{g.total}</span>
            <div className="bwrap">
              {g.bars.map((b) => (
                <div
                  key={b.branchId}
                  className="gbar"
                  title={b.title}
                  style={{ height: `${b.h}%`, background: b.color }}
                />
              ))}
            </div>
            <span className="blabel">{g.label}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('tableCaptionOrders', { unit })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('tableGroup')}</th>
            {charts.legend.map((l) => (
              <th key={l.branchId} scope="col">
                {l.name}
              </th>
            ))}
            <th scope="col">{t('tableOrders')}</th>
          </tr>
        </thead>
        <tbody>
          {charts.orderGroups.map((g) => (
            <tr key={g.key}>
              <th scope="row">{g.label}</th>
              {g.bars.map((b) => (
                <td key={b.branchId}>{b.count}</td>
              ))}
              <td>{g.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function SalesChart({ charts, rangeText, totalSales }: ChartProps) {
  const t = useTranslations('backoffice.reports');
  const unit = t(charts.unit === 'hour' ? 'unitHour' : 'unitDay');
  return (
    <>
      <div
        className="chart"
        style={{ minWidth: charts.salesMinWidth || undefined, gap: charts.gap }}
        role="img"
        aria-label={t('salesChartLabel', {
          unit,
          total: formatMoney(totalSales),
          range: rangeText,
        })}
      >
        {charts.salesBars.map((s) => (
          <div key={s.key} className="bcol">
            <span className="bval">{s.value}</span>
            <div className="bwrap">
              <div
                className={cn('bar', s.today && 'today')}
                title={s.title}
                style={{ height: `${s.h}%` }}
              />
            </div>
            <span className="blabel">{s.label}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('tableCaptionSales', { unit })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('tableGroup')}</th>
            <th scope="col">{t('tableSales')}</th>
          </tr>
        </thead>
        <tbody>
          {charts.salesBars.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{formatMoney(s.sales)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
