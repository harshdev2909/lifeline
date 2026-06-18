import { ArrowUpRight, Flame, HeartPulse, Stethoscope } from "lucide-react";

import { LogoMark } from "../brand/Logo";

const EXAMPLES = [
  { icon: Flame, text: "How do I treat a minor burn?" },
  { icon: HeartPulse, text: "Someone collapsed and isn't breathing — what do I do?" },
  { icon: Stethoscope, text: "What's the RICE method for a sprained ankle?" },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex max-w-reading flex-col items-center px-4 pb-10 pt-[12vh] text-center">
      <div className="relative mb-6 text-fg">
        <span className="absolute inset-0 -z-10 animate-pulse-ring rounded-full bg-accent-soft" aria-hidden />
        <LogoMark size={52} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tightish text-fg">First-aid guidance, on this device</h1>
      <p className="mt-2 max-w-measure text-pretty text-base leading-relaxed text-fg-muted">
        Ask in plain words. Answers are grounded in a field manual and cite their sources — and everything runs locally,
        so it works with the network off.
      </p>

      <div className="mt-7 grid w-full gap-2">
        {EXAMPLES.map(({ icon: Icon, text }) => (
          <button
            key={text}
            onClick={() => onPick(text)}
            className="group flex items-center gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:border-hairline-strong hover:bg-raised focus-visible:outline focus-visible:outline-2"
          >
            <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="flex-1 text-sm text-fg">{text}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-faint transition-colors group-hover:text-fg-muted" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
