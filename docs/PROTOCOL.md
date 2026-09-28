# Viatom oximeter protocols and file formats

What this app implements, and where each fact comes from:

- **HW**: observed on a real O2Ring S (firmware 1.0.5.0, branch 2D010001) during development.
- **SDK**: Lepu BLE SDK embedded in ViHealth 2.75.66 (Android).
- **O2I**: O2 Insight Pro 1.9.3 (macOS) disassembly.

All multi-byte integers are little endian. Both protocol families use the same CRC-8:
poly 0x07, init 0, not reflected, no xorout (`"123456789"` → `F4`).

## BLE

| Family | Service | Write (without response) | Notify |
|---|---|---|---|
| OxyII | `e8fb0001-a14b-98f9-831b-4e2941d01248` | `e8fb0002-…` | `e8fb0003-…` |
| Legacy | `14839ac4-7d7e-415c-9a42-167340cf2339` | `8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3` | `0734594a-a8e7-4b1a-a6b1-cd5243059a57` |

- **Advertising:** devices advertise no service UUIDs. Identify them by name (SDK
  `Bluetooth.getDeviceModel`): substring checks first, then the first space-separated token. The
  O2Ring S advertises `O2Ring S 0541` with manufacturer data `F34E: 00` (HW).
- **Legacy service on the O2Ring S:** the O2Ring S also exposes the legacy service but doesn't
  answer `0xAA` commands on it (HW).
- **Writes:** split frames into ≤ 20-byte writes. Pace legacy writes about 20 ms apart.
- **Notifications:** concatenate them and scan for complete frames.

## OxyII frame (O2Ring S and newer)

```
A5 | cmd | ~cmd | pkgType | seq | len u16 | payload | crc8
```

- **`pkgType`:** 0 in requests. In replies, 1 = OK and any other value is an error code:
  `E0` file not found, `F2` permission denied, `FB` busy, `FD` unsupported, …
- **`seq`:** echoed by the device (HW).
- **USB HID** (O2Ring S, VID 0x1915, PID 0xF33C): every 64-byte report, in both directions, is
  `[N][N stream bytes][zero pad]`, report ID 0 (HW).

### Connect sequence (SDK)

1. `FF` AUTH. Wait up to 1 s. The O2Ring S doesn't reply (HW), so the session stays plaintext.
2. `10 00` turns off automatic live-data pushes.
3. `C0` set time (optional).
4. `00` GET_CONFIG.
5. `E1` GET_INFO.
6. `F1` file list.
7. For each file: `F2`, then `F3` repeatedly, then `F4`.
8. Poll `04` for live data.

**AUTH payload:** `MD5("lepucloud")[0,2,…,14] ‖ "0000" ‖ u32 unix time`, XORed with
`MD5("lepucloud") = c2a7cf50dafed885a8f8f7eac44335f3`.
- A reply of at least 20 bytes that decodes to `[1, 16, ?, ?, key16]` switches the session to
  AES-128-ECB/PKCS7 for every non-empty payload.
- The time is u32 LE, as O2 Insight Pro sends it (a Windows USB capture matches). The SDK
  bit-shifts instead.

### Commands used

| Op | Name | Request | Reply |
|---|---|---|---|
| `00` | GET_CONFIG | – | 40-byte config (below) |
| `01` | SET_CONFIG | `[type,0,0,0][value,0,0,0]` | ack |
| `04` | RT_DATA | – | RtParam (20 B) + RtWave |
| `10` | AUTO_RT_SWITCH | bitmask (0 = off) | ack |
| `C0` | SET_UTC_TIME | year u16, mon, day, h, m, s, tz (signed, 0.1 h) | ack |
| `EC` | SET_TIME (O2I) | year u16, mon, day, h, m, s | ack |
| `E1` | GET_INFO | – | 60 bytes (below) |
| `E4` | GET_BATTERY | – | state (0 normal, 1 charging, 2 full, 3 low), %, mV u16 |
| `F1` | GET_FILE_LIST | – | count u8 + count × 16-byte NUL-padded names (`yyyyMMddHHmmss`). The ring keeps a fixed number of recordings (4 observed) and drops the oldest when a new one starts (HW). |
| `F2` | READ_FILE_START | name padded to 16 + u32 0 | file size u32 |
| `F3` | READ_FILE_DATA | u32 offset | chunk; the device picks the size (512 B over BLE, HW) |
| `F4` | READ_FILE_END | – | ack |
| `FF` | AUTH | 16 B | none, or a key blob |

**Never sent:** `E2` reset, `E3` factory reset (erases recordings), `E5`–`E7` firmware, `EA`/`EB`
factory, `EE` factory reset + power off, `F5`–`F7` file write, `F8` delete file, `FA` DFU.

**GET_INFO:**

| Offset | Field |
|---|---|
| 0 | hardware version (char) |
| 1–4 | firmware version (dotted, MSB first) |
| 5–8 | bootloader version |
| 9–16 | branch code |
| 17 | file version |
| 18–19 | project id |
| 20–21 | device type |
| 22–23 | protocol version |
| 24–30 | device clock (year u16, M, D, h, m, s) |
| 31–32 | max packet length |
| 37 | SN length |
| 38… | SN |

**GET_CONFIG:**

| Offset | Field | Notes |
|---|---|---|
| 0 | switches | bit0 SpO₂ vibrate, bit1 SpO₂ sound, bit4 PR vibrate, bit5 PR sound |
| 1 | SpO₂ threshold | 80–95 |
| 2 | PR low | 30–70 |
| 3 | PR high | 70–200 |
| 4 | motor | 20–100 |
| 5 | buzzer | |
| 6 | display mode | 0 standard, 2 always on |
| 7 | brightness | 0–2 |
| 8 | storage interval | 1 or 4 s |
| 9 | UTC offset | 0.1 h |

**SET_CONFIG types:** 1 SpO₂ switch, 2 SpO₂ threshold, 3 PR switch (bits 0/1), 4 PR low,
5 PR high, 6 motor, 7 buzzer, 8 display, 9 brightness, 10 interval.

**RtParam:**

| Offset | Field | Notes |
|---|---|---|
| 0 | duration | u32 |
| 4 | run status | |
| 5 | sensor | 0 no finger, 1 ok, 2 probe off, 3 fault |
| 6 | SpO₂ | 0, 127, 255 = invalid |
| 7 | PI | ×10 |
| 8 | PR | u16 |
| 10 | flags | |
| 11 | motion | |
| 12 | battery state | |
| 13 | battery % | |

**RtWave:** offset u32, n u16, then n u8 samples (156 and 246 are markers).

## Legacy frame (O2Ring, Checkme O2, SleepU, …)

```
request   AA | cmd | ~cmd | pktNo u16 | len u16 | payload | crc8
response  55 | status | ~status | pktNo u16 | len u16 | payload | crc8   (status 0 = OK)
```

Responses carry no command byte, so commands must be strictly serialized.

| Cmd | Name | Notes |
|---|---|---|
| `14` | INFO | JSON: `SN`, `SoftwareVer`, `BranchCode`, `CurTIME`, `CurBAT` (`"85%"`), `CurBatState`, `FileList` (comma separated), `CurOxiThr`, `OxiSwitch`, `HRSwitch`, `HRLowThr`, `HRHighThr`, `CurMotor`, `LightingMode`, `LightStr`, … |
| `16` | PARA_SYNC | JSON with string values, e.g. `{"SetTIME":"2026-09-28,22:30:00"}`, `SetOxiThr`, `SetMotor`, … |
| `03` / `04` / `05` | read start (`name\0` → size u32) / read chunk (`pktNo` = chunk index) / read end | |
| `17` | RT_PARAM | SpO₂, PR u16, steps u32, battery %, battery state, motion, PI×10, lead bit |
| `1B` | RT_WAVE (payload `00`) | values + pleth |

**Never sent:** `18` factory reset, `19` / `1A` factory programming.

## O2Ring S record file (HW, SDK `OxyIIBleFile`, O2I `OxiDataController::setData`)

```
header   0 fileVersion=1, 1 fileType=3, 2..7 zero, 8..9 deviceModel u16 (4 on the O2Ring S)
samples  N × [spo2, pr, flags]   flags: b0-5 motion, b6 PR reminder, b7 SpO2 reminder
         (2-byte samples when trailer channelType = 0); 0xFF = invalid
trailer  48 bytes at len-48:
   0 checksum u32 = byte sum of everything before the trailer (HW)
   4 magic u32 = 0xDA5A1248 (HW)
   8 start time u32: local wall clock encoded as epoch seconds (HW: matches the file name)
  12 sample count u32     16 interval s     17 channelType     18 bytes/sample
  32 asleep u16  34 avg SpO2  35 min SpO2  36 drops ≥3 %  37 drops ≥4 %  38 % <90
  39 s <90 u16   41 dips <90  42 O2 score ×10 (255 n/a)  43 steps u32  47 avg HR
```

The ring writes the trailer about 2 minutes after it comes off the finger. Before that the file is
the header plus samples only.

## Legacy record file (SDK `OxyBleFile`, O2I old format, OSCAR)

```
 0 version (3; 5 = Checkme O2 Max)   1 mode   2 year u16  4 mon 5 day 6 h 7 m 8 s (local)
 9 size u32   13 duration u16 s   15 asleep u16   17 avg SpO2   18 min SpO2
19 drops ≥3 %   20 drops ≥4 %   21 % <90   22 s <90 u16   24 dips <90   25 O2 score ×10
26 steps u32   30..39 reserved
40.. records × 5: spo2 (0xFF invalid), pr u16 (0xFFFF invalid), motion, flags (0x80 SpO2, 0x40 PR, 0x20 motion reminder)
```

- The interval is `duration / records` (usually 4 s).
- v3 files at "2 s" repeat every sample twice (OSCAR) and are merged back to 4 s.

## Drop detection (`odi_alg_func`, O2I and SDK `libodi-lib.so`)

This is only used when a file has no device drop counts. For each sample S0 and each threshold
th in {2, 3, 4} %:

1. Walk back up to 2 min. Every sample must be valid and greater than S0. The first one at least
   S0 + th is the baseline.
2. The fall rate `th / fall time` must be 0.1–5 %/s.
3. Walk forward up to 10 min, tracking the nadir. The baseline-to-nadir time must stay within
   8–120 s at every step.
4. The drop counts when SpO₂ is back to the baseline within 20 s of the nadir.

ODI in reports = drops / recording duration × 3600 (O2I), shown only for recordings of at least
1 h.
