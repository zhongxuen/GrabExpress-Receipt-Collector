"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  PackageSearch,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Inbox,
  FileSpreadsheet,
  FlaskConical,
} from "lucide-react";
import type { DateRangeInput } from "@/lib/dateFilters";
import type { ExportMeta, GrabService } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Input } from "@/components/ui/input";
import { ManualEntriesEditor, isValidDraft, type ManualEntryDraft } from "@/components/manual-entries-editor";

type Status = "idle" | "loading" | "done" | "error";

const SERVICE_OPTIONS: { key: GrabService; label: string; summaryLabel: (n: number) => string }[] = [
  { key: "food", label: "GrabFood", summaryLabel: () => "GrabFood" },
  { key: "transport", label: "Rides", summaryLabel: (n) => (n === 1 ? "ride" : "rides") },
  { key: "express", label: "GrabExpress", summaryLabel: () => "GrabExpress" },
  { key: "payment", label: "GrabPay", summaryLabel: (n) => (n === 1 ? "GrabPay payment" : "GrabPay payments") },
];

/** e.g. "50 GrabFood, 45 rides, 2 GrabExpress, 3 GrabPay payments" — services with no receipts are left out. */
function describeByService(byService: ExportMeta["byService"] | undefined): string {
  if (!byService) return "";
  return SERVICE_OPTIONS.filter((opt) => byService[opt.key] > 0)
    .map((opt) => `${byService[opt.key]} ${opt.summaryLabel(byService[opt.key])}`)
    .join(", ");
}

const SPEND_LIMIT_PRESETS = [200, 500];

/** Empty means "no limit"; otherwise a positive RM amount (server re-validates). */
function isValidSpendLimit(text: string): boolean {
  if (text.trim() === "") return true;
  const value = Number(text);
  return Number.isFinite(value) && value > 0;
}

// Manual entries are re-typed from the Grab app, so keep them across visits.
// Browser-local only; the export still works if storage is unavailable.
const MANUAL_ENTRIES_STORAGE_KEY = "grab-receipt-collector:manual-entries";

const isBlankDraft = (d: ManualEntryDraft) => !d.date && !d.merchant.trim() && !d.amount.trim();

const formatRM = (amount: number) => `RM${amount.toFixed(2)}`;

const PROGRESS_STEPS = [
  "Searching Gmail for Grab receipts...",
  "Parsing receipt details...",
  "Building your spreadsheet...",
];

const DEMO_PROGRESS_STEPS = [
  "Loading sample receipts...",
  "Parsing receipt details...",
  "Building your spreadsheet...",
];

function extractFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "grab_receipts.xlsx";
  const match = /filename="?([^"]+)"?/.exec(contentDisposition);
  return match?.[1] ?? "grab_receipts.xlsx";
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();

  const [isDemo, setIsDemo] = useState(false);
  const [rangeInput, setRangeInput] = useState<DateRangeInput>({ mode: "all" });
  const [rangeValid, setRangeValid] = useState(true);
  const [services, setServices] = useState<GrabService[]>(SERVICE_OPTIONS.map((opt) => opt.key));
  const [spendLimitText, setSpendLimitText] = useState("");
  const spendLimitValid = isValidSpendLimit(spendLimitText);
  const [manualEntries, setManualEntries] = useState<ManualEntryDraft[]>([]);
  // State, not a ref: the save effect must not run until the loaded entries
  // have rendered, or it would overwrite storage with the initial [].
  const [manualLoaded, setManualLoaded] = useState(false);
  const filledManualEntries = manualEntries.filter((d) => !isBlankDraft(d));
  const manualEntriesValid = filledManualEntries.every(isValidDraft);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMeta, setResultMeta] = useState<ExportMeta | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  // Deep link support for the portfolio site, e.g. "/?demo=1" — lands the
  // visitor straight in demo mode with zero extra clicks.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") setIsDemo(true);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MANUAL_ENTRIES_STORAGE_KEY);
      if (saved) setManualEntries(JSON.parse(saved) as ManualEntryDraft[]);
    } catch {
      // Storage blocked or corrupt — start empty.
    }
    setManualLoaded(true);
  }, []);

  useEffect(() => {
    if (!manualLoaded) return;
    try {
      localStorage.setItem(MANUAL_ENTRIES_STORAGE_KEY, JSON.stringify(manualEntries));
    } catch {
      // Not persisted; entries still apply to this session's exports.
    }
  }, [manualEntries, manualLoaded]);

  async function handleGenerate() {
    setStatus("loading");
    setErrorMessage("");
    setResultMeta(null);
    setProgressStep(0);

    const steps = isDemo ? DEMO_PROGRESS_STEPS : PROGRESS_STEPS;
    progressTimer.current = setInterval(() => {
      setProgressStep((s) => Math.min(s + 1, steps.length - 1));
    }, 2200);

    try {
      const res = await fetch(isDemo ? "/api/demo-export" : "/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rangeInput,
          services,
          spendLimit: spendLimitText.trim() || undefined,
          // Demo Mode runs on sample data only, so personal entries stay out of it.
          manualEntries: isDemo
            ? undefined
            : filledManualEntries.map(({ date, merchant, amount }) => ({ date, merchant, amount: Number(amount) })),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error ?? "Something went wrong generating the spreadsheet.";
        setErrorMessage(message);
        setStatus("error");
        toast.error("Export failed", { description: message });
        return;
      }

      const metaHeader = res.headers.get("X-Export-Meta");
      const meta: ExportMeta = metaHeader
        ? JSON.parse(decodeURIComponent(metaHeader))
        : { totalFound: 0, exported: 0, byService: { express: 0, food: 0, transport: 0, payment: 0 }, skipped: [] };

      const filename = extractFilename(res.headers.get("Content-Disposition"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setResultMeta(meta);
      setStatus("done");

      if (meta.exported > 0) {
        const breakdown = describeByService(meta.byService);
        toast.success(`Exported ${meta.exported} receipt${meta.exported === 1 ? "" : "s"}${breakdown ? `: ${breakdown}` : ""}`, {
          description: `${filename} has started downloading.`,
        });
      } else {
        toast.message("No receipts found", {
          description: meta.spendLimit?.nextExcluded
            ? "Your most recent receipt is already over the spend limit."
            : "Try a different date range.",
        });
      }
    } catch {
      const message = "Network error while generating the spreadsheet. Please try again.";
      setErrorMessage(message);
      setStatus("error");
      toast.error("Network error", { description: message });
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
    }
  }

  const isLoading = status === "loading";
  const progressSteps = isDemo ? DEMO_PROGRESS_STEPS : PROGRESS_STEPS;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <PackageSearch className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Grab Receipt Collector
          </h1>
        </div>
        <p className="text-sm text-muted-foreground sm:text-base">
          Sign in with Google, pick a date range, and download your GrabFood, ride,
          GrabExpress, and GrabPay receipts as a spreadsheet.
        </p>
      </header>

      {isDemo && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm animate-fade-in">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FlaskConical className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Demo Mode</span> — sample data, not
              your real inbox.
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
            onClick={() => setIsDemo(false)}
          >
            Exit demo
          </button>
        </div>
      )}

      <Card className="animate-fade-in">
        <CardContent className="pt-5 sm:pt-6">
          {sessionStatus === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session...
            </div>
          )}

          {sessionStatus !== "loading" && !session && !isDemo && (
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
                <div>
                  <p className="font-medium">Not signed in</p>
                  <p className="text-sm text-muted-foreground">
                    Grant read-only Gmail access to get started.
                  </p>
                </div>
                <Button className="w-full sm:w-auto" onClick={() => signIn("google")}>
                  Sign in with Google
                </Button>
              </div>
              <div className="flex flex-col items-center gap-1 border-t border-border pt-4 text-center sm:flex-row sm:justify-between sm:text-left">
                <p className="text-sm text-muted-foreground">
                  Just want to see how it works? Try the demo with sample data — no sign-in
                  required.
                </p>
                <Button
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={() => setIsDemo(true)}
                >
                  <FlaskConical className="h-4 w-4" />
                  Try the demo
                </Button>
              </div>
            </div>
          )}

          {sessionStatus !== "loading" && !session && isDemo && (
            <div className="flex flex-col items-center gap-3 py-4 text-center sm:flex-row sm:justify-between sm:text-left">
              <div>
                <p className="font-medium">Viewing the demo</p>
                <p className="text-sm text-muted-foreground">
                  Sign in with Google to run this against your own inbox.
                </p>
              </div>
              <Button className="w-full sm:w-auto" onClick={() => signIn("google")}>
                Sign in with Google
              </Button>
            </div>
          )}

          {session && (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Signed in as</p>
                <p className="font-medium">{session.user?.email}</p>
              </div>
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => signOut()}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(session || isDemo) && (
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Export receipts</CardTitle>
            <CardDescription>
              {isDemo
                ? "Choose which sample receipts to include in the spreadsheet."
                : "Choose which receipts to include in the spreadsheet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <DateRangePicker
              onChange={(input, valid) => {
                setRangeInput(input);
                setRangeValid(valid);
              }}
            />

            <div>
              <p className="mb-2 text-sm font-medium">Services</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Services">
                {SERVICE_OPTIONS.map((opt) => {
                  const selected = services.includes(opt.key);
                  return (
                    <Button
                      key={opt.key}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      onClick={() =>
                        setServices((current) =>
                          selected ? current.filter((s) => s !== opt.key) : [...current, opt.key]
                        )
                      }
                    >
                      {opt.label}
                    </Button>
                  );
                })}
              </div>
              {services.length === 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive animate-fade-in">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Pick at least one service.
                </p>
              )}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Spend limit (optional)</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Only the most recent receipts, counting back until the next one would go over this
                amount.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-36">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    RM
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="No limit"
                    aria-label="Spend limit in RM"
                    className="pl-10"
                    value={spendLimitText}
                    onChange={(e) => setSpendLimitText(e.target.value)}
                    invalid={!spendLimitValid}
                  />
                </div>
                {SPEND_LIMIT_PRESETS.map((preset) => {
                  const selected = spendLimitText.trim() !== "" && Number(spendLimitText) === preset;
                  return (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      onClick={() => setSpendLimitText(selected ? "" : String(preset))}
                    >
                      RM{preset}
                    </Button>
                  );
                })}
              </div>
              {!spendLimitValid && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive animate-fade-in">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Enter a positive amount, or leave it empty for no limit.
                </p>
              )}
            </div>

            {!isDemo && (
              <div>
                <ManualEntriesEditor entries={manualEntries} onChange={setManualEntries} />
                {!manualEntriesValid && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive animate-fade-in">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Each payment needs a date, a merchant, and a positive amount.
                  </p>
                )}
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              onClick={handleGenerate}
              disabled={
                !rangeValid ||
                services.length === 0 ||
                !spendLimitValid ||
                (!isDemo && !manualEntriesValid) ||
                isLoading
              }
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-4 w-4" />
                  Generate spreadsheet
                </>
              )}
            </Button>

            {isLoading && (
              <div className="flex flex-col gap-2 animate-fade-in">
                {progressSteps.map((step, i) => (
                  <div
                    key={step}
                    className={`flex items-center gap-2 text-sm transition-colors ${
                      i <= progressStep ? "text-foreground" : "text-muted-foreground/50"
                    }`}
                  >
                    {i < progressStep ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : i === progressStep ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-current" />
                    )}
                    {step}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  This may take a moment for large mailboxes.
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0 translate-y-0.5" />
                <div>
                  <p className="font-medium">Something went wrong</p>
                  <p>{errorMessage}</p>
                </div>
              </div>
            )}

            {status === "done" && resultMeta && resultMeta.exported === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center animate-fade-in">
                <Inbox className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No receipts found</p>
                <p className="text-sm text-muted-foreground">
                  {resultMeta.spendLimit?.nextExcluded
                    ? `Your most recent receipt (${resultMeta.spendLimit.nextExcluded.date}, ${formatRM(resultMeta.spendLimit.nextExcluded.amount)}) is already over the ${formatRM(resultMeta.spendLimit.limit)} limit.`
                    : `Found ${resultMeta.totalFound} message(s) but nothing matched. Try a different date range.`}
                </p>
              </div>
            )}

            {status === "done" && resultMeta && resultMeta.exported > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-accent p-3 text-sm animate-fade-in">
                <div className="flex items-center gap-2 font-medium text-accent-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Found {resultMeta.totalFound} message(s), exported {resultMeta.exported}{" "}
                  receipt(s)
                  {resultMeta.skipped.length > 0 && `, skipped ${resultMeta.skipped.length}`}.
                </div>
                {describeByService(resultMeta.byService) && (
                  <p className="text-xs text-muted-foreground">
                    {describeByService(resultMeta.byService)}
                    {resultMeta.manual ? ` (incl. ${resultMeta.manual} added manually)` : ""}
                  </p>
                )}
                {resultMeta.spendLimit && (
                  <p className="text-xs text-muted-foreground">
                    {formatRM(resultMeta.spendLimit.total)} of your {formatRM(resultMeta.spendLimit.limit)}{" "}
                    limit.
                    {resultMeta.spendLimit.nextExcluded &&
                      ` Next receipt (${resultMeta.spendLimit.nextExcluded.date}, ${resultMeta.spendLimit.nextExcluded.service}, ${formatRM(resultMeta.spendLimit.nextExcluded.amount)}) not included — it would exceed the limit.`}
                  </p>
                )}
                {resultMeta.skipped.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
                    {resultMeta.skipped.map((s) => (
                      <li key={s.messageId} className="border-t border-border/60 py-1 first:border-t-0">
                        Skipped: Message ID {s.messageId} — Reason: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
