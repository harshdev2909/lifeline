import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 ease-spring " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45 disabled:pointer-events-none select-none";

const variants: Record<Variant, string> = {
  // The single primary action — the only place jade fills a surface.
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-pressed shadow-raised",
  ghost: "text-fg-muted hover:text-fg hover:bg-raised",
  subtle: "border border-hairline bg-surface text-fg hover:border-hairline-strong hover:bg-raised",
  danger: "border border-emergency-line bg-emergency-soft text-emergency hover:border-emergency",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "subtle", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: "default" | "accent";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tone = "default", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 ease-spring",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45 disabled:pointer-events-none",
        active
          ? tone === "accent"
            ? "bg-accent-soft text-accent"
            : "bg-raised text-fg"
          : "text-fg-muted hover:bg-raised hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
