import { MeshVisualizer } from "../mesh/MeshVisualizer";

/**
 * The mesh control panel given a full home — the Network tool view. Reuses the
 * same live MeshVisualizer that rides alongside the conversation, so routing,
 * peers, and provider controls are identical; here it simply has room to breathe.
 */
export function NetworkTool() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[420px] px-4 py-6">
        <MeshVisualizer />
      </div>
    </div>
  );
}
