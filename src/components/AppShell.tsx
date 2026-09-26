import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarClock,
  Inbox,
  Kanban,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Search,
  Send,
  Sparkles,
  Target,
  User,
  Users,
  BookMarked,
  House,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { CommandPalette } from "@/components/CommandPalette";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { label: "Dashboard", icon: House, to: "/dashboard" },
      { label: "AI Copilot", icon: Bot, to: "/assistant" },
      { label: "Business", icon: Building2, to: "/business" },
    ],
  },
  {
    section: "Find",
    items: [
      { label: "Leads", icon: Users, to: "/leads" },
      { label: "Research", icon: Sparkles, to: "/research" },
      { label: "Contacts", icon: LayoutGrid, to: "/contacts" },
    ],
  },
  {
    section: "Sell",
    items: [
      { label: "Outreach", icon: Send, to: "/campaigns" },
      { label: "Inbox", icon: Inbox, to: "/inbox" },
      { label: "Campaigns", icon: Target, to: "/campaigns" },
      { label: "Pipeline", icon: Kanban, to: "/pipeline" },
    ],
  },
  {
    section: "Operate",
    items: [
      { label: "Tasks", icon: CalendarClock, to: "/tasks" },
      { label: "Analytics", icon: BarChart3, to: "/analytics" },
      { label: "Templates", icon: BookMarked, to: "/templates" },
      { label: "Integrations", icon: Plug, to: "/integrations" },
    ],
  },
];

// Bottom navigation for mobile — the five most-used destinations.
const MOBILE_NAV: NavItem[] = [
  { label: "Home", icon: House, to: "/dashboard" },
  { label: "Leads", icon: Users, to: "/leads" },
  { label: "Pipeline", icon: Kanban, to: "/pipeline" },
  { label: "Inbox", icon: Inbox, to: "/inbox" },
  { label: "Tasks", icon: CalendarClock, to: "/tasks" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const reduced = useReducedMotion();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6 px-3">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="label-caps px-2 pb-2 text-[#f5f0e6]/35">{group.section}</p>
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
                        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-[#1e1d19] font-medium text-[#f5f0e6]"
                          : "text-[#f5f0e6]/55 hover:bg-[#1e1d19]/60 hover:text-[#f5f0e6]",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="nav-indicator"
                            transition={
                              reduced
                                ? { duration: 0 }
                                : { type: "spring", stiffness: 380, damping: 32 }
                            }
                            aria-hidden
                            className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[#a06b3c]"
                          />
                        )}
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
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

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const name = user?.name ?? "Guest";
  const email = user?.email ?? "guest workspace";
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <div className="border-t border-[#f5f0e6]/8 px-3 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-[#1e1d19]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#f5f0e6]/15 bg-[#1e1d19] text-[11px] font-semibold text-[#f5f0e6]">
              {initial}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-xs font-medium text-[#f5f0e6]">{name}</span>
              <span className="block truncate text-[11px] text-[#f5f0e6]/45">{email}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="depth-pop w-52">
          <DropdownMenuLabel className="text-xs">
            {name}
            <span className="block truncate font-normal text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/dashboard")}>
            <User className="size-3.5" /> Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/integrations")}>
            <Plug className="size-3.5" /> Settings & integrations
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="size-3.5" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const messages = useQuery(api.messages.listForUser, {}) ?? [];
  const followUps = useQuery(api.followUps.listForUser, {}) ?? [];
  const leads = useQuery(api.leads.list, {}) ?? [];

  const unread = messages.filter((m) => m.direction === "received" && !m.readAt);
  const now = Date.now();
  const due = followUps.filter((f) => f.status === "pending" && f.dueAt < now);
  const leadName = (id: string) => leads.find((l) => l._id === id)?.name ?? "a lead";
  const count = unread.length + due.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#6f4b5e] text-[9px] font-semibold text-[#f5f0e6]">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="depth-pop w-80">
        <p className="label-caps px-3 pb-1 pt-2 text-muted-foreground">Today</p>
        {unread.slice(0, 3).map((m) => (
          <DropdownMenuItem
            key={m._id}
            onClick={() => {
              setOpen(false);
              navigate(`/leads/${m.leadId}`);
            }}
            className="cursor-pointer gap-2"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-[#6f4b5e]" />
            <span className="truncate text-xs">
              <span className="font-medium">{leadName(m.leadId)}</span> replied
            </span>
          </DropdownMenuItem>
        ))}
        {due.slice(0, 3).map((f) => (
          <DropdownMenuItem
            key={f._id}
            onClick={() => {
              setOpen(false);
              navigate(`/leads/${f.leadId}`);
            }}
            className="cursor-pointer gap-2"
          >
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs">
              Follow up with <span className="font-medium">{leadName(f.leadId)}</span> is due
            </span>
          </DropdownMenuItem>
        ))}
        {count === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            You're clear for today.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandableSearch() {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const submit = () => {
    if (q.trim()) navigate(`/leads?q=${encodeURIComponent(q.trim())}`);
    setExpanded(false);
    setQ("");
  };

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 transition-colors focus-within:border-[#6f4b5e]/60",
        expanded ? "w-64" : "w-36 cursor-pointer",
      )}
      onClick={() => !expanded && setExpanded(true)}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      {expanded ? (
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setExpanded(false);
          }}
          onBlur={() => !q && setExpanded(false)}
          placeholder="Search leads, companies, campaigns…"
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <span className="text-xs text-muted-foreground">Search</span>
      )}
      {expanded && (
        <kbd className="hidden shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground sm:block">
          ↵
        </kbd>
      )}
    </motion.div>
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — deep black tool rail */}
      <aside className="sticky top-0 z-20 hidden h-screen w-[232px] shrink-0 flex-col bg-[#0f0f0d] md:flex">
        <div className="flex h-14 items-center px-5">
          <span className="text-[13px] font-semibold tracking-[0.22em] text-[#f5f0e6]">
            DEALFLOW
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <NavList />
        </div>
        <UserMenu />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
        {/* Top bar — minimal */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile drawer */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-border bg-[#0f0f0d] p-0">
                <SheetTitle className="flex h-14 items-center border-b border-[#f5f0e6]/8 px-5 text-[13px] font-semibold tracking-[0.22em] text-[#f5f0e6]">
                  DEALFLOW
                </SheetTitle>
                <div className="flex h-[calc(100%-3.5rem)] flex-col">
                  <div className="flex-1 overflow-y-auto py-4">
                    <NavList onNavigate={() => setMobileOpen(false)} />
                  </div>
                  <UserMenu />
                </div>
              </SheetContent>
            </Sheet>
            <span className="hidden text-sm font-semibold tracking-tight md:block">{title}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <ExpandableSearch />
            </div>
            <button
              type="button"
              onClick={() => navigate("/assistant")}
              aria-label="Open AI Assistant"
              className="hidden size-8 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-[#6f4b5e] transition-colors hover:bg-secondary sm:flex"
            >
              <Bot className="size-4" />
            </button>
            <NotificationsButton />
          </div>
        </header>

        {/* Workspace */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight md:hidden">{title}</h1>
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
          </motion.div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch justify-around border-t border-border bg-card md:hidden"
      >
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
                  isActive ? "font-medium text-foreground" : "text-muted-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <CommandPalette />
    </div>
  );
}
