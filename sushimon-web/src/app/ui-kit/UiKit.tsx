'use client';

import { Plus, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { FOOD_ART_KINDS, FoodArt } from '@/components/art/FoodArt';
import { Logo } from '@/components/brand/Logo';
import { BO_NAV_ICONS, BoLogo, BoProductArt, IconPlus } from '@/components/icons/bo';
import * as BoIcons from '@/components/icons/bo/icons';
import { Instagram } from '@/components/icons/store/Instagram';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import {
  Banner,
  BottomSheet,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  EmptyState,
  IconButton,
  Kpi,
  Modal,
  Pill,
  Price,
  SearchInput,
  SegmentedControl,
  SimulationBadge,
  Skeleton,
  Spinner,
  StatusPill,
  Switch,
  Tabs,
  ToastProvider,
  useToast,
  type PillTone,
  type Zone,
} from '@/components/ui';
import { LocaleToggle } from '@/i18n/LocaleToggle';

const TONES: PillTone[] = [
  'alert',
  'confirmed',
  'warning',
  'info',
  'active',
  'success',
  'danger',
  'muted',
];
const STORE_SWATCHES = [
  'bg-bg',
  'bg-surface',
  'bg-subtle',
  'bg-fg',
  'bg-muted',
  'bg-line',
  'bg-primary',
  'bg-primary-soft',
  'bg-secondary',
  'bg-secondary-soft',
  'bg-accent',
  'bg-accent-soft',
  'bg-deep',
  'bg-success',
  'bg-success-soft',
  'bg-danger',
  'bg-danger-soft',
];
const BO_ICON_NAMES = Object.keys(BoIcons).filter((k) =>
  k.startsWith('Icon'),
) as (keyof typeof BoIcons)[];

function Section({ title, children, zone }: { title: string; children: ReactNode; zone: Zone }) {
  return (
    <section
      className={zone === 'bo' ? 'card' : 'panel'}
      style={zone === 'bo' ? { padding: 20 } : undefined}
    >
      <h2 className={zone === 'bo' ? 'sect-t' : 'disp text-[22px]'}>{title}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function ZoneDemo({ zone }: { zone: Zone }) {
  const t = useTranslations('uiKit');
  const { notify } = useToast();
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sw, setSw] = useState(true);
  const [seg, setSeg] = useState<'delivery' | 'pickup'>('delivery');
  const [tab, setTab] = useState<'all' | 'active' | 'done'>('all');
  const [q, setQ] = useState('');

  return (
    <div className="flex flex-col gap-4">
      <Section zone={zone} title={t('buttons')}>
        <Button zone={zone}>{t('sample')}</Button>
        <Button
          zone={zone}
          variant="primary"
          icon={<Plus className="h-5 w-5" aria-hidden="true" />}
        >
          {t('sample')}
        </Button>
        <Button zone={zone} variant="dark">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="ghost">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="outline">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="danger">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="green">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="primary" size="sm">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="primary" size="lg">
          {t('sample')}
        </Button>
        <Button zone={zone} variant="primary" loading>
          {t('sample')}
        </Button>
        <Button zone={zone} disabled>
          {t('sample')}
        </Button>
        <Button zone={zone} variant="link">
          {t('sample')}
        </Button>
        <IconButton zone={zone} label={t('sample')}>
          {zone === 'bo' ? <IconPlus /> : <ShoppingBag className="h-5 w-5" aria-hidden="true" />}
        </IconButton>
      </Section>

      <Section zone={zone} title={t('cards')}>
        {zone === 'bo' ? (
          <Card zone="bo" className="w-full">
            <CardHeader
              title={t('sample')}
              actions={
                <Button zone="bo" size="sm">
                  {t('sample')}
                </Button>
              }
            />
            <CardBody>{t('sampleBody')}</CardBody>
          </Card>
        ) : (
          <>
            <Card className="w-56">
              <div className="tile tile-coral flex h-36 items-center justify-center">
                <FoodArt kind="roll" className="h-[82%] w-auto" />
              </div>
              <div className="flex flex-col gap-1 p-4">
                <strong>{t('sample')}</strong>
                <Price value={85} previous={95} />
              </div>
            </Card>
            <Card variant="panel" className="w-56">
              <span className="eyebrow text-primary">{t('sample')}</span>
              <p className="m-0 text-sm text-muted">{t('sampleBody')}</p>
            </Card>
            <div className="seigaiha seigaiha-coral flex h-36 w-56 items-center justify-center rounded-2xl">
              <span className="disp text-outline text-[34px]">MON</span>
            </div>
            <span className="hanko h-16 w-16 text-[22px]">寿司</span>
          </>
        )}
      </Section>

      <Section zone={zone} title={t('pills')}>
        {TONES.map((tone) => (
          <StatusPill key={tone} zone={zone} tone={tone}>
            {tone}
          </StatusPill>
        ))}
        <Pill zone={zone} tone="success">
          {t('available')}
        </Pill>
        <SimulationBadge zone={zone} />
        <SimulationBadge zone={zone} kind="demo" />
      </Section>

      <Section zone={zone} title={t('controls')}>
        <Switch zone={zone} checked={sw} onCheckedChange={setSw} label={t('available')} />
        <Switch
          zone={zone}
          checked={false}
          mixed
          onCheckedChange={() => {}}
          label={t('available')}
        />
        <SegmentedControl
          zone={zone}
          label={t('controls')}
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'delivery', label: t('seg.delivery') },
            { value: 'pickup', label: t('seg.pickup') },
          ]}
        />
        <Tabs
          zone={zone}
          label={t('controls')}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'all', label: t('tabs.all'), count: 15 },
            { value: 'active', label: t('tabs.active'), count: 6 },
            { value: 'done', label: t('tabs.done'), count: 0 },
          ]}
        />
        <SearchInput zone={zone} inline value={q} onValueChange={setQ} placeholder={t('sample')} />
      </Section>

      <Section zone={zone} title={t('feedback')}>
        <div className="flex w-full flex-col gap-2">
          {(['info', 'warning', 'danger', 'success', 'neutral', 'alert'] as const).map((tone) => (
            <Banner key={tone} zone={zone} tone={tone}>
              {t('banner')}
            </Banner>
          ))}
        </div>
        {zone === 'bo' ? (
          <div className="kpis w-full">
            <Kpi highlight label={t('kpi.sales')} value="Q4,820" foot={t('kpi.delta')} />
            <Kpi label={t('kpi.orders')} value="15" tone="amber" foot={t('kpi.delta')} />
            <Kpi label={t('status.ready')} value="3" tone="violet" />
          </div>
        ) : null}
        <Spinner zone={zone} />
        <Skeleton zone={zone} className="h-5 w-40" />
        <Skeleton zone={zone} className="h-16 w-16 rounded-full" />
        <div className="w-full">
          <EmptyState zone={zone} title={t('sample')} description={t('emptyBody')} compact />
        </div>
      </Section>

      <Section zone={zone} title={t('overlays')}>
        <Button zone={zone} onClick={() => setModal(true)}>
          {t('openModal')}
        </Button>
        {zone === 'store' ? (
          <Button zone={zone} onClick={() => setSheet(true)}>
            {t('openSheet')}
          </Button>
        ) : null}
        <Button zone={zone} onClick={() => setDrawer(true)}>
          {t('openDrawer')}
        </Button>
        <Button zone={zone} onClick={() => notify(t('toastText'))}>
          {t('showToast')}
        </Button>
      </Section>

      <Modal
        zone={zone}
        open={modal}
        onClose={() => setModal(false)}
        title={t('modalTitle')}
        icon={zone === 'bo' ? <BoIcons.IconClose /> : undefined}
        description={zone === 'bo' ? t('sampleBody') : undefined}
        footer={
          <Button zone={zone} variant="primary" block onClick={() => setModal(false)}>
            {t('sample')}
          </Button>
        }
      >
        <p>{t('sampleBody')}</p>
      </Modal>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={t('sheetTitle')}>
        <p>{t('sampleBody')}</p>
      </BottomSheet>
      <Drawer
        zone={zone}
        open={drawer}
        onClose={() => setDrawer(false)}
        title={t('drawerTitle')}
        eyebrow={zone === 'bo' ? t('sample') : undefined}
        footer={
          <Button zone={zone} variant="primary" block>
            {t('sample')}
          </Button>
        }
      >
        <div className="p-5">{t('sampleBody')}</div>
      </Drawer>
    </div>
  );
}

export function UiKit() {
  const t = useTranslations('uiKit');
  return (
    <div className="min-h-dvh">
      <header data-zone="store" className="wrap flex flex-wrap items-center gap-3 py-5">
        <Logo priority />
        <h1 className="disp text-[28px]">{t('title')}</h1>
        <span className="flex-1" />
        <LocaleToggle />
        <ThemeToggle />
      </header>
      <p data-zone="store" className="wrap m-0 text-sm text-muted">
        {t('intro')}
      </p>

      <div className="grid gap-6 py-6 xl:grid-cols-2">
        <div data-zone="store" className="wrap flex flex-col gap-4 xl:pr-0">
          <h2 className="disp text-[32px] text-primary">{t('store')}</h2>
          <ToastProvider zone="store">
            <ZoneDemo zone="store" />
          </ToastProvider>
          <section className="panel">
            <h2 className="disp text-[22px]">{t('tokens')}</h2>
            <div className="flex flex-wrap gap-2">
              {STORE_SWATCHES.map((c) => (
                <span key={c} className="flex flex-col items-center gap-1 text-[11px] text-muted">
                  <span className={`h-10 w-10 rounded-lg border border-line ${c}`} />
                  {c.replace('bg-', '')}
                </span>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2 className="disp text-[22px]">{t('art')}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {FOOD_ART_KINDS.map((k, i) => (
                <figure
                  key={k}
                  className={`tile ${['tile-coral', 'tile-blue', 'tile-sky', 'tile-cream'][i % 4]} m-0 flex flex-col items-center rounded-xl p-2`}
                >
                  <FoodArt kind={k} className="h-16 w-16" />
                  <figcaption className="text-[11px] font-bold">{k}</figcaption>
                </figure>
              ))}
            </div>
            <div className="flex gap-3">
              <Instagram className="h-6 w-6" />
              <div className="bg-deep rounded-xl p-3">
                <Logo onDark size="footer" />
              </div>
            </div>
          </section>
        </div>

        <div data-zone="bo" style={{ minHeight: 0, padding: 16 }}>
          <div className="flex flex-col gap-4">
            <h2 className="page-h disp" style={{ fontSize: 32 }}>
              {t('backoffice')}
            </h2>
            <ToastProvider zone="bo">
              <ZoneDemo zone="bo" />
            </ToastProvider>
            <Section zone="bo" title={t('icons')}>
              {BO_ICON_NAMES.map((name) => {
                const Icon = BoIcons[name] as (p: { size?: 'sm' | 'md' }) => ReactNode;
                return (
                  <span key={name} title={name} className="row gap6 xs muted">
                    <Icon />
                    {name.replace('Icon', '')}
                  </span>
                );
              })}
              <span className="row gap6">
                {Object.entries(BO_NAV_ICONS).map(([k, Icon]) => (
                  <Icon key={k} />
                ))}
              </span>
              <span style={{ color: 'var(--bo-primary)', width: 180 }}>
                <BoLogo style={{ width: '100%', height: 'auto' }} />
              </span>
            </Section>
            <Section zone="bo" title={t('art')}>
              {(['roll', 'dumpling', 'soup', 'drink', 'dessert'] as const).map((k) => (
                <span key={k} className="row gap8">
                  <span className="pimg tile-coral" style={{ width: 96, height: 96 }}>
                    <BoProductArt kind={k} />
                  </span>
                  <span className="thumb tile-beige">
                    <BoProductArt kind={k} variant="thumb" />
                  </span>
                </span>
              ))}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
