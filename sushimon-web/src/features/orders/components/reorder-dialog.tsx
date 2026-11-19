'use client';

import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Info,
  RotateCcw,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { moneyToCents } from '@/lib/checkout-quote';
import type {
  OrderReorderIssue,
  OrderReorderLine,
  OrderReorderPreview,
} from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicBranches } from '@/features/branches/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useCart } from '@/features/cart/cart-context';
import { REJECTION_KEY } from '@/features/cart/use-add-to-cart';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { readGuestToken } from '@/features/checkout/confirmation-store';
import { useCartDrawer } from '@/features/store-shell/store-shell-context';
import {
  applyReorder,
  displayIssues,
  groupLines,
  isFinalStatus,
  needsReplaceConfirmation,
  planMerge,
  previewErrorKind,
  priceChangeOf,
  type MergeMode,
} from '../reorder/reorder-model';
import { useReorderPreview } from '../reorder/use-reorder-preview';

const KNOWN_ISSUES = new Set([
  'PRODUCT_REMOVED',
  'PRODUCT_INACTIVE',
  'PRODUCT_OUT_OF_STOCK',
  'BRANCH_UNAVAILABLE',
  'OPTION_REMOVED',
  'OPTION_INACTIVE',
  'GROUP_RULE_CHANGED',
  'REQUIRED_SELECTION_MISSING',
  'PRICE_CHANGED',
  'QUANTITY_ADJUSTED',
  'NOTE_DROPPED',
]);

const STATUS_ICON = {
  AVAILABLE: CircleCheck,
  NEEDS_CONFIGURATION: CircleAlert,
  UNAVAILABLE: CircleX,
} as const;

const STATUS_TONE = {
  AVAILABLE: 'text-success',
  NEEDS_CONFIGURATION: 'text-fg',
  UNAVAILABLE: 'text-danger',
} as const;

const SELECT =
  'min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-fg';

/**
 * F23 (spec 024 §9.4) — «Volver a pedir»: revisa el pedido contra el catálogo VIGENTE (`POST /v1/orders/{id}/reorder-preview`,
 * solo lectura) y añade al carrito F18 existente solo lo válido. El servidor diagnostica cada línea (`AVAILABLE`,
 * `NEEDS_CONFIGURATION`, `UNAVAILABLE`); la web NO sustituye opciones retiradas ni copia precios (los de «antes → ahora» son
 * informativos; F19 cotiza al pagar). Con el carrito de otra sucursal solo se ofrece reemplazar CON confirmación o cancelar; nunca
 * se mezclan sucursales ni se vacía solo. Un error del preview no modifica el carrito. No crea pedidos ni toca el historial.
 * `orderId` es el UUID del pedido (en el mock también se acepta el número de un pedido simulado). Una sola región `aria-live`.
 */
export function ReorderDialog({
  orderId,
  displayNumber,
  inProgress,
  onClose,
}: {
  orderId: string;
  displayNumber: string;
  /** `true` = el pedido sigue en curso: pide confirmar ANTES de consultar. Si no se sabe, lo decide `source.status` del preview. */
  inProgress?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('reorder');
  const tCart = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const cartDrawer = useCartDrawer();
  const sheet = useProductSheet();
  const branches = usePublicBranches();
  const preview = useReorderPreview();
  const { mutate } = preview;

  const [branchChoice, setBranchChoice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<MergeMode | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  // Última vista previa lograda: el selector de sucursal se queda montado (y con el foco) mientras se repite la revisión.
  const [shown, setShown] = useState<OrderReorderPreview | null>(null);

  const mayQuery = inProgress !== true || confirmed;
  // Una consulta por (pedido, sucursal): el doble efecto de React en desarrollo no la repite. «Reintentar» llama a `mutate` aparte.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!mayQuery) return;
    const key = `${orderId}|${branchChoice ?? ''}`;
    if (requested.current === key) return;
    requested.current = key;
    mutate({ orderId, branchId: branchChoice, guestToken: readGuestToken(orderId) });
  }, [mayQuery, branchChoice, orderId, mutate]);

  const money = (value: string) => formatMoney((moneyToCents(value) ?? 0) / 100, locale);
  const data = preview.data;
  if (data && data !== shown) setShown(data);
  const gate =
    !confirmed && (inProgress === true || (!!data && !isFinalStatus(data.source.status)));
  const plan = data ? planMerge(cart, data.branch.requestedBranchId) : null;
  const effectiveMode: MergeMode | null =
    plan && (mode && plan.modes.includes(mode) ? mode : plan.defaultMode);
  const error = preview.isError ? previewErrorKind(preview.error) : null;
  const pending = preview.isPending && mayQuery;

  // Foco en los pasos internos: título del paso al entrar; al volver de la confirmación, el botón principal.
  const gateRef = useRef<HTMLParagraphElement>(null);
  const fromRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (gate) gateRef.current?.focus();
  }, [gate]);
  useEffect(() => {
    if (confirmed) fromRef.current?.focus();
  }, [confirmed]);
  useEffect(() => {
    if (confirmingReplace) confirmRef.current?.focus();
    else if (wasConfirming.current) primaryRef.current?.focus();
    wasConfirming.current = confirmingReplace;
  }, [confirmingReplace]);

  const announcement = gate
    ? t('confirmInProgressTitle')
    : confirmingReplace && plan
      ? `${t('replaceConfirm.title')} ${t('replaceConfirm.body', { a: plan.replaceCount })}`
      : pending
        ? t('checking')
        : error
          ? t(`error.${error.kind}`)
          : data
            ? data.summary.canAddAny
              ? t('announceResult', {
                  a: data.summary.available,
                  b: data.summary.needsConfiguration,
                  c: data.summary.unavailable,
                })
              : t('nothingNow')
            : '';

  const apply = (chosen: MergeMode) => {
    if (!data) return;
    const result = applyReorder(cart, data, chosen);
    if (!result.ok) {
      setConfirmingReplace(false);
      notify(
        result.reason === 'NOTHING_TO_ADD' ? t('nothing') : tCart(REJECTION_KEY[result.reason]),
        { tone: 'warn' },
      );
      return;
    }
    notify(t('added', { a: result.units }));
    onClose();
    cartDrawer.open();
  };

  const onPrimary = () => {
    if (!plan || !effectiveMode) return;
    if (needsReplaceConfirmation(plan, effectiveMode)) setConfirmingReplace(true);
    else apply(effectiveMode);
  };

  const configure = (line: OrderReorderLine) => {
    if (!line.candidate) return;
    // La ficha se abre sin precarga (no admite una configuración de partida): nada entra al carrito hasta que el cliente confirma allí.
    onClose();
    sheet.openProduct(line.candidate.line.productId, line.candidate.slug);
  };

  const branchOptions = (() => {
    const list = (branches.data ?? []).map((b) => ({ id: b.id, name: b.name }));
    if (shown && !list.some((b) => b.id === shown.branch.requestedBranchId)) {
      list.unshift({ id: shown.branch.requestedBranchId, name: shown.branch.name });
    }
    return list;
  })();

  const showResult = !!data && !gate;
  let footer = null;
  if (showResult && plan && effectiveMode) {
    footer = confirmingReplace ? (
      <div className="flex w-full flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          className="btn btn-primary w-full sm:w-auto"
          onClick={() => apply('replace')}
        >
          {t('replaceConfirm.yes')}
        </button>
        <button
          type="button"
          className="btn w-full sm:w-auto"
          onClick={() => setConfirmingReplace(false)}
        >
          {t('back')}
        </button>
      </div>
    ) : (
      <div className="flex w-full flex-col gap-2 sm:flex-row-reverse">
        <button
          ref={primaryRef}
          type="button"
          className="btn btn-primary w-full sm:w-auto"
          disabled={!data.summary.canAddAny}
          onClick={onPrimary}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />{' '}
          {effectiveMode === 'replace' && plan.situation !== 'empty'
            ? t('confirmReplace')
            : t('confirmAdd')}
        </button>
        <button type="button" className="btn w-full sm:w-auto" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} layer="top" title={t('title')} footer={footer}>
      <div className="flex flex-col gap-4 pb-2" aria-busy={pending || undefined}>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <p
          ref={fromRef}
          tabIndex={-1}
          className="m-0 text-[14px] font-bold text-muted outline-none"
        >
          {t('from', { a: displayNumber })}
        </p>

        {gate ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <p ref={gateRef} tabIndex={-1} className="m-0 font-extrabold outline-none">
              {t('confirmInProgressBody')}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                className="btn btn-primary w-full sm:w-auto"
                onClick={() => setConfirmed(true)}
              >
                {t('confirmInProgressYes')}
              </button>
              <button type="button" className="btn w-full sm:w-auto" onClick={onClose}>
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : confirmingReplace && plan ? (
          <div
            className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
            data-testid="replace-confirm"
          >
            <p ref={confirmRef} tabIndex={-1} className="m-0 font-extrabold outline-none">
              {t('replaceConfirm.title')}
            </p>
            <p className="m-0 text-[14px]">{t('replaceConfirm.body', { a: plan.replaceCount })}</p>
          </div>
        ) : (
          <>
            {shown ? (
              <BranchBlock
                data={shown}
                options={branchOptions}
                value={branchChoice ?? shown.branch.requestedBranchId}
                originalName={
                  branchOptions.find((b) => b.id === shown.branch.originalBranchId)?.name ?? ''
                }
                settled={!pending && !error && !!data}
                onChange={(id) => {
                  setBranchChoice(id);
                  setConfirmingReplace(false);
                }}
                locale={locale}
              />
            ) : null}
            {pending ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm text-muted">{t('checking')}</p>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : error ? (
              <div data-testid="reorder-error">
                {error.kind === 'denied' ? (
                  <div className="notice notice-warn items-center">
                    <TriangleAlert className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
                    <span>{t('error.denied')}</span>
                  </div>
                ) : (
                  <ErrorNotice
                    key={preview.submittedAt}
                    message={t(`error.${error.kind}`)}
                    cooldownSec={error.retryAfterSec}
                    onRetry={() =>
                      mutate({
                        orderId,
                        branchId: branchChoice,
                        guestToken: readGuestToken(orderId),
                      })
                    }
                  />
                )}
              </div>
            ) : data && plan && effectiveMode ? (
              <>
                <Lines data={data} money={money} onConfigure={configure} />
                <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 text-[14px]">
                  <div className="flex items-baseline justify-between">
                    <span className="font-extrabold">{t('estimated')}</span>
                    <span className="font-display text-[22px]" data-testid="reorder-estimate">
                      {money(data.summary.estimatedSubtotal)}
                    </span>
                  </div>
                  <p className="m-0 mt-1 text-[12px] text-muted">{t('estimateNote')}</p>
                </div>
                {data.summary.canAddAny ? (
                  <CartChoice
                    plan={plan}
                    mode={effectiveMode}
                    branchName={data.branch.name}
                    onMode={setMode}
                  />
                ) : (
                  <p className="m-0 text-[14px] font-extrabold" data-testid="nothing-now">
                    {t('nothingNow')}
                  </p>
                )}
              </>
            ) : null}
          </>
        )}

        <p className="m-0 flex items-start gap-2 text-[12px] text-muted">
          <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> {t('noCharge')}
        </p>
      </div>
    </Modal>
  );
}

function BranchBlock({
  data,
  options,
  value,
  originalName,
  settled,
  onChange,
  locale,
}: {
  data: OrderReorderPreview;
  options: { id: string; name: string }[];
  value: string;
  originalName: string;
  /** `false` mientras se repite la revisión: no se muestran avisos de la sucursal anterior. */
  settled: boolean;
  onChange: (id: string) => void;
  locale: string;
}) {
  const t = useTranslations('reorder.branch');
  const { branch } = data;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="reorder-branch-select" className="lbl !mb-0">
        {t('label')}
      </label>
      <select
        id="reorder-branch-select"
        className={SELECT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {settled && !branch.sameBranch ? (
        <p className="m-0 text-[13px] text-muted" data-testid="branch-differs">
          {t('differs', { a: originalName || t('unknown'), b: branch.name })}
        </p>
      ) : null}
      {!settled ? null : !branch.active ? (
        <p className="notice notice-warn m-0" data-testid="branch-inactive">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <span>{t('inactive')}</span>
        </p>
      ) : !branch.acceptingOrders ? (
        <p className="notice m-0" data-testid="branch-closed">
          <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <span>
            {t('closedNow', {
              a: t(`reason.${branch.reason}`),
              b: branch.nextOpensAt ? formatDateTime(branch.nextOpensAt, locale) : '',
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Lines({
  data,
  money,
  onConfigure,
}: {
  data: OrderReorderPreview;
  money: (value: string) => string;
  onConfigure: (line: OrderReorderLine) => void;
}) {
  const t = useTranslations('reorder');
  const groups = groupLines(data);
  const sections = [
    ['AVAILABLE', groups.available],
    ['NEEDS_CONFIGURATION', groups.needsConfiguration],
    ['UNAVAILABLE', groups.unavailable],
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      {sections.map(([status, lines]) =>
        lines.length === 0 ? null : (
          <section
            key={status}
            aria-labelledby={`reorder-${status}`}
            data-testid={`group-${status}`}
          >
            <h3
              id={`reorder-${status}`}
              className={cn(
                'mb-1.5 flex items-center gap-1.5 text-[14px] font-extrabold',
                STATUS_TONE[status],
                status === 'NEEDS_CONFIGURATION' && 'w-fit rounded-lg bg-accent-soft px-2 py-1',
              )}
            >
              {(() => {
                const Icon = STATUS_ICON[status];
                return <Icon className="h-4 w-4 flex-none" aria-hidden="true" />;
              })()}
              {t(`sections.${status}`, { a: lines.length })}
            </h3>
            <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface p-0">
              {lines.map((line) => (
                <LineRow key={line.lineNo} line={line} money={money} onConfigure={onConfigure} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function issueText(t: ReturnType<typeof useTranslations>, issue: OrderReorderIssue): string {
  const code = KNOWN_ISSUES.has(issue.code) ? issue.code : 'unknown';
  return t(`issue.${code}`, {
    a: issue.optionName ?? issue.groupName ?? '',
    from: issue.from ?? '',
    to: issue.to ?? '',
  });
}

function LineRow({
  line,
  money,
  onConfigure,
}: {
  line: OrderReorderLine;
  money: (value: string) => string;
  onConfigure: (line: OrderReorderLine) => void;
}) {
  const t = useTranslations('reorder');
  const name = line.candidate?.display.name ?? line.original.productName;
  const quantity = line.candidate?.line.quantity ?? line.original.quantity;
  const change = priceChangeOf(line);
  const issues = displayIssues(line);
  const unavailable = line.status === 'UNAVAILABLE';
  return (
    <li
      className="flex flex-col gap-1.5 px-3.5 py-2.5"
      data-testid="reorder-line"
      data-status={line.status}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className={cn('block font-bold', unavailable && 'line-through opacity-70')}>
            {quantity}× {name}
          </span>
          {line.candidate?.display.options.length ? (
            <span className="block text-[12px] text-muted">
              {line.candidate.display.options.map((o) => o.optionName).join(' · ')}
            </span>
          ) : null}
          {line.candidate?.note ? (
            <span className="block text-[12px] text-muted">{line.candidate.note}</span>
          ) : null}
        </span>
        <span className="flex-none text-[13px] font-extrabold">{t(`status.${line.status}`)}</span>
      </div>
      {change ? (
        <p
          className="m-0 w-fit rounded-md bg-accent-soft px-2 py-0.5 text-[12px] font-bold text-fg"
          data-testid="price-change"
        >
          {t('priceChanged', { a: money(change.previous), b: money(change.current) })}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="m-0 list-none p-0 text-[12px] text-muted">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>{issueText(t, issue)}</li>
          ))}
        </ul>
      ) : null}
      {line.status === 'NEEDS_CONFIGURATION' && line.candidate ? (
        <button
          type="button"
          className="btn !min-h-[44px] self-start text-sm"
          aria-label={t('configureAria', { a: name })}
          onClick={() => onConfigure(line)}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" /> {t('configure')}
        </button>
      ) : null}
    </li>
  );
}

function CartChoice({
  plan,
  mode,
  branchName,
  onMode,
}: {
  plan: ReturnType<typeof planMerge>;
  mode: MergeMode;
  branchName: string;
  onMode: (mode: MergeMode) => void;
}) {
  const t = useTranslations('reorder.cart');
  if (plan.situation === 'empty') return null;
  if (plan.situation === 'other-branch') {
    return (
      <p className="notice m-0" data-testid="cart-other-branch">
        <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        <span>{t('otherBranch', { a: branchName })}</span>
      </p>
    );
  }
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="lbl">{t('legend')}</legend>
      <div className="grid gap-2">
        {plan.modes.map((value) => (
          <label
            key={value}
            className={cn(
              'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3.5',
              mode === value ? 'border-secondary bg-secondary-soft' : 'border-line bg-surface',
            )}
          >
            <input
              type="radio"
              name="reorder-merge"
              className="h-5 w-5 accent-[rgb(var(--secondary))]"
              checked={mode === value}
              onChange={() => onMode(value)}
            />
            <span className="font-bold">{t(value)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
