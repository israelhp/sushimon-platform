'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/lib/cn';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { selectionRule } from '@/lib/modifier-rules';
import { optionExtraCents, type ModifierSelectionState } from '../modifier-selection';

const money = (cents: number) => formatMoney(cents / 100);

/**
 * Selector de extras de la ficha (F12): por grupo, nombre, «Obligatorio»/«Opcional», regla («Elige 1», «Elige hasta N», «Elige
 * de X a Y»), opciones con «+Q5.00». Radio cuando `maxSelect = 1` (con «Ninguno» si es opcional) y casillas cuando
 * `maxSelect > 1`, que se deshabilitan al llegar al tope. Los mensajes de mínimo/máximo se anuncian en vivo. Presentación
 * pura: el estado vive en `useModifierSelection`.
 */
export function ModifierSelector({
  groups,
  selection,
  disabled = false,
}: {
  groups: readonly PublicModifierGroup[];
  selection: ModifierSelectionState;
  disabled?: boolean;
}) {
  const t = useTranslations('product.modifiers');
  if (groups.length === 0) return null;
  return (
    <section aria-label={t('title')} className="flex flex-col gap-3">
      {groups.map((group) => (
        <ModifierGroupField
          key={group.id}
          group={group}
          selection={selection}
          disabled={disabled}
        />
      ))}
    </section>
  );
}

function ModifierGroupField({
  group,
  selection,
  disabled,
}: {
  group: PublicModifierGroup;
  selection: ModifierSelectionState;
  disabled: boolean;
}) {
  const t = useTranslations('product.modifiers');
  const uid = useId();
  const rule = selectionRule(group.minSelect, group.maxSelect);
  const ruleLabel =
    rule.kind === 'exactly'
      ? t('ruleExactly', { n: rule.count })
      : rule.kind === 'upTo'
        ? t('ruleUpTo', { n: rule.max })
        : t('ruleBetween', { min: rule.min, max: rule.max });
  const single = group.maxSelect === 1;
  const count = selection.chosen[group.id]?.length ?? 0;
  const issue = selection.issueOf(group);
  const atMax = !single && count >= group.maxSelect;
  const messageId = `${uid}-msg`;
  const message = issue
    ? issue.kind === 'required'
      ? t('errRequired', { min: issue.min, group: group.name })
      : t('errTooMany', { max: issue.max, group: group.name })
    : null;

  return (
    <fieldset
      className="m-0 min-w-0 rounded-2xl border border-line bg-surface p-3.5"
      disabled={disabled}
      aria-describedby={messageId}
      data-group-id={group.id}
    >
      <legend className="flex w-full flex-wrap items-center gap-2 px-1 text-[15px] font-extrabold">
        <span>{group.name}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-extrabold uppercase',
            group.required ? 'bg-deep text-ondeep' : 'border border-line bg-surface text-fg',
          )}
        >
          {group.required ? t('required') : t('optional')}
        </span>
        <span className="text-[13px] font-semibold text-muted">{ruleLabel}</span>
      </legend>
      <div className="mt-1 flex flex-col">
        {single && !group.required ? (
          <OptionRow
            id={`${uid}-none`}
            type="radio"
            name={uid}
            label={t('none')}
            checked={count === 0}
            disabled={disabled}
            onChange={() => selection.clearGroup(group.id)}
          />
        ) : null}
        {group.options.map((o) => {
          const checked = selection.isChosen(group.id, o.id);
          const cents = optionExtraCents(o.extraPrice);
          return (
            <OptionRow
              key={o.id}
              id={`${uid}-${o.id}`}
              type={single ? 'radio' : 'checkbox'}
              name={single ? uid : undefined}
              label={o.name}
              extra={cents > 0 ? `+${money(cents)}` : t('included')}
              checked={checked}
              disabled={disabled || (atMax && !checked)}
              onChange={() => selection.toggle(group, o.id)}
            />
          );
        })}
      </div>
      <p id={messageId} role="status" aria-live="polite" className="m-0 mt-1.5 text-[13px]">
        {message ? (
          <span className="font-bold text-danger">{message}</span>
        ) : !single ? (
          <span className="text-muted">
            {atMax ? t('maxReached') : t('selected', { count, max: group.maxSelect })}
          </span>
        ) : null}
      </p>
    </fieldset>
  );
}

function OptionRow({
  id,
  type,
  name,
  label,
  extra,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  type: 'radio' | 'checkbox';
  name?: string;
  label: string;
  extra?: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-1.5 py-1 hover:bg-subtle',
        disabled && !checked && 'cursor-not-allowed',
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-5 w-5 flex-none accent-primary disabled:opacity-50"
      />
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      {extra ? <span className="flex-none text-[14px] font-bold text-fg">{extra}</span> : null}
    </label>
  );
}
