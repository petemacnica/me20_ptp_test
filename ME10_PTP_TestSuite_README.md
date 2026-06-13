# ME10 PTP Certification Test Suite

**Version:** 1.1  
**Platform:** MPA1000 / ME10 ProAV IP Media Transport Module  
**Organization:** Macnica Americas · Esenet Research Group LLC  
**Standards:** IEEE 1588-2019 · SMPTE ST 2059-2 · IPMX · AES67-2018

---

## What This Tool Is

This is a pre-certification validation suite for the ME10 encoder and decoder. Its purpose is to verify IEEE 1588 PTP synchronization end-to-end — from Grand Master lock acquisition through RTP timestamp alignment, media lip-sync, holdover behavior, and third-party interoperability — before formal IPMX and ST 2059-2 certification submission.

Running the full suite successfully on your lab bench means you enter certification with known-good results and no surprises.

The tool ships as a single React file (`ME10_PTP_TestSuite.jsx`) that runs in the browser. It currently executes as a **physics-based simulator** that models the real ME10 two-layer clock architecture. The path to real hardware is a thin Python agent (`me10_ptp_agent.py`) that the UI calls over WebSocket — described in the [Real Hardware Integration](#real-hardware-integration) section below.

---

## Architecture the Tool Models

The simulation engine is built directly from the MPA1000 System Architecture v1.00. Every test case corresponds to a specific behavior in one of two clock discipline layers:

**Layer 1 — Frequency (SI514 VCXO + PI servo)**  
`linuxptp` (`ptp4l`) measures offset-from-master, runs a PI controller (default Kp=0.7 / Ki=0.3), and writes frequency correction words to the SI514 VCXO over I²C. This loop is what drives the 125 MHz reference clock toward the Grand Master.

**Layer 2 — Phase (Epoch Timer PHC)**  
The `epoch_counter.sv` RTL module divides the 125 MHz SI514 output to 100 MHz via a sigma-delta divider, implements the PTP Hardware Clock (PHC), and exposes three software phase-correction modes: direct absolute set (at boot), one-shot step (for residual static offset), and monotonic slew (for corrections that must never step backward). The `timelabel_gen.v` module derives 90 kHz video and 48 kHz audio RTP counters from the same 125 MHz reference, deliberately decoupled from the 100 MHz PTP tick to preserve RTP monotonicity during phase adjustments.

---

## File Structure

```
ME10_PTP_TestSuite.jsx       ← The complete React application (single file)
ME10_PTP_TestSuite_README.md ← This file
```

When you are ready to move to real hardware, you will also need:

```
me10_ptp_agent.py            ← Python backend (SSH + scapy + WebSocket server)
                               Build this by replacing simTest() with
                               fetch('/api/run?id=PTP-xxx') calls
```

---

## Components

### 1. Pre-flight Tab

The first thing you do before running any tests. Enter your DUT and GM IP addresses in Config, then click **Run Pre-flight**. The tool runs 10 sequential network and configuration checks:

| Check | What it probes | Blocks if it fails |
|---|---|---|
| `dut_ping` | ICMP to DUT IP | All DUT-dependent groups |
| `gm_ping` | ICMP to GM IP | PTP-3xx, 5xx, 6xx, 7xx |
| `ptp_port` | UDP 319 on DUT | PTP-1xx (ptp4l not running) |
| `gm_ptp_port` | UDP 319 on GM | PTP-1xx, 7xx |
| `dut_ssh` | TCP 22 on DUT | PTP-2xx, 4xx (log/reg reads) |
| `ptp_domain` | Domain number match | Warning only (non-zero domain) |
| `hw_ts` | `time_stamping=hardware` | PTP-3xx (servo accuracy) |
| `gm_locked` | GM `clockClass ≤ 7` | PTP-3xx, 5xx, 6xx, 7xx |
| `network_loss` | Estimated path loss | Warning if > 1% |
| `rtp_port` | UDP 5004 on DUT | PTP-4xx, 5xx, 7xx |

A check failure does not just show a warning — it **locks** every test group that depends on it. Locked groups display a 🔒 badge and their run buttons are disabled. This prevents running tests that will produce meaningless results due to a missing network condition.

The topology strip at the top of the pre-flight tab shows a live diagram of GM → ME10 DUT → Lab PC Agent with per-node reachability status and RTT.

The mode pill in the header changes from **SIM MODE** (purple) to **NETWORK READY** (green) once all blocking checks pass.

---

### 2. Test Cases Tab

34 test cases across 7 groups. Each test shows:

- A status dot (grey = not run, amber = running, green = pass, red = fail)
- The test ID and name
- The measured value and unit when complete
- A sparkline of the last 20 runs for trending
- A PASS / FAIL badge with timestamp
- An individual ▶ run button

You can run a single test, a full group, or the entire suite. Groups blocked by pre-flight failures show the specific failing check ID so you know exactly what to fix.

The log console at the bottom streams every result in real time, including root-cause hints for common failures — for example, if PTP-104 fails because hardware timestamps are disabled, the log prints the exact `ptp4l.conf` line to change and the DUT IP address to change it on.

#### Test Groups

| Group | Area | Key thresholds |
|---|---|---|
| **PTP-1xx** | Stack & BMCA | Lock ≤ 30 s · two-step flag 100% · Delay_Req 7–9/s |
| **PTP-2xx** | PHC / Epoch Timer | 1 PPS error ≤ 500 ns · monotonic slew: zero backward steps |
| **PTP-3xx** | SI514 VCXO Servo | Cold-start lock ≤ 120 s · stddev ≤ 80 ns · 8 h: zero regressions |
| **PTP-4xx** | RTP Timestamps | RTCP SR NTP error ≤ 300 ns · video RTP ≤ 50 ppm · audio RTP ≤ 50 ppm |
| **PTP-5xx** | Media Sync | VSYNC delta ≤ 63.5 µs · A/V lip-sync ≤ 40 ms |
| **PTP-6xx** | Holdover & Recovery | 60 s GM loss drift ≤ 10 µs · power cycle recovery ≤ 90 s |
| **PTP-7xx** | Interoperability | Meinberg GM offset ≤ 100 ns · AES67 zero dropouts · NMOS IS-04 fields correct |

---

### 3. Config Tab

All parameters that affect both pre-flight checks and the test simulation engine.

**Network addresses** — these are not cosmetic. The DUT IP drives the ICMP ping, the UDP 319 and 5004 port probes, and the TCP 22 SSH check. The GM IP drives its own ping, its port probe, the `clockClass` check, and the PTP domain cross-check. Both addresses appear in the certification report. Typing an invalid IPv4 format shows a red border and blocks pre-flight from running.

A **Re-run Pre-flight** button lets you update IPs and immediately re-validate without leaving the config view.

**PI servo parameters** — Kp and Ki sliders. Default values (0.7 / 0.3) match the MPA1000 System Architecture v1.00 reference. Changing these affects the servo convergence simulation in PTP-301 through PTP-305.

**Fault injection** — toggles and sliders that stress-test specific test cases:

| Control | Effect on tests |
|---|---|
| HW Timestamps off | PTP-104, 205, 302, 401, 701 degrade significantly |
| Rogue GM on | PTP-103, 602 BMCA rejection scenarios activate |
| Network Loss > 5% | PTP-302 servo stability and PTP-604 packet loss tests fail |
| Path Asymmetry > 0 | PTP-603 asymmetry correction test activates |
| VCXO Aging > 50% | PTP-202, 301, 303, 403, 404 drift toward threshold |

---

### 4. Report Tab

A full tabular summary of every test result, formatted for inclusion in a certification submission package. Shows:

- Document number (MACNICA-ME10-PTP-TP-001), date, and overall PASS / FAIL verdict
- Summary stat cards: DUT IP, GM IP, pre-flight score, test score
- Per-test table: ID, name, metric name, measured value, threshold, status
- Config snapshot at the bottom: HW timestamps, Kp/Ki, video mode

---

## How to Use It — Step by Step

**Step 1 — Set your IP addresses**  
Go to **Config** and enter the ME10 DUT IP and the Grand Master IP. These should be the actual addresses on your lab network.

**Step 2 — Run pre-flight**  
Click **Pre-flight** in the sidebar, then click **Run Pre-flight**. Watch the topology strip and checks table resolve. Fix any failures before proceeding — the log console tells you exactly what each failure means.

**Step 3 — Configure fault conditions**  
In **Config**, set fault injection parameters to match your intended test scenarios. Start with all defaults (HW timestamps on, no loss, no asymmetry) for a baseline clean run.

**Step 4 — Run the full suite**  
Once the header shows **NETWORK READY**, click **▶ Run Full Suite**. Tests run sequentially. Blocked groups are skipped with a log entry explaining which pre-flight check caused the block.

**Step 5 — Analyze results**  
Switch to **Test Cases** to inspect individual results and sparkline trends. The log console shows root-cause hints for every failure. Re-run individual tests after fixing issues using the ▶ button on each row.

**Step 6 — Export the report**  
Go to **Report** and screenshot or print the results table. This document, together with the `ME10_PTP_Validation_Test_Plan_v1.0.docx`, constitutes your pre-certification evidence package.

---

## Real Hardware Integration

The tool currently simulates all measurements. To connect it to the real ME10 on your bench, build a Python backend agent that replaces the `simTest()` function with actual measurements.

**What the agent needs to do:**

```python
# 1. SSH into the ME10 and parse ptp4l logs
#    GET /api/run?id=PTP-302 → ssh root@{dutIp} journalctl -u ptp4l | tail -600

# 2. Read PHC registers over SSH
#    GET /api/run?id=PTP-205 → ssh root@{dutIp} phc_ctl /dev/ptp0 get

# 3. Sniff RTCP SR and PTP packets on the lab NIC
#    GET /api/run?id=PTP-401 → scapy sniff(iface="eth0", filter="udp port 5004")

# 4. Inject SI514 frequency steps over I2C (fault injection for PTP-303)
#    GET /api/run?id=PTP-303 → ssh root@{dutIp} i2cset -y 0 0x55 <freq_word>

# 5. Serve all results to the React UI over WebSocket
#    ws://localhost:8765 → { testId, value, passed, unit, timestamp }
```

In `ME10_PTP_TestSuite.jsx`, replace:
```js
const result = simTest(test.id, config);
```
with:
```js
const result = await fetch(`/api/run?id=${test.id}&dut=${config.dutIp}`).then(r => r.json());
```

The UI, pass/fail logic, log console, blocking, and reporting all remain unchanged.

---

## Pass/Fail Summary

| Metric | Pass Threshold | Certification Requirement |
|---|---|---|
| PTP lock time (cold start) | ≤ 120 s | IPMX pre-condition |
| Steady-state offset stddev | ≤ 80 ns | ST 2059-2 T-BC class |
| 1 PPS phase error (1 h) | ≤ 500 ns | ST 2059-2 accuracy |
| RTCP SR NTP timestamp error | ≤ 300 ns | IPMX RTP alignment |
| Multi-screen VSYNC delta | ≤ 63.5 µs | ST 2110-21 sync output |
| A/V lip-sync | ≤ 40 ms | SMPTE RP 37 |
| Holdover drift (60 s GM loss) | ≤ 10 µs | SI514 free-run spec |
| 8-hour run regressions | 0 | IPMX stability |
| AES67 audio dropouts | 0 | AES67-2018 |

All 34 tests must pass for the certification readiness indicator to show **✓ CERT READY**.

---

## Related Documents

- `ME10_PTP_Validation_Test_Plan_v1.0.docx` — full Word test plan with procedure steps and equipment list  
- `ME10_PTP_Validation_Test_Plan_v1.0.pdf` — PDF version of the test plan  
- `me10_ptp_validation_testplan.html` — interactive HTML version for the ST2110 documentation hub  
- `index.html` — updated ST2110 Clock Recovery Documentation index linking all docs  

---

*© 2026 Macnica Americas · Peter Mbua, Staff FPGA/RTL Engineer · Plano, TX*  
*peter.mbua.ctr@macnica.com · SMPTE ST2110 · IEEE 1588 PTP · Professional Broadcast Timing*
