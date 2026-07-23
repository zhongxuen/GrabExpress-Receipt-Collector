"use client";

import { useEffect, useMemo, useState } from "react";
import { format, startOfWeek, subDays, parse } from "date-fns";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DateRangeInput } from "@/lib/dateFilters";
import { resolveDateRange } from "@/lib/dateFilters";
import { cn } from "@/lib/utils";

type QuickKey = "all" | "today" | "yesterday" | "last7" | "week" | "month";
type Tab = "quick" | "custom" | "phrase";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Turns a Gmail query fragment like "after:2026/07/10 before:2026/07/20" into
 * human-readable text, e.g. "from 10 Jul 2026 to 19 Jul 2026". */
function describeGmailFragment(fragment: string): string {
  if (!fragment) return "all GrabExpress receipts";

  const afterMatch = /after:(\d{4}\/\d{2}\/\d{2})/.exec(fragment);
  const beforeMatch = /before:(\d{4}\/\d{2}\/\d{2})/.exec(fragment);

  const after = afterMatch ? parse(afterMatch[1], "yyyy/MM/dd", new Date()) : null;
  // Gmail's before: is exclusive, so subtract a day to show the inclusive end date.
  const before = beforeMatch
    ? subDays(parse(beforeMatch[1], "yyyy/MM/dd", new Date()), 1)
    : null;

  if (after && before) {
    return `receipts from ${format(after, "d MMM yyyy")} to ${format(before, "d MMM yyyy")}`;
  }
  if (after) return `receipts from ${format(after, "d MMM yyyy")} onward`;
  return "all GrabExpress receipts";
}

function quickInput(key: QuickKey, now: Date): DateRangeInput {
  switch (key) {
    case "all":
      return { mode: "all" };
    case "today":
      return { mode: "custom", from: iso(now), to: iso(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { mode: "custom", from: iso(y), to: iso(y) };
    }
    case "last7":
      return { mode: "custom", from: iso(subDays(now, 6)), to: iso(now) };
    case "week":
      return { mode: "custom", from: iso(startOfWeek(now, { weekStartsOn: 1 })), to: iso(now) };
    case "month":
      return { mode: "month", month: format(now, "yyyy-MM") };
  }
}

const QUICK_OPTIONS: { key: QuickKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "last7", label: "Last 7 days" },
  { key: "month", label: "This month" },
];

interface DateRangePickerProps {
  onChange: (input: DateRangeInput, isValid: boolean) => void;
}

export function DateRangePicker({ onChange }: DateRangePickerProps) {
  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<Tab>("quick");
  const [quickKey, setQuickKey] = useState<QuickKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [phrase, setPhrase] = useState("");

  const input: DateRangeInput = useMemo(() => {
    if (tab === "quick") return quickInput(quickKey, now);
    if (tab === "custom") return { mode: "custom", from: customFrom, to: customTo || undefined };
    return { mode: "phrase", phrase };
  }, [tab, quickKey, customFrom, customTo, phrase, now]);

  const validation = useMemo(() => {
    if (tab === "custom" && !customFrom) return { ok: false, message: "" };
    if (tab === "phrase" && !phrase.trim()) return { ok: false, message: "" };
    try {
      const resolved = resolveDateRange(input, now);
      return { ok: true, message: `Will search: ${describeGmailFragment(resolved.gmailQueryFragment)}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Invalid date range" };
    }
  }, [input, now, tab, customFrom, phrase]);

  useEffect(() => {
    onChange(input, validation.ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, validation.ok]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium">Date range</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              type="button"
              size="sm"
              variant={tab === "quick" && quickKey === opt.key ? "default" : "outline"}
              onClick={() => {
                setTab("quick");
                setQuickKey(opt.key);
              }}
            >
              {opt.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={tab === "custom" ? "default" : "outline"}
            onClick={() => setTab("custom")}
          >
            Custom range
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "phrase" ? "default" : "outline"}
            onClick={() => setTab("phrase")}
          >
            Free-form
          </Button>
        </div>
      </div>

      {tab === "custom" && (
        <div className="flex flex-wrap items-center gap-2 animate-fade-in">
          <DatePicker
            value={customFrom}
            onChange={setCustomFrom}
            placeholder="From date"
            disabledAfter={now}
            invalid={!customFrom}
            ariaLabel="From date"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <DatePicker
            value={customTo}
            onChange={setCustomTo}
            placeholder="To date (optional)"
            disabledAfter={now}
            ariaLabel="To date"
          />
        </div>
      )}

      {tab === "phrase" && (
        <div className="animate-fade-in">
          <Input
            placeholder='e.g. "last 90 days", "this month", "2025"'
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            invalid={!validation.ok && phrase.trim().length > 0}
          />
        </div>
      )}

      {validation.message && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm animate-fade-in",
            validation.ok ? "text-muted-foreground" : "text-destructive"
          )}
        >
          {validation.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {validation.message}
        </p>
      )}
    </div>
  );
}
