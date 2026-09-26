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
import logo from "@/assets/logo.svg";
import {
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  ChevronLeft,
  Inbox,
  Kanban,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Search,
  Sparkles,
  Target,
  User,
  Users,
  BookMarked,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { CommandPalette } from "@/components/CommandPalette";
import { AmbientLayer } from "@/components/AmbientLayer";

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
  const reduced = useReducedMotion();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6 px-3">
      {NAV.map((group) => (
        <div key={group.section}>
          {!collapsed && (
            <p className="label-caps text-muted-foreground/60 px-2 pb-2">{group.section}</p>
          )}
          {collapsed && <div className="mx-2 mb-2 h-px bg-border" />}
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-all",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "nav-pill-active font-medium"
                          : "text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <motion.span
                          whileHover={reduced ? undefined : { x: 1.5 }}
                          transition={{ type: "spring", stiffness: 400, damping: 20 }}
                          className="flex shrink-0"
                        >
                          <Icon className={cn("size-4", isActive && "text-[#f7f3ea]")} />
                        </motion.span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {isActive && (
                          <motion.span
                            layoutId="nav-underline"
                            className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#191713]"
                            transition={{ type: "spring", stiffness: 350, damping: 30 }}
                          />
                        )}
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

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const name = user?.name ?? "Guest";
  const email = user?.email ?? "guest workspace";
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <div className={cn("border-t border-border px-3 py-3", collapsed && "flex justify-center px-0")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent p-1.5 transition-all hover:border-border hover:bg-secondary",
              collapsed && "w-auto",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-[#191713] text-[11px] font-semibold text-[#f7f3ea]">
              {initial}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1 text-left leading-tight">
                <span className="block truncate text-xs font-medium">{name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{email}</span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="depth-pop w-52">
          <DropdownMenuLabel className="text-xs">
            {name}
            <span className="block truncate font-normal text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/contacts")}>
            <User className="size-3.5" /> Workspace
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
          className="relative flex size-8 cursor-pointer items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-all hover:border-border hover:bg-secondary hover:text-foreground"
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#191713] text-[9px] font-semibold text-[#f7f3ea]">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="depth-pop w-80">
        <p className="label-caps px-3 pb-1 pt-2 text-muted-foreground/70">Today</p>
        {unread.slice(0, 3).map((m) => (
          <DropdownMenuItem
            key={m._id}
            onClick={() => {
              setOpen(false);
              navigate(`/leads/${m.leadId}`);
            }}
            className="cursor-pointer gap-2"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-[#191713]" />
            <span className="truncate text-xs">
              <span className="font-medium">{leadName(m.leadId)}</span> replied to your message
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
            All clear — nothing needs your attention.
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
        "flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 transition-colors focus-within:border-[#191713]/50",
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const reduced = useReducedMotion();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <AmbientLayer />

      {/* Desktop sidebar — floating control panel */}
      <motion.aside
        animate={{ width: collapsed ? 60 : 236 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        className="sticky top-0 z-20 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar md:flex"
      >
        <div className={cn("flex h-14 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
          <img src={logo} alt="DealFlow AI" className="size-7 rounded-md" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.18 }}
                className="whitespace-nowrap text-sm font-semibold tracking-tight"
              >
                DealFlow<span className="font-normal text-muted-foreground"> AI</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavList collapsed={collapsed} />
        </div>
        <UserMenu collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-16 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-[#191713]/50 hover:text-foreground"
        >
          <ChevronLeft className={cn("size-3.5 transition-transform duration-300", collapsed && "rotate-180")} />
        </button>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile brand + drawer */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-border bg-sidebar p-0">
                <SheetTitle className="flex h-14 items-center gap-2 border-b border-border px-4 text-sm font-semibold">
                  <img src={logo} alt="" className="size-7 rounded-md" />
                  DealFlow<span className="font-normal text-muted-foreground"> AI</span>
                </SheetTitle>
                <div className="flex h-[calc(100%-3.5rem)] flex-col">
                  <div className="flex-1 overflow-y-auto py-4">
                    <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
                  </div>
                  <UserMenu collapsed={false} />
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
              className="hidden size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-secondary sm:flex"
            >
              <Bot className="size-4" />
            </button>
            <NotificationsButton />
            <kbd className="ml-1 hidden items-center gap-0.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground lg:flex">
              ⌘K
            </kbd>
          </div>
        </header>

        {/* Workspace plane */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
          <motion.div
            key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight md:hidden">{title}</h1>
            </div>
            {children}
          </motion.div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

