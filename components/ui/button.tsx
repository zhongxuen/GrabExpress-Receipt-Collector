import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "disabled:pointer-events-none disabled:opacity-50 min-h-[44px] sm:min-h-[40px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
        ghost: "hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-1.5 text-sm",
        lg: "px-6 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
