# Omissions and differences from the official apps

This web UI aims for general parity with **O2 Insight Pro** (desktop) and the oximeter parts of
**ViHealth** (phone). This file lists what is missing or deliberately different.

## Deliberately not implemented

| Feature | Official app | Why it's missing |
|---|---|---|
| Factory reset / "Restore factory settings" | Both (`0xE3` OxyII, `0x18` legacy) | Erases every recording on the device. The web UI refuses to send these opcodes, along with firmware, file-write, delete and factory-programming commands (`0xE2`, `0xE5`–`0xE7`, `0xEA`, `0xEB`, `0xEE`, `0xF5`–`0xF8`, `0xFA`; legacy `0x19`, `0x1A`). |
| Firmware update | ViHealth (Nordic DFU, firmware from the vendor cloud) | Needs vendor servers. The firmware version is shown. |
| Online backup, vendor account, cloud sync | Both | This app is local-only. Recordings live in the browser's IndexedDB. |
| Sleep staging and sleep score | ViHealth (cloud API, with native `libsleep-alg.so` as fallback) | The algorithm is proprietary: cloud-side or closed native code. O2 Insight Pro doesn't show it either. |
| Language selection | O2 Insight Pro (EN, ZH, DE, IT, ES, FR) | The UI is English only. |
| Data folder location | O2 Insight Pro | Browsers can't choose a folder. Use Raw file / CSV export to save files. |
| Deleting recordings from the device | Neither app does this in normal use (`0xF8` exists in the SDK) | Destructive, and the official apps don't expose it. |

## Different behaviour

| Area | This app | Official apps |
|---|---|---|
| Drop counts (ODI) for files **without** a device summary (legacy files without drop counts, unfinalised O2Ring S files) | Computed with a port of the vendor's `odi_alg_func`, reconstructed from O2 Insight Pro and `libodi-lib.so`. On real O2Ring S nights it gives close but **not identical** counts to the ring's own trailer (device ≥3 %/≥4 %: 7/3, 8/8, 15/5; ported: 4/2, 10/7, 8/4). | Same algorithm (O2 Insight Pro, non-O2Ring-S files). |
| Drop counts for normal O2Ring S files | Taken from the file trailer (the ring's own numbers) | Same (both apps) |
| ODI per hour | `drops / recording duration × 3600`, 1 decimal, "Time<1h" under an hour (O2 Insight Pro) | ViHealth shows 2 decimals and caps counts at 250 |
| Motion | Raw 0–63 value from the file (as O2 Insight Pro plots and exports it) | ViHealth multiplies by 2 |
| Report PDF | Browser print / "Save as PDF" of the report page | O2 Insight Pro renders its own multi-page PDF at 300 dpi |
| Time sync | `0xC0` with timezone (ViHealth), falling back to `0xEC` (O2 Insight Pro). It's optional (Options), but on by default like both apps. | Both sync automatically on connect |
| AUTH timestamp packing | u32 little-endian, as O2 Insight Pro does (matches a captured Windows O2 Insight Pro frame) | ViHealth bit-shifts (`ts >> i`). The ring doesn't seem to check. |
| Live view | Polls `RT_DATA` about once a second. Shows SpO₂, pulse, PI, motion, battery and pleth. | O2 Insight Pro has no live view; ViHealth polls every 1.5 s |
| Import from files | Supported: raw device files (O2Ring S and legacy `.vld`/`.dat`, by content) | O2 Insight Pro has no import |
| Recording in progress (no trailer yet) | Downloaded and shown with a 1 s interval assumed and the start time from the file name. Re-download later for device statistics. | ViHealth downloads partial files too; O2 Insight Pro rejects them |
| CSV | O2 Insight Pro's exact format (`Time,Oxygen Level(%),Pulse Rate(bpm),Motion,Oxygen Level Reminder,PR Reminder,`, raw 255/65535 for invalid) | ViHealth's phone CSV uses `Time,Oxygen Level,Pulse Rate,Motion` with `--` for invalid |

## Not verified on hardware

Only an **O2Ring S** (firmware 1.0.5.0, branch code 2D010001) was available during development.
Everything else follows the vendor apps' code: the ViHealth Lepu SDK and O2 Insight Pro
disassembly, cross-checked with each other and with public references.

- **Legacy `0xAA` devices** (original O2Ring, Checkme O2 / O2 Max, SleepU, Oxylink, KidsO2,
  BabyO2, WearO2, SleepO2, OxyRing, OxyU, …): protocol, settings and file parser are implemented
  and unit-tested against the vendor packet encodings, but haven't been run on a device.
- **Other OxyII devices** (O2Ring SF/SP/SC, S8-AW, Band-WU, SHQO2Pro, O2MP, O2RMed S): use the
  same code path as the O2Ring S. O2MP-family devices (O2MP, O2Ring SP/SC) also have PPG and
  accelerometer files and extra settings that aren't supported.
- **AES sessions**: some OxyII firmware answers the `0xFF` AUTH frame with an AES key. This is
  implemented (AES-128-ECB/PKCS7) but untested, because the test ring never replied to AUTH.
- **Legacy devices with encryption** (e.g. SI PO2, ResMed-branded rings with per-account keys):
  not supported.
- **Checkme Pro / Checkme LE / Pod** (ECG/BP multi-parameter devices with list-based file
  transfer): not supported.

## Minor gaps

- The report's percent chart and duration tables follow O2 Insight Pro. ViHealth's paediatric
  and infant pulse-rate bands aren't used.
- "Remark" is a single free-text field per recording, like O2 Insight Pro's "Mark".
- Patient autocomplete draws from patients already entered in this browser.
- Web Bluetooth has to show the device chooser on every page load: browsers don't yet allow
  silent reconnection by default.
