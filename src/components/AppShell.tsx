import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.svg";
import {
  BarChart3,
  Bot,
  CalendarClock,
  ChevronLeft,
  Inbox,
  Kanban,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Sparkles,
  Target,
  Users,
  BookMarked,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Workspace",
    items: [
      { label: "Leads", icon: Users, to: "/leads" },
      { label: "Pipeline", icon: Kanban, to: "/pipeline" },
      { label: "Campaigns", icon: Target, to: "/campaigns" },
      { label: "Inbox", icon: Inbox, to: "/inbox" },
      { label: "Tasks", icon: CalendarClock, to: "/tasks" },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { label: "AI Assistant", icon: Bot, to: "/assistant" },
      { label: "Lead Research", icon: Sparkles, to: "/research" },
      { label: "Analytics", icon: BarChart3, to: "/analytics" },
    ],
  },
  {
    section: "Management",
    items: [
      { label: "Contacts", icon: LayoutGrid, to: "/contacts" },
      { label: "Templates", icon: BookMarked, to: "/templates" },
      { label: "Integrations", icon: Plug, to: "/integrations" },
    ],
  },
];

function NavList({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6 px-3">
      {NAV.map((group) => (
        <div key={group.section}>
          {!collapsed && (
            <p className="label-caps text-muted-foreground/70 px-2 pb-2">
              {group.section}
            </p>
          )}
          {collapsed && <div className="mx-2 mb-2 h-px bg-border" />}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground",
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const name = user?.name ?? "Guest";
  const email = user?.email ?? "guest workspace";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border px-3 py-3",
        collapsed && "justify-center px-0",
      )}
    >
      <div
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background"
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
      {!collapsed && (
        <>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Sign out"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
          >
            <LogOut className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

export function AppShell({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2 px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <img src={logo} alt="DealFlow AI" className="size-7 rounded-md" />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight">
              DealFlow<span className="text-[#A9E813]"> AI</span>
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavList collapsed={collapsed} />
        </div>
        <UserMenu collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-16 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft
            className={cn("size-3.5 transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <img src={logo} alt="DealFlow AI" className="size-7 rounded-md" />
            <span className="text-sm font-semibold tracking-tight">
              DealFlow<span className="text-[#A9E813]"> AI</span>
            </span>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="flex h-14 items-center gap-2 border-b border-border px-4 text-sm font-semibold">
                <img src={logo} alt="" className="size-7 rounded-md" />
                DealFlow<span className="text-[#A9E813]"> AI</span>
              </SheetTitle>
              <div className="flex h-[calc(100%-3.5rem)] flex-col">
                <div className="flex-1 overflow-y-auto py-4">
                  <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
                </div>
                <UserMenu collapsed={false} />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {title}
            </h1>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
