'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BO_NAV_ICONS,
  BoLogo,
  IconChevronDown,
  IconLock,
  IconLogOut,
  IconMapPin,
} from '@/components/icons/bo';
import { cn } from '@/lib/cn';
import { useDemoSession } from '@/features/session/demo-session';
import { LOGIN_PATH, navForRole, screenFromPath, screenHref } from './nav';
import { branchShortName, useShell } from './shell-context';
import { avatarStyle, staffInitials } from './staff-display';
import { PopoverRoot, usePopover } from './use-popover';

/** Barra lateral: marca, selector de sucursal, navegación por rol (con badge de pedidos nuevos) y usuario. */
export function Sidebar({ newCount }: { newCount: number }) {
  const t = useTranslations('backoffice');
  const router = useRouter();
  const pathname = usePathname();
  const shell = useShell();
  const { staff, signOutStaff } = useDemoSession();
  const sections = navForRole(shell.role);
  const current = screenFromPath(pathname);
  const staffBranch = staff?.branchId ? shell.branchById(staff.branchId)?.name : undefined;
  const staffBranchLabel = staffBranch ?? staff?.branchId ?? t('shell.allBranches');

  const logout = () => {
    signOutStaff();
    router.replace(LOGIN_PATH);
  };

  return (
    <aside className={cn('sidebar', shell.mobileNavOpen && 'open')}>
      <div className="brand">
        <div className="brand-logo">
          <BoLogo className="logo-full" />
          <span className="bo-tag">{t('shell.brandTag')}</span>
        </div>
      </div>
      <BranchSelector />
      <nav className="nav" aria-label={t('nav.label')}>
        {sections.map((section) => (
          <Fragment key={section.key}>
            <div className="nav-label">{t(`nav.sections.${section.key}`)}</div>
            {section.items.map((item) => {
              const Icon = BO_NAV_ICONS[item.icon];
              const active = current === item.screen;
              const badge = item.screen === 'pedidos' && newCount > 0 ? newCount : null;
              return (
                <Link
                  key={item.screen}
                  href={screenHref(item.screen)}
                  className={cn('nav-item no-underline', active && 'active')}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => shell.setMobileNavOpen(false)}
                >
                  <Icon />
                  <span className="nav-text">{t(`nav.items.${item.screen}`)}</span>
                  {badge ? <span className="nav-badge">{badge}</span> : null}
                </Link>
              );
            })}
          </Fragment>
        ))}
      </nav>
      {staff ? (
        <div className="side-foot">
          <div className="avatar" style={avatarStyle(staff.role)} aria-hidden="true">
            {staffInitials(staff.name)}
          </div>
          <div className="admin-info">
            <div className="strong trunc" style={{ fontSize: 13.5 }}>
              {staff.name}
            </div>
            <div className="muted xs trunc" style={{ fontWeight: 700 }}>
              {t(`roles.${staff.role}`)} · {staffBranchLabel}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('shell.logout')}
            title={t('shell.logout')}
            onClick={logout}
          >
            <IconLogOut />
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function BranchSelector() {
  const t = useTranslations('backoffice.shell');
  const shell = useShell();
  const popover = usePopover();
  const current = shell.branchId ? shell.branchById(shell.branchId) : undefined;
  const label = !shell.branchId
    ? t('allBranches')
    : current
      ? `${current.name} · ${branchShortName(current)}`
      : shell.branchId;
  const open = shell.branches.filter((b) => b.isOpen).length;

  return (
    <PopoverRoot className="side-br" open={popover.open} onDismiss={popover.close}>
      <div className="nav-label" style={{ paddingTop: 0 }}>
        {t('branchLabel')}
      </div>
      {shell.branchLocked ? (
        <span className="brsel-btn static" title={t('branchAssigned')}>
          <IconLock size="sm" />
          <span className="trunc">{label}</span>
        </span>
      ) : (
        <>
          <button
            type="button"
            className="brsel-btn"
            aria-haspopup="true"
            aria-expanded={popover.open}
            aria-label={`${t('branchSelector')}: ${label}`}
            onClick={popover.toggle}
          >
            <IconMapPin size="sm" />
            <span className="trunc grow" style={{ textAlign: 'left' }}>
              {label}
            </span>
            <IconChevronDown size="sm" />
          </button>
          {popover.open ? (
            <div className="menu-pop">
              <button
                type="button"
                className={cn('menu-item', !shell.branchId && 'on')}
                onClick={() => {
                  shell.setBranchId(undefined);
                  popover.close();
                }}
              >
                <span className="grow">{t('allBranches')}</span>
                <span className="xs muted" style={{ fontWeight: 700 }}>
                  {t('branchesOpen', { open, total: shell.branches.length })}
                </span>
              </button>
              {shell.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn('menu-item', shell.branchId === b.id && 'on')}
                  onClick={() => {
                    shell.setBranchId(b.id);
                    popover.close();
                  }}
                >
                  <span className="grow">{b.name}</span>
                  <span className="xs muted" style={{ fontWeight: 700 }}>
                    {branchShortName(b)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </PopoverRoot>
  );
}
