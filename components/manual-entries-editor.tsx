"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One editable row — kept as strings so half-typed values survive edits. */
export interface ManualEntryDraft {
  id: string;
  date: string; // YYYY-MM-DD from <input type="date">
  merchant: string;
  amount: string;
}

export function isValidDraft(draft: ManualEntryDraft): boolean {
  const amount = Number(draft.amount);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(draft.date) &&
    draft.merchant.trim() !== "" &&
    draft.amount.trim() !== "" &&
    Number.isFinite(amount) &&
    amount > 0
  );
}

export function newDraft(): ManualEntryDraft {
  return { id: crypto.randomUUID(), date: "", merchant: "", amount: "" };
}

interface ManualEntriesEditorProps {
  entries: ManualEntryDraft[];
  onChange: (entries: ManualEntryDraft[]) => void;
}

/**
 * Payments that appear in the Grab app's Activity History → Finance but never
 * produced an email (QR / in-store payments, some gateway merchants). They're
 * added to the spreadsheet with Source "Manual".
 */
export function ManualEntriesEditor({ entries, onChange }: ManualEntriesEditorProps) {
  const update = (id: string, patch: Partial<ManualEntryDraft>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  return (
    <div>
      <p className="mb-1 text-sm font-medium">Payments without an email (optional)</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Grab only emails some GrabPay payments (mostly online checkouts). QR / in-store payments
        appear in the Grab app under Activity → Finance but never reach Gmail — add them here and
        they&apos;ll be included as GrabPay (no email). Entries outside the date range are left out.
      </p>
      {entries.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {entries.map((entry) => {
            const touched = entry.date || entry.merchant || entry.amount;
            const invalid = Boolean(touched) && !isValidDraft(entry);
            return (
              <div key={entry.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <Input
                  type="date"
                  aria-label="Payment date"
                  className="w-full sm:w-40"
                  value={entry.date}
                  onChange={(e) => update(entry.id, { date: e.target.value })}
                  invalid={invalid && !entry.date}
                />
                <Input
                  placeholder="Merchant, e.g. KK MART RLA"
                  aria-label="Merchant"
                  className="min-w-0 flex-1"
                  maxLength={120}
                  value={entry.merchant}
                  onChange={(e) => update(entry.id, { merchant: e.target.value })}
                  invalid={invalid && !entry.merchant.trim()}
                />
                <div className="relative w-28 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    RM
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    aria-label="Amount in RM"
                    className="pl-10"
                    value={entry.amount}
                    onChange={(e) => update(entry.id, { amount: e.target.value })}
                    invalid={invalid && !(Number(entry.amount) > 0)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="Remove payment"
                  onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...entries, newDraft()])}>
        <Plus className="h-4 w-4" />
        Add payment
      </Button>
    </div>
  );
}
