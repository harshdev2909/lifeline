# Test image source & license

| File | Description | License |
|---|---|---|
| `wound.bmp` | **Synthetic** 320×240 image (generated: a dark-red irregular region on a skin-tone background) used to exercise the vision pipeline end-to-end. | **CC0-1.0** |
| `burn-label.png` | **Synthetic** 1520×640 image of a printed first-aid label (black text on white), rendered natively via macOS Core Graphics. The text is generic burn-care guidance written for this repo (not transcribed from any copyrighted source). Used to exercise the OCR (`--ocr`) pipeline. | **CC0-1.0** |

`wound.bmp` is procedurally generated (not a real photograph) and dedicated to the public
domain under CC0-1.0. It is a stand-in to demonstrate the image → vision-description →
grounded-MedPsy pipeline; the vision model describes whatever colours/shapes it sees, and the
manual + question provide the medical grounding. No copyrighted or real patient imagery is used.

`burn-label.png` is procedurally rendered text (not a photograph of a real product label) and
dedicated to the public domain under CC0-1.0. It demonstrates the OCR → fenced-untrusted-text →
grounded-MedPsy pipeline. The OCR'd text is treated as untrusted data (see the injection-test
corpus for the adversarial counterpart).
