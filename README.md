# ME10 PTP Test Suite — Quick Start

**For Macnica lab engineers · Hardware-first · Est. time: 5 min to first results**

---

## Prerequisites

Before launching the app, confirm your bench is ready:

- [ ] ME10 DUT powered on and network-connected
- [ ] `ptp4l` running on the ME10 (`systemctl status ptp4l`)
- [ ] Grand Master (Meinberg LANTIME or equivalent) active on the same L2 segment
- [ ] `time_stamping hardware` set in `/etc/ptp4l.conf` on the ME10
- [ ] SSH access to the ME10 from your lab PC (`ssh root@<DUT_IP>`)
- [ ] UDP ports 319 and 5004 open between lab PC and ME10

---

## Launch

```bash
# From the repo root
npm install
npm run dev
# Open http://localhost:5173
```

---

## 4-Step Workflow

### Step 1 — Enter IP addresses (Config tab)

| Field | What to enter |
|---|---|
| DUT IP | ME10 Ethernet IP (e.g. `192.168.1.100`) |
| GM IP | Grand Master IP (e.g. `192.168.1.1`) |
| PTP Domain | `0` (ST 2059-2 default — must match GM config) |

> These are not display fields. Every test group is gated on the reachability
> of these addresses. Wrong IP = locked tests.

---

### Step 2 — Run pre-flight (Pre-flight tab)

Click **▶ Run Pre-flight**. Ten checks run in sequence:

```
✓ DUT reachability       192.168.1.100 → 0.52 ms RTT
✓ GM reachability        192.168.1.1   → 0.31 ms RTT
✓ PTP port open (319)    UDP 319 open on DUT
✓ GM PTP port (319)      GM transmitting Announce
✓ SSH to DUT             TCP 22 open — log/register reads ready
✓ PTP domain match       domain 0 on DUT and GM
✓ HW timestamps enabled  time_stamping=hardware confirmed
✓ GM clock locked        clockClass=6 (GPS-disciplined)
✓ Network loss < 1%      estimated path loss: 0.002%
✓ RTP/media port         UDP 5004 open on DUT
```

Header changes from **SIM MODE** → **NETWORK READY** when all checks pass.

**If a check fails**, the log tells you exactly what to fix:

| Failure | Fix |
|---|---|
| `dut_ping` fails | Check cable / VLAN / ME10 IP config |
| `ptp_port` fails | `systemctl start ptp4l` on ME10 |
| `hw_ts` fails | Set `time_stamping hardware` in `/etc/ptp4l.conf`, restart ptp4l |
| `gm_locked` warns | Verify GPS lock on Meinberg — wait for `clockClass ≤ 7` |
| `dut_ssh` fails | `systemctl start ssh` on ME10 Zynq Linux |

Test groups stay locked until their required checks pass. Re-click **Run Pre-flight** after fixing.

---

### Step 3 — Run the suite (Test Cases tab)

Click **▶ Run Full Suite** in the header.

Tests run sequentially across all 7 groups. Watch the log console for live results:

```
════ FULL SUITE @ 09:14:22 ════
  DUT: 192.168.1.100  GM: 192.168.1.1  domain: 0
  ✓ PTP-101 — lock_time_s = 11.4 s (≤ 30)
  ✓ PTP-102 — tlv_errors = 0 err (≤ 0)
  ✓ PTP-104 — hw_sw_ratio = 17.2 × (≥ 10)
  ...
  ✗ PTP-302 — offset_stddev = 94.1 ns (≤ 80)
       ⚠ 8% loss degrades servo — check switch QoS
```

You can also run a single group using **▶ Run Group**, or re-run one test
with the ▶ button on its row.

---

### Step 4 — Check results and export report

**Test Cases tab** — green = pass, red = fail, sparkline shows trend across runs.

**Report tab** — full tabular summary. Screenshot or print for your certification evidence package. Includes DUT IP, GM IP, pre-flight score, and per-test measured values.

The header badge shows **✓ CERT READY** only when all 34 tests pass.

---

## Key Pass/Fail Thresholds

| Test | Metric | Must be |
|---|---|---|
| PTP-101 | Lock time | ≤ 30 s |
| PTP-205 | 1 PPS phase error vs GM | ≤ 500 ns |
| PTP-302 | Servo offset stddev | ≤ 80 ns |
| PTP-401 | RTCP SR NTP error | ≤ 300 ns |
| PTP-502 | Multi-screen VSYNC delta | ≤ 63.5 µs |
| PTP-503 | A/V lip-sync | ≤ 40 ms |
| PTP-601 | Holdover drift (60 s) | ≤ 10 µs |
| PTP-305 | 8-hour regressions | 0 |

---

## Common Issues

**Tests are locked with 🔒**  
Pre-flight has a failing check. Go to the Pre-flight tab, read the failure detail, fix it, and click Run Pre-flight again.

**PTP-302 (servo stddev) keeps failing**  
Usually switch QoS. PTP traffic must be prioritized (DSCP EF or 802.1p COS 7). Check your switch config.

**PTP-104 (HW/SW timestamping ratio) fails**  
`time_stamping` is set to `software` in `ptp4l.conf`. Change it to `hardware` and restart ptp4l. This is the single most common configuration error.

**GM clockClass warning**  
The Meinberg hasn't acquired GPS lock yet, or the antenna has an issue. `clockClass` must be ≤ 7 for IPMX certification. Check the Meinberg front panel.

**PTP-601 (holdover) fails**  
SI514 VCXO free-run drift is outside spec. Check ambient temperature — the SI514 is sensitive to thermal gradients. Allow the board to thermally stabilize before running holdover tests.

---

## Fault Injection (Optional)

Use the **Config** tab sliders to simulate real-world stress conditions before certification:

| Scenario | Setting |
|---|---|
| Verify HW timestamp requirement | Toggle HW Timestamps OFF — PTP-104 must fail |
| Test BMCA against a rogue GM | Toggle Rogue GM ON — PTP-103 and PTP-602 activate |
| Simulate aging VCXO | VCXO Aging > 50% — watch PTP-202, 301, 403 trend |
| Validate asymmetry correction | Path Asymmetry = 500 ns — PTP-603 should still pass with `delayAsymmetry` set |

Run a fault injection scenario, verify the expected tests fail (confirms the suite detects what it claims to detect), then restore defaults and run the certification baseline.

---

## Files

| File | Purpose |
|---|---|
| `ME10_PTP_TestSuite.jsx` | The complete React application |
| `ME10_PTP_TestSuite_README.md` | Full reference documentation |
| `ME10_PTP_Validation_Test_Plan_v1.0.docx` | Formal test plan (Word) |
| `ME10_PTP_Validation_Test_Plan_v1.0.pdf` | Formal test plan (PDF) |
| `me10_ptp_validation_testplan.html` | Interactive HTML version |

---

*Macnica Americas · Peter Mbua, Staff FPGA/RTL Engineer · Plano, TX*  
*IEEE 1588-2019 · SMPTE ST 2059-2 · IPMX · ST 2110*
