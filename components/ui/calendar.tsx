"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        months: "flex flex-col gap-2",
        month: "flex flex-col gap-3",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center justify-between absolute inset-x-1 top-1 z-10",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 min-h-0 p-0 opacity-70 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 min-h-0 p-0 opacity-70 hover:opacity-100"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground w-9 font-normal text-xs",
        week: "flex w-full mt-1",
        day: "h-9 w-9 text-center text-sm p-0 relative",
        day_button: cn(
          "h-9 w-9 rounded-md p-0 font-normal transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "aria-selected:opacity-100"
        ),
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground [&>button]:font-semibold",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        outside: "text-muted-foreground opacity-40",
        disabled: "text-muted-foreground opacity-30 cursor-not-allowed",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
