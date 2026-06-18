# Demo hardware

Captured with `npm run sysinfo` on each device. Attach an OS system-profiler
screenshot for each (saved alongside this file).

## Device A — field device (this dev machine)
Captured 2026-06-18 via `npm run sysinfo`:

| | |
|---|---|
| Runtime | node v24.10.0 |
| Platform | darwin / arm64 (24.5.0) |
| CPU | Apple M4 |
| Cores | 10 @ 2400 MHz |
| RAM | 16 GB |
| Accelerator | Metal (expected; authoritative backend recorded per-inference) |

- [ ] Attach `submission/hardware-deviceA.png` (Apple menu → About This Mac → More Info / System Report).
- Note: 16 GB. The Wan text-to-video pipeline OOMs here (needs ≈20 GB unified) — video is the delegated-to-a-bigger-peer path, not run on this device.

## Device B — peer / provider (the stronger device used for the delegation leg)
- [ ] Run `npm run sysinfo` on the provider device and paste the table here.
- [ ] Attach `submission/hardware-deviceB.png`.
- Typical: a laptop/desktop with a stronger GPU and ≥16 GB RAM serving MedPsy-4B to the field device over the P2P link.

> The auditable per-inference backend (`backend_device`) in `evidence/` is the
> authoritative record of where each inference actually ran.
