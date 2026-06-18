/** Translate — offline two-way machine translation between English and the patient's language. */
import { useState } from "react";

import { ArrowLeftRight, Languages } from "lucide-react";

import { Button } from "../ui/Button";
import { Select } from "../ui/Field";
import { ErrorBar, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

const LANGS = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

export function TranslateTool() {
  const { phase, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [text, setText] = useState("");
  const [lang, setLang] = useState("es");
  const [toEnglish, setToEnglish] = useState(true);
  const result = output?.tool === "translate" ? output : null;
  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? lang;

  return (
    <ToolLayout
      title="Translate"
      blurb="Offline two-way translation between English and the patient's language — type or paste, pick a direction, and translate on-device."
    >
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={toEnglish ? "Texto en español o text en français…" : "Text in English…"}
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel="Patient language"
            value={lang}
            onValueChange={setLang}
            options={LANGS.map((l) => ({ value: l.code, label: l.label }))}
          />
          <button
            type="button"
            onClick={() => setToEnglish((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-fg-muted hover:bg-raised"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
            {toEnglish ? `${langLabel} → English` : `English → ${langLabel}`}
          </button>
          <Button variant="primary" onClick={() => run({ tool: "translate", params: { text, lang, toEnglish } })} loading={phase === "running"} disabled={!text.trim() || !ready}>
            <Languages className="h-4 w-4" aria-hidden /> Translate
          </Button>
        </div>

        {phase === "running" && <RunningBar label="Translating on-device…" />}
        {phase === "error" && error && <ErrorBar message={error} />}
        {result && (
          <OutputCard title={result.direction}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.text}</p>
          </OutputCard>
        )}
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
