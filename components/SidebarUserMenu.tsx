"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useI18n } from "@/hooks/useI18n";

export type SidebarUser = {
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
};

function DefaultUserIcon() {
  return <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M6 20a6 6 0 0 1 12 0" /></svg>;
}

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function LogoutIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>;
}

export function SidebarUserMenu({ user }: { user: SidebarUser | null }) {
  const { t } = useI18n();
  const name = user?.name || t("account.loading");
  const email = user?.email || t("account.emailUnavailable");
  const handleLogout = async () => {
    try {
      await fetch("/api/marketplace-auth/logout", { method: "POST" });
    } finally {
      window.location.replace("/login");
    }
  };

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger render={<SidebarMenuButton type="button" title={name}>
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" /> : <DefaultUserIcon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-5">{name}</span>
                <span className="block truncate text-xs leading-4 text-[var(--text-muted)]">{email}</span>
              </span>
              <svg className="size-4 shrink-0 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </SidebarMenuButton>} />
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[var(--anchor-width)] min-w-52 bg-[var(--bg-panel)] text-[var(--text)]">
              <div className="flex items-center gap-2 px-2 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                  {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" /> : <DefaultUserIcon />}
                </span>
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-[var(--text-muted)]">{email}</span></span>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => undefined}><SettingsIcon />{t("account.settings")}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void handleLogout()}><LogoutIcon />{t("account.logout")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
