"use client";

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import type { DateRangeInput, DateRangeMode } from "@/lib/dateFilters";
import type { SkippedMessage } from "@/lib/types";

type Status = "idle" | "loading" | "done" | "error";

interface ResultMeta {
  totalFound: number;
  exported: number;
  skipped: SkippedMessage[];
}

function extractFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "grabexpress_receipts.xlsx";
  const match = /filename="?([^"]+)"?/.exec(contentDisposition);
  return match?.[1] ?? "grabexpress_receipts.xlsx";
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();

  const [mode, setMode] = useState<DateRangeMode>("all");
  const [since, setSince] = useState("");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [phrase, setPhrase] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);

  function buildInput(): DateRangeInput {
    switch (mode) {
      case "since":
        return { mode: "since", since };
      case "month":
        return { mode: "month", month };
      case "custom":
        return { mode: "custom", from, to: to || undefined };
      case "phrase":
        return { mode: "phrase", phrase };
      default:
        return { mode: "all" };
    }
  }

  async function handleGenerate() {
    setStatus("loading");
    setErrorMessage("");
    setResultMeta(null);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInput()),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? "Something went wrong generating the spreadsheet.");
        setStatus("error");
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
    } catch {
      setErrorMessage("Network error while generating the spreadsheet. Please try again.");
      setStatus("error");
    }
  }

  const isLoading = status === "loading";

  const canGenerate =
    mode === "all" ||
    (mode === "since" && since) ||
    (mode === "month" && month) ||
    (mode === "custom" && from) ||
    (mode === "phrase" && phrase.trim());

  return (
    <main>
      <h1>GrabExpress Receipt Collector</h1>
      <p className="subtitle">
        Sign in with Google, pick a date range, and download your GrabExpress receipts as a
        spreadsheet.
      </p>

      <div className="card">
        {sessionStatus === "loading" && <p>Loading session...</p>}

        {sessionStatus !== "loading" && !session && (
          <div className="row">
            <span>Not signed in</span>
            <button className="primary" onClick={() => signIn("google")}>
              Sign in with Google
            </button>
          </div>
        )}

        {session && (
          <div className="row">
            <span>Signed in as {session.user?.email}</span>
            <button onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </div>

      {session && (
        <div className="card">
          <fieldset>
            <legend>Date range</legend>
            <div className="mode-options">
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                />
                All receipts
              </label>

              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "since"}
                  onChange={() => setMode("since")}
                />
                Since a date
              </label>
              {mode === "since" && (
                <div className="inline-fields">
                  <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
                </div>
              )}

              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "month"}
                  onChange={() => setMode("month")}
                />
                A specific month
              </label>
              {mode === "month" && (
                <div className="inline-fields">
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                </div>
              )}

              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "custom"}
                  onChange={() => setMode("custom")}
                />
                Custom range
              </label>
              {mode === "custom" && (
                <div className="inline-fields">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <span>to</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              )}

              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "phrase"}
                  onChange={() => setMode("phrase")}
                />
                Free-form phrase
              </label>
              {mode === "phrase" && (
                <div className="inline-fields">
                  <input
                    type="text"
                    placeholder='e.g. "last 90 days", "this month", "2025"'
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              )}
            </div>
          </fieldset>

          <button className="primary" onClick={handleGenerate} disabled={!canGenerate || isLoading}>
            {isLoading ? "Generating..." : "Generate spreadsheet"}
          </button>

          {isLoading && (
            <p className="status">
              Searching Gmail and processing receipts... this may take a moment for large
              mailboxes.
            </p>
          )}

          {status === "error" && <div className="error-box">{errorMessage}</div>}

          {status === "done" && resultMeta && (
            <div className="status">
              <p>
                Found {resultMeta.totalFound} message(s), exported {resultMeta.exported} receipt(s)
                {resultMeta.skipped.length > 0 && `, skipped ${resultMeta.skipped.length}`}.
              </p>
              {resultMeta.skipped.length > 0 && (
                <ul className="skipped-list">
                  {resultMeta.skipped.map((s) => (
                    <li key={s.messageId}>
                      Skipped: Message ID {s.messageId} — Reason: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
