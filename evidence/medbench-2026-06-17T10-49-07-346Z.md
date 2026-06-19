# Lifeline medbench — MedPsy-4B vs MedGemma-4B

> On-device latency / token-efficiency + qualitative answers. NOT a validated accuracy benchmark (no labeled test set).

## Latency / efficiency (on-device)

| Question | Model | TTFT ms | tok/s | tokens | total ms | backend |
|---|---|--:|--:|--:|--:|:--|
| How do I treat severe bleeding? | MedPsy-4B (Q4_K_M) — medical hero | 1339 | 34.8 | 454 | 14523 | gpu |
| What should I do for a burn? | MedPsy-4B (Q4_K_M) — medical hero | 1476 | 34.7 | 372 | 12317 | gpu |
| How do I treat severe bleeding? | MedGemma 4B IT (Q4_1) — medical | 1124 | 34.3 | 121 | 4747 | gpu |
| What should I do for a burn? | MedGemma 4B IT (Q4_1) — medical | 1385 | 34.7 | 123 | 5048 | gpu |

## Answers (qualitative)

### How do I treat severe bleeding?

**MedPsy-4B (Q4_K_M) — medical hero:**

To treat severe external bleeding, follow these immediate steps from the guidance:

1. **Apply firm, direct pressure** on the wound with a clean cloth or gloved hand. Do not remove soaked material—add more layers and keep pressing continuously [S1].
2. **For limbs that continue bleeding despite pressure**, apply a tourniquet 2–3 inches above the wound (avoiding joints), note the application time, and seek emergency help immediately [S1].
3. **Keep the person warm, still, and monitor breathing** while someone else calls emergency services [S1].
4. **Do not remove embedded objects**—press around them [S1].

If bleeding is life-threatening (e.g., arterial spurting), act quickly but avoid delaying professional care. Emergency help is essential for all severe bleeding scenarios.

**MedGemma 4B IT (Q4_1) — medical:**

1. Apply firm, direct pressure on the wound with a clean cloth or your gloved hand and do not let up. If blood soaks through, add more material on top rather than removing the soaked layer. Keep pressing.
2. For a bleeding arm or leg that does not stop with direct pressure, apply a tourniquet a few inches above the wound (not on a joint), tighten until the bleeding stops, and note the time it was applied. Keep the person warm and still and get emergency help as fast as possible. Do not remove an embedded object — press around it instead.

### What should I do for a burn?

**MedPsy-4B (Q4_K_M) — medical hero:**

For a burn, cool it immediately with cool (not ice-cold) running water for at least twenty minutes. Remove jewelry and loose clothing near the burn before swelling begins, but do not peel away clothing stuck to the skin. Cover the burn loosely with clean, non-stick material such as cling film or a clean dressing. Do not apply butter, oils, toothpaste, or ice. Seek emergency care for burns that are large, deep, on the face/hands/feet/genitals, or caused by chemicals/electricity. [S1]

**MedGemma 4B IT (Q4_1) — medical:**

1. Cool the burn immediately with cool (not ice-cold) running water for at least twenty minutes.
2. Remove jewelry and loose clothing near the burn before swelling begins, but do not peel away clothing stuck to the skin.
3. Cover the burn loosely with clean, non-stick material such as cling film or a clean dressing.
4. Do not apply butter, oils, toothpaste, or ice.
5. Seek emergency care for burns that are large, deep, on the face, hands, feet, genitals, or airway, or that were caused by chemicals or electricity.
