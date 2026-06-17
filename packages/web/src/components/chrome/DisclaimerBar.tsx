import { ShieldPlus } from "lucide-react";

/**
 * The non-removable safety disclaimer — always present, low-emphasis. Triage and
 * education decision-SUPPORT, never a diagnosis. The bridge also appends it in
 * code to every answer; this keeps it in view at the point of action.
 */
export function DisclaimerBar() {
  return (
    <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-2xs text-fg-faint">
      <ShieldPlus className="h-3 w-3 shrink-0" aria-hidden />
      Triage &amp; first-aid education — not a diagnosis. In an emergency, call your local emergency number.
    </p>
  );
}
