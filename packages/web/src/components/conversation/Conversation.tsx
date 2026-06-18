import { useEffect, useRef } from "react";

import { useBridge } from "../../state/bridge";
import { DisclaimerBar } from "../chrome/DisclaimerBar";
import { VoiceSurface } from "../voice/VoiceSurface";
import { AssistantMessage } from "./AssistantMessage";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { UserMessage } from "./UserMessage";

export function Conversation() {
  const { exchanges, sendTurn, settings, voice } = useBridge();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastLen = exchanges.at(-1)?.assistant.answer.length ?? 0;

  // Keep the latest content in view as it streams.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [exchanges.length, lastLen]);

  function ask(prompt: string) {
    sendTurn({
      prompt,
      userAttachments: [],
      options: settings
        ? { model: settings.defaultModel, grounded: settings.grounded, delegate: settings.delegate, lang: settings.lang, speak: settings.speak }
        : { grounded: true },
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {exchanges.length === 0 ? (
          <EmptyState onPick={ask} />
        ) : (
          <div className="mx-auto w-full max-w-reading space-y-8 px-4 py-8">
            {exchanges.map((ex) => (
              <div key={ex.id} className="space-y-4">
                <UserMessage m={ex.user} />
                <AssistantMessage a={ex.assistant} />
              </div>
            ))}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}
      </div>

      <div className="border-t border-hairline bg-[color-mix(in_srgb,var(--bg-base)_82%,transparent)] backdrop-blur">
        <div className="mx-auto w-full max-w-reading px-4 py-3">
          {voice.active ? <VoiceSurface /> : <Composer />}
          <DisclaimerBar />
        </div>
      </div>
    </div>
  );
}
