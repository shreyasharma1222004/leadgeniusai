import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
import {
  BarChart3,
  Bot,
  CalendarClock,
  House,
  Inbox,
  Kanban,
  Plug,
  Plus,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Building2 } from "lucide-react";

/** Global command center (⌘K). Registered once in AppShell. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const leads = useQuery(api.leads.list, {}) ?? [];

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="depth-pop">
      <CommandInput placeholder="What do you want to do?" />
      <CommandEmpty>No results — try a lead's name or a page.</CommandEmpty>
      <CommandGroup heading="AI actions">
        <CommandItem onSelect={() => go("/research")}>
          <Sparkles className="size-4 text-muted-foreground" />
          <span>Research a lead</span>
        </CommandItem>
        <CommandItem onSelect={() => go("/assistant")}>
          <Bot className="size-4 text-muted-foreground" />
          <span>Ask the AI Copilot</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Create">
        <CommandItem onSelect={() => go("/leads?new=1")}>
          <Plus className="size-4" /> Add a lead
        </CommandItem>
        <CommandItem onSelect={() => go("/campaigns")}>
          <Target className="size-4" /> Start a campaign
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Navigate">
        <CommandItem onSelect={() => go("/dashboard")}>
          <House className="size-4" /> Dashboard
        </CommandItem>
        <CommandItem onSelect={() => go("/leads")}>
          <Users className="size-4" /> Leads
        </CommandItem>
        <CommandItem onSelect={() => go("/pipeline")}>
          <Kanban className="size-4" /> Pipeline
        </CommandItem>
        <CommandItem onSelect={() => go("/inbox")}>
          <Inbox className="size-4" /> Inbox
        </CommandItem>
        <CommandItem onSelect={() => go("/tasks")}>
          <CalendarClock className="size-4" /> Tasks
        </CommandItem>
        <CommandItem onSelect={() => go("/analytics")}>
          <BarChart3 className="size-4" /> Analytics
        </CommandItem>
        <CommandItem onSelect={() => go("/integrations")}>
          <Plug className="size-4" /> Integrations
        </CommandItem>
      </CommandGroup>
      {leads.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Open lead">
            {leads.slice(0, 6).map((l) => (
              <CommandItem key={l._id} value={`lead ${l.name} ${l.company ?? ""}`} onSelect={() => go(`/leads/${l._id}`)}>
                <Building2 className="size-4 text-muted-foreground" />
                <span>{l.name}</span>
                {l.company && <span className="ml-1 text-xs text-muted-foreground">{l.company}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </CommandDialog>
  );
}
