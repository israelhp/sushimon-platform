'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  IconBag,
  IconBell,
  IconCalendar,
  IconMenu,
  IconVolume,
  IconZap,
} from '@/components/icons/bo';
import { useToast } from '@/components/ui/Toast';
import { useOrderDetail } from '@/features/bo-orders/order-detail-context';
import { orderCode, sortForColumn } from '@/features/bo-orders/order-view';
import { useOrderText } from '@/features/bo-orders/use-order-text';
import { useScopedOrders } from '@/features/bo-orders/use-scoped-orders';
import { useAuth } from '@/features/session/auth-provider';
import { useDemoSession } from '@/features/session/demo-session';
import { cn } from '@/lib/cn';
import type { StaffRole } from '@/lib/data-access/models';
import { STAFF_ROLES } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { ROLE_HOME } from '@/lib/permissions';
import { BoThemeButton } from './BoThemeButton';
import { LOGIN_PATH, screenFromPath, screenHref } from './nav';
import { branchShortName, useShell } from './shell-context';
import { avatarStyle, formatTopbarDate, staffInitials } from './staff-display';
import { useNow } from './use-now';
import { PopoverRoot, usePopover } from './use-popover';

/** Barra superior: título, fecha demo, pedido simulado, tema, notificaciones y menú de usuario. */
export function Topbar({ newCount }: { newCount: number }) {
  const t = useTranslations('backoffice');
  const pathname = usePathname();
  const shell = useShell();
  const now = useNow();
  const screen = screenFromPath(pathname);
  const branch = shell.branchId ? shell.branchById(shell.branchId) : undefined;
  const branchTitle = !shell.branchId
    ? t('shell.allBranches')
    : branch
      ? `${branch.name} · ${branch.zoneLabel}`
      : '';

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn bordered burger"
        aria-label={t('shell.openMenu')}
        aria-expanded={shell.mobileNavOpen}
        onClick={() => shell.setMobileNavOpen(true)}
      >
        <IconMenu />
      </button>
      <div className="crumb">
        <b className="trunc disp" style={{ fontSize: 20 }}>
          {screen ? t(`nav.items.${screen}`) : ''}
        </b>
        <span className="sm trunc hide-sm" style={{ fontWeight: 700 }}>
          · {branchTitle}
        </span>
      </div>
      <div className="tb-date">
        <IconCalendar />
        <span style={{ color: 'var(--bo-text)' }}>{now ? formatTopbarDate(now) : ''}</span>
      </div>
      {shell.ring && shell.soundOn ? (
        <span className="sound" role="status">
          <IconVolume />
          <span>{t('shell.ringing')}</span>
        </span>
      ) : null}
      <button
        type="button"
        className="btn sm"
        title={t('shell.demoOrderHint')}
        disabled={shell.simulating}
        onClick={shell.simulateOrder}
      >
        <IconZap />
        <span className="sim-label">{t('shell.demoOrder')}</span>
      </button>
      <BoThemeButton />
      <NotificationsMenu newCount={newCount} />
      <UserMenu />
    </header>
  );
}

function NotificationsMenu({ newCount }: { newCount: number }) {
  const t = useTranslations('backoffice.shell.notifications');
  const shell = useShell();
  const popover = usePopover();
  const detail = useOrderDetail();
  const orders = useScopedOrders();
  const now = useNow();
  const text = useOrderText();
  const fresh = sortForColumn(
    'nuevo',
    (orders.data ?? []).filter((o) => o.status === 'received'),
  );

  return (
    <PopoverRoot className="notif-wrap" open={popover.open} onDismiss={popover.close}>
      <button
        type="button"
        className={cn('icon-btn bordered', shell.ring && 'ringing')}
        aria-label={t('label', { count: newCount })}
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        <IconBell />
        {newCount > 0 ? <span className="dot-count">{newCount}</span> : null}
      </button>
      {popover.open ? (
        <div className="notif-panel">
          <div className="notif-h">
            <div className="grow">
              <div className="disp" style={{ fontSize: 16 }}>
                {t('title')}
              </div>
              <div className="muted xs" style={{ fontWeight: 700 }}>
                {t('pending', { count: newCount })}
              </div>
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() => shell.setSoundOn(!shell.soundOn)}
            >
              {shell.soundOn ? t('soundOn') : t('soundOff')}
            </button>
          </div>
          <div className="notif-list">
            {fresh.map((order) => (
              <button
                key={order.id}
                type="button"
                className="notif"
                onClick={() => {
                  popover.close();
                  detail.open(order.id);
                }}
              >
                <span className="notif-ic a-coral">
                  <IconBag />
                </span>
                <span className="grow">
                  <span className="strong" style={{ display: 'block', fontSize: 13.5 }}>
                    {t('item', { code: orderCode(order), client: order.customer.name })}
                  </span>
                  <span className="muted sm" style={{ display: 'block' }}>
                    {t('itemMeta', {
                      branch: branchShortName(shell.branchById(order.branchId), order.branchId),
                      type: text.typeLong(order),
                      total: formatMoney(order.total),
                    })}
                  </span>
                  <span className="xs" style={{ display: 'block', marginTop: 2, fontWeight: 700 }}>
                    {text.waitText(order, now)}
                  </span>
                </span>
              </button>
            ))}
            {fresh.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <div className="sm">{t('empty')}</div>
              </div>
            ) : null}
          </div>
          <div className="notif-foot">
            <button type="button" className="btn sm block" onClick={shell.simulateOrder}>
              {t('simulate')}
            </button>
          </div>
        </div>
      ) : null}
    </PopoverRoot>
  );
}

function UserMenu() {
  const t = useTranslations('backoffice');
  const router = useRouter();
  const toast = useToast();
  const popover = usePopover();
  const { staff, signInStaff, signOutStaff } = useDemoSession();
  const auth = useAuth();
  const real = auth.mode === 'supabase';
  if (!staff) return null;

  const switchRole = (role: StaffRole) => {
    signInStaff(role);
    popover.close();
    toast.notify(t('shell.roleChanged', { role: t(`roles.${role}`) }));
    router.push(screenHref(ROLE_HOME[role]));
  };
  const logout = () => {
    popover.close();
    signOutStaff();
    if (real) void auth.signOut();
    router.replace(LOGIN_PATH);
  };

  return (
    <PopoverRoot className="brsel" open={popover.open} onDismiss={popover.close}>
      <button
        type="button"
        className="avatar-btn"
        aria-haspopup="true"
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        <span className="avatar" style={avatarStyle(staff.role)} aria-hidden="true">
          {staffInitials(staff.name)}
        </span>
        <span className="sr-only">{t('shell.accountMenu')}</span>
      </button>
      {popover.open ? (
        <div className="menu-pop right">
          <div className="menu-head">
            <div className="strong">{staff.name}</div>
            <div className="xs muted" style={{ fontWeight: 700 }}>
              {t(`roles.${staff.role}`)}
            </div>
            <div className="xs muted">{staff.email}</div>
          </div>
          {/* Cambiar de rol es solo de la demostración: con sesión real el rol lo fija el servidor. */}
          {real ? null : (
            <>
              <div
                className="xs muted"
                style={{
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '.08em',
                  padding: '6px 12px 2px',
                }}
              >
                {t('shell.switchRole')}
              </div>
              {STAFF_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  className={cn('menu-item', staff.role === role && 'on')}
                  onClick={() => switchRole(role)}
                >
                  {t(`roles.${role}`)}
                </button>
              ))}
              <div className="menu-sep" />
            </>
          )}
          <button type="button" className="menu-item" onClick={logout}>
            {t('shell.logout')}
          </button>
        </div>
      ) : null}
    </PopoverRoot>
  );
}
