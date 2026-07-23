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
} from "lucide-react";
import type { DateRangeInput } from "@/lib/dateFilters";
import type { SkippedMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";

type Status = "idle" | "loading" | "done" | "error";

interface ResultMeta {
  totalFound: number;
  exported: number;
  skipped: SkippedMessage[];
}

const PROGRESS_STEPS = [
  "Searching Gmail for GrabExpress receipts...",
  "Parsing receipt details...",
  "Building your spreadsheet...",
];

function extractFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "grabexpress_receipts.xlsx";
  const match = /filename="?([^"]+)"?/.exec(contentDisposition);
  return match?.[1] ?? "grabexpress_receipts.xlsx";
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();

  const [rangeInput, setRangeInput] = useState<DateRangeInput>({ mode: "all" });
  const [rangeValid, setRangeValid] = useState(true);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  async function handleGenerate() {
    setStatus("loading");
    setErrorMessage("");
    setResultMeta(null);
    setProgressStep(0);

    progressTimer.current = setInterval(() => {
      setProgressStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1));
    }, 2200);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rangeInput),
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
      const meta: ResultMeta = metaHeader
        ? JSON.parse(decodeURIComponent(metaHeader))
        : { totalFound: 0, exported: 0, skipped: [] };

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
        toast.success(`Exported ${meta.exported} receipt${meta.exported === 1 ? "" : "s"}`, {
          description: `${filename} has started downloading.`,
        });
      } else {
        toast.message("No receipts found", {
          description: "Try a different date range.",
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <PackageSearch className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            GrabExpress Receipt Collector
          </h1>
        </div>
        <p className="text-sm text-muted-foreground sm:text-base">
          Sign in with Google, pick a date range, and download your GrabExpress receipts as a
          spreadsheet.
        </p>
      </header>

      <Card className="animate-fade-in">
        <CardContent className="pt-5 sm:pt-6">
          {sessionStatus === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session...
            </div>
          )}

          {sessionStatus !== "loading" && !session && (
            <div className="flex flex-col items-center gap-3 py-4 text-center sm:flex-row sm:justify-between sm:text-left">
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

      {session && (
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Export receipts</CardTitle>
            <CardDescription>Choose which receipts to include in the spreadsheet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <DateRangePicker
              onChange={(input, valid) => {
                setRangeInput(input);
                setRangeValid(valid);
              }}
            />

            <Button
              size="lg"
              className="w-full"
              onClick={handleGenerate}
              disabled={!rangeValid || isLoading}
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
                {PROGRESS_STEPS.map((step, i) => (
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
                  Found {resultMeta.totalFound} message(s) but nothing matched. Try a different
                  date range.
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
