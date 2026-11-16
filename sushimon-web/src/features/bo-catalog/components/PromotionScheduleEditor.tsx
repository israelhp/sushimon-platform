'use client';

import { useTranslations } from 'next-intl';
import { IconPlus } from '@/components/icons/bo';
import { PROMOTION_SLOTS_MAX } from '@/lib/promotion-rules';
import { ISO_DAYS } from '../catalog-view';
import { newSlotRow, type SlotRow } from '../promotions-view';

/**
 * Horario semanal de la promoción (Happy Hour): una fila por franja, en hora local de Guatemala, sin cruzar la medianoche. «Cruza la
 * medianoche» la parte en dos días al enviar (vie 22:00 → 02:00 = vie 22:00–24:00 + sáb 00:00–02:00); un fin `00:00` sin marcarla
 * significa «hasta la medianoche». Sin filas = todos los días y todo el día dentro de la vigencia.
 */
export function PromotionScheduleEditor({
  rows,
  onChange,
  describedBy,
  invalid,
  fieldRef,
}: {
  rows: readonly SlotRow[];
  onChange: (rows: SlotRow[]) => void;
  describedBy?: string;
  invalid?: boolean;
  fieldRef?: (el: HTMLButtonElement | null) => void;
}) {
  const t = useTranslations('backoffice.promotions.form');
  const tp = useTranslations('backoffice.promotions');
  const update = (key: string, change: Partial<SlotRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="field span-2">
      <span className="flabel">{t('schedule')}</span>
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('scheduleHint')}
      </span>
      {rows.length === 0 ? (
        <p className="sm muted" style={{ margin: '6px 0', fontWeight: 600 }}>
          {t('scheduleEmpty')}
        </p>
      ) : (
        <div className="col gap8" style={{ margin: '8px 0' }}>
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="row gap8 wrap"
              role="group"
              aria-label={t('slotLabel', { n: i + 1 })}
            >
              <select
                className="inp"
                aria-label={t('slotDay', { n: i + 1 })}
                value={r.weekday}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => update(r.key, { weekday: Number(e.target.value) })}
              >
                {ISO_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {tp(`days.${d}.full`)}
                  </option>
                ))}
              </select>
              <input
                className="inp"
                type="time"
                aria-label={t('slotStart', { n: i + 1 })}
                value={r.start}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => update(r.key, { start: e.target.value })}
              />
              <input
                className="inp"
                type="time"
                aria-label={t('slotEnd', { n: i + 1 })}
                value={r.end}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => update(r.key, { end: e.target.value })}
              />
              <label className="row gap8">
                <input
                  type="checkbox"
                  checked={r.overnight}
                  onChange={(e) => update(r.key, { overnight: e.target.checked })}
                />
                <span className="sm" style={{ fontWeight: 700 }}>
                  {t('slotOvernight')}
                </span>
              </label>
              <button
                type="button"
                className="btn sm"
                aria-label={t('slotRemove', { n: i + 1 })}
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              >
                {t('remove')}
              </button>
            </div>
          ))}
        </div>
      )}
      <div>
        <button
          type="button"
          ref={fieldRef}
          className="btn sm"
          data-field="schedule"
          disabled={rows.length >= PROMOTION_SLOTS_MAX}
          onClick={() => onChange([...rows, newSlotRow(rows[rows.length - 1]?.weekday ?? 1)])}
        >
          <IconPlus size="sm" />
          {t('addSlot')}
        </button>
      </div>
    </div>
  );
}
