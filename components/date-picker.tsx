"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value: string; // ISO yyyy-MM-dd, or ""
  onChange: (isoDate: string) => void;
  placeholder?: string;
  disabledAfter?: Date;
  invalid?: boolean;
  ariaLabel?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabledAfter,
  invalid,
  ariaLabel,
}: DatePickerProps) {
  const parsed = value ? parseISO(value) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel ?? placeholder}
          className={cn(
            "w-full justify-start text-left font-normal sm:w-[190px]",
            !selected && "text-muted-foreground",
            invalid && "border-destructive text-destructive"
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          {selected ? format(selected, "dd/MM/yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          disabled={disabledAfter ? { after: disabledAfter } : undefined}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
