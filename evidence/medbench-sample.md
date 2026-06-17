# Lifeline medbench — MedPsy-4B vs MedGemma-4B

> On-device latency + a small HAND-BUILT grounded-correctness check (does the answer mention the expected facts that are present in the CC0 corpus). NOT a validated clinical benchmark, and NOT QVAC's published numbers — only what we measured here. Answer tokens EXCLUDE reasoning.

## Summary (averaged across questions)

| Model | grounded facts | avg answer tokens | avg reasoning tokens | avg TTFC ms |
|---|--:|--:|--:|--:|
| MedPsy-4B (Q4_K_M) — medical hero | 34/36 | 112 | 277 | 9716 |
| MedGemma 4B IT (Q4_1) — medical | 30/36 | 74 | 0 | 1465 |

_TTFC = time to first **content** (answer) token. **answer tokens exclude reasoning** — this is why MedPsy's earlier 'verbose' count was misleading: most of its tokens were reasoning, not answer._

## Per-question detail

| Question | Model | answer tok | reasoning tok | answer tok/s | total ms | facts | backend |
|---|---|--:|--:|--:|--:|:--:|:--|
| How do I treat severe bleeding? | MedPsy-4B (Q4_K_M) — medical hero | 88 | 313 | 33.4 | 13440 | 4/4 | gpu |
| What should I do for a burn? | MedPsy-4B (Q4_K_M) — medical hero | 123 | 216 | 33.9 | 11501 | 3/4 | gpu |
| How do I help an adult who is choking? | MedPsy-4B (Q4_K_M) — medical hero | 193 | 298 | 34.2 | 15840 | 2/3 | gpu |
| What is the RICE method for a sprain? | MedPsy-4B (Q4_K_M) — medical hero | 49 | 238 | 32.5 | 9894 | 4/4 | gpu |
| How do I treat heat stroke? | MedPsy-4B (Q4_K_M) — medical hero | 118 | 301 | 34.4 | 13825 | 4/4 | gpu |
| What are the signs of shock and what should I do? | MedPsy-4B (Q4_K_M) — medical hero | 133 | 344 | 33.8 | 15434 | 4/4 | gpu |
| How do I respond to anaphylaxis? | MedPsy-4B (Q4_K_M) — medical hero | 154 | 294 | 33.2 | 14828 | 3/3 | gpu |
| What should I do if someone is unresponsive and not breathing? | MedPsy-4B (Q4_K_M) — medical hero | 117 | 279 | 34.1 | 13021 | 4/4 | gpu |
| How do I care for a suspected broken bone? | MedPsy-4B (Q4_K_M) — medical hero | 82 | 260 | 32.5 | 12002 | 3/3 | gpu |
| Should I use ice or butter on a burn? | MedPsy-4B (Q4_K_M) — medical hero | 61 | 229 | 31.8 | 10688 | 3/3 | gpu |
| How do I treat severe bleeding? | MedGemma 4B IT (Q4_1) — medical | 30 | 0 | 33.1 | 2120 | 1/4 | gpu |
| What should I do for a burn? | MedGemma 4B IT (Q4_1) — medical | 123 | 0 | 33.0 | 5046 | 3/4 | gpu |
| How do I help an adult who is choking? | MedGemma 4B IT (Q4_1) — medical | 131 | 0 | 33.3 | 5345 | 3/3 | gpu |
| What is the RICE method for a sprain? | MedGemma 4B IT (Q4_1) — medical | 45 | 0 | 34.3 | 2726 | 4/4 | gpu |
| How do I treat heat stroke? | MedGemma 4B IT (Q4_1) — medical | 95 | 0 | 33.6 | 4641 | 4/4 | gpu |
| What are the signs of shock and what should I do? | MedGemma 4B IT (Q4_1) — medical | 74 | 0 | 30.5 | 3842 | 4/4 | gpu |
| How do I respond to anaphylaxis? | MedGemma 4B IT (Q4_1) — medical | 82 | 0 | 32.5 | 4037 | 3/3 | gpu |
| What should I do if someone is unresponsive and not breathing? | MedGemma 4B IT (Q4_1) — medical | 107 | 0 | 31.9 | 4872 | 4/4 | gpu |
| How do I care for a suspected broken bone? | MedGemma 4B IT (Q4_1) — medical | 32 | 0 | 31.7 | 2426 | 3/3 | gpu |
| Should I use ice or butter on a burn? | MedGemma 4B IT (Q4_1) — medical | 17 | 0 | 33.7 | 2123 | 1/3 | gpu |

## Answers (qualitative)

### How do I treat severe bleeding?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 4/4:

Apply firm, direct pressure on the wound with a clean cloth or gloved hand and maintain it continuously, adding more material if soaked through [S1]. For limbs where bleeding persists, use a tourniquet 2–3 inches above the wound (avoiding joints), note the application time, and seek emergency help immediately [S1]. Keep the person warm and still while awaiting professional care. Do not remove embedded objects.

**MedGemma 4B IT (Q4_1) — medical** — facts 1/4:  _(missed: tourniquet, do not remove, emergency)_

1. Apply firm, direct pressure on the wound with a clean cloth or your gloved hand and do not let up. [S1]

### What should I do for a burn?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 3/4:  _(missed: 20 minutes)_

For a burn, immediately cool it with cool (not ice-cold) running water for at least twenty minutes [S1]. Remove jewelry and loose clothing near the burn before swelling begins, but do not peel away clothing stuck to the skin [S1]. Cover the burn loosely with clean, non-stick material like cling film or a clean dressing [S1]. Avoid applying butter, oils, toothpaste, or ice [S1]. Seek emergency care for burns that are large, deep, on the face/hands/feet/genitals, or caused by chemicals/electricity [S1].

**MedGemma 4B IT (Q4_1) — medical** — facts 3/4:  _(missed: 20 minutes)_

1. Cool the burn immediately with cool (not ice-cold) running water for at least twenty minutes.
2. Remove jewelry and loose clothing near the burn before swelling begins, but do not peel away clothing stuck to the skin.
3. Cover the burn loosely with clean, non-stick material such as cling film or a clean dressing.
4. Do not apply butter, oils, toothpaste, or ice.
5. Seek emergency care for burns that are large, deep, on the face, hands, feet, genitals, or airway, or that were caused by chemicals or electricity.

### How do I help an adult who is choking?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 2/3:  _(missed: five)_

To help an adult who is choking, follow these steps based on S1 and S2:

1. **Assess**: If they can cough or speak, encourage persistent coughing and do not interfere (S1).  
2. **If unable to breathe/cough/speak**:  
   - Stand behind them, deliver up to 5 firm back blows between the shoulder blades (S1).  
   - Follow with up to 5 abdominal thrusts (Heimlich maneuver) (S1).  
   - Alternate back blows and abdominal thrusts until the object clears or they become unresponsive.  
3. **If unresponsive**:  
   - Lower them gently and begin CPR (S2), while checking the mouth for the dislodged object before rescue breaths.  
   - Call emergency services immediately (S2).  

*Note: Do not perform blind finger sweeps. If no emergency call is made, ensure it is activated.*

**MedGemma 4B IT (Q4_1) — medical** — facts 3/3:

1. If someone can cough or speak, encourage them to keep coughing — do not interfere. If they cannot breathe, cough, or speak, act at once. Give up to five firm back blows between the shoulder blades with the heel of your hand, then up to five abdominal thrusts (stand behind them, make a fist just above the navel, grasp it with your other hand, and pull sharply inward and upward). Alternate five back blows and five abdominal thrusts until the object clears or the person becomes unresponsive. If they become unresponsive, lower them carefully and begin CPR, checking the mouth for the dislodged object before giving breaths.

### What is the RICE method for a sprain?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 4/4:

The RICE method for a sprain consists of four steps: Rest the injury, apply Ice wrapped in cloth for about twenty minutes at a time, apply gentle Compression with a bandage, and Elevate the limb. [S1]

**MedGemma 4B IT (Q4_1) — medical** — facts 4/4:

The RICE method for a sprain is: Rest the injury, apply Ice wrapped in cloth for about twenty minutes at a time, apply gentle Compression with a bandage, and Elevate the limb. [S1]

### How do I treat heat stroke?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 4/4:

Based solely on the provided context passages:

To treat heat stroke, move the person to a cool, shaded area immediately and call emergency services. [S1] Aggressively cool them by removing excess clothing, applying cool water to the skin while fanning, and placing cool wet cloths or ice packs at the neck, armpits, and groin. [S1] Do not give fluids if the person is confused or unconscious, but offer small sips of water only if they are fully alert. [S1] Heat stroke is life-threatening and requires professional medical help.

**MedGemma 4B IT (Q4_1) — medical** — facts 4/4:

1.  Move the person to a cool, shaded area at once and call for emergency help.
2.  Cool them aggressively: remove excess clothing and apply cool water to the skin while fanning, or place cool wet cloths or ice packs at the neck, armpits, and groin.
3.  If they are alert and able to swallow, give small sips of water. Do not give fluids to someone who is confused or not fully conscious.

### What are the signs of shock and what should I do?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 4/4:

The signs of shock include pale, cold, clammy skin, rapid breathing, weakness, and confusion [S1].  
If you suspect shock:  
1. Lay the person down (unless spinal/leg injury is suspected).  
2. Raise their legs slightly.  
3. Control obvious bleeding and keep them warm with a blanket.  
4. Loosen tight clothing and reassure them.  
5. **Do not give food or drink**.  
6. Monitor breathing and be ready for CPR.  
7. Call emergency services immediately [S1].  

*(Note: This is first aid support. Always seek professional medical help in emergencies.)*

**MedGemma 4B IT (Q4_1) — medical** — facts 4/4:

The signs of shock are pale, cold, clammy skin, rapid breathing, weakness, and confusion [S1]. To help someone in shock, lay them down and raise their legs slightly [S1]. Control any obvious bleeding, keep them warm with a blanket, loosen tight clothing, and reassure them [S1]. Get emergency help urgently [S1].

### How do I respond to anaphylaxis?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 3/3:

To respond to anaphylaxis, follow these key steps from [S1]:  
1. Help the person use an adrenaline auto-injector (e.g., EpiPen) immediately into the outer thigh.  
2. Call emergency services.  
3. If symptoms persist after 5–15 minutes and a second injector is available, administer it.  
4. Position the person: sit them up if breathing is difficult, or lie them down with legs raised if faint.  
5. Stay with them until help arrives, monitoring breathing and symptoms.  

Do not delay adrenaline administration—this is the most critical action. Avoid giving food, drink, or medications not specified here. If unsure of the reaction type, prioritize adrenaline per this guidance.

**MedGemma 4B IT (Q4_1) — medical** — facts 3/3:

1.  If the person has an adrenaline auto-injector (such as an EpiPen), help them use it immediately into the outer thigh, and call emergency services. A second dose may be given after five to fifteen minutes if symptoms persist and another injector is available. Help them sit up if breathing is hard, or lie down with legs raised if they feel faint. Stay with them until help arrives.

### What should I do if someone is unresponsive and not breathing?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 4/4:

Call emergency help immediately and begin CPR as described in [S1]. Start chest compressions with hands in the center of the chest, pushing hard and fast at a rate of about 100 compressions per minute (2 per second), allowing full chest recoil between compressions. If trained and willing, provide two rescue breaths after every 30 compressions; otherwise, perform continuous compressions until help arrives or the person recovers. Use an AED as soon as it becomes available and follow its instructions. Do not delay CPR while waiting for the AED.

**MedGemma 4B IT (Q4_1) — medical** — facts 4/4:

1. Call for emergency help and start CPR.
2. Place the heel of one hand in the center of the chest, your other hand on top, and push hard and fast — about two compressions per second, letting the chest fully recoil between compressions.
3. If trained and willing, give two rescue breaths after every thirty compressions; otherwise give continuous compressions until help arrives or the person recovers. Use an automated external defibrillator (AED) as soon as one is available and follow its spoken prompts.

### How do I care for a suspected broken bone?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 3/3:

For a suspected broken bone, do not attempt to straighten or move the injured area. Support and immobilize it in the position found, using padding (like clothing or a cloth) around the bone to prevent movement, and seek immediate medical care. Monitor for signs of poor circulation, such as coldness, paleness, or numbness in the limb, which requires urgent attention. [S1]

**MedGemma 4B IT (Q4_1) — medical** — facts 3/3:

[S1]
Do not try to straighten it; support and immobilize it in the position found, padding around it, and seek medical care.

### Should I use ice or butter on a burn?

**MedPsy-4B (Q4_K_M) — medical hero** — facts 3/3:

Do not use ice or butter on a burn. [S1] Cool the burn with cool (not ice-cold) running water for at least 20 minutes, and avoid applying butter, oils, toothpaste, or ice. Seek emergency care for severe burns as described in the passage.

**MedGemma 4B IT (Q4_1) — medical** — facts 1/3:  _(missed: cool, water)_

Do not apply butter, oils, toothpaste, or ice. [S1]
