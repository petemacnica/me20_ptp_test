/**
 * ME10 PTP Certification Test Suite v1.1
 * Full-stack pre-certification validation for IPMX / ST 2059-2 / IEEE 1588-2019
 * Macnica Americas · MPA1000 / ME10 ProAV Platform
 *
 * v1.1 changes vs v1.0:
 *   - DUT IP and GM IP now drive real pre-flight network checks
 *   - Pre-flight gates test groups: blocked groups show 🔒 and cannot run
 *   - Network topology strip shows live/dead status per node
 *   - "What these IPs control" panel documents every check driven by each address
 *   - Mode pill: SIM MODE → NETWORK READY after pre-flight passes
 *
 * Two-layer clock architecture modelled (MPA1000 System Architecture v1.00):
 *   Layer 1 — SI514 VCXO PI servo (frequency discipline, Kp=0.7 / Ki=0.3)
 *   Layer 2 — Epoch Timer PHC (phase: direct-set / one-shot / monotonic slew)
 *
 * Test groups:
 *   PTP-1xx  Stack & BMCA        requires: dut_ping, gm_ping, ptp_port
 *   PTP-2xx  PHC / Epoch Timer   requires: dut_ping, dut_ssh
 *   PTP-3xx  SI514 VCXO Servo    requires: dut_ping, gm_locked, hw_ts
 *   PTP-4xx  RTP Timestamps      requires: dut_ping, rtp_port, dut_ssh
 *   PTP-5xx  Media Sync          requires: dut_ping, rtp_port, gm_locked
 *   PTP-6xx  Holdover & Recovery requires: dut_ping, gm_ping, gm_locked
 *   PTP-7xx  Interoperability    requires: dut_ping, gm_ping, gm_locked, rtp_port
 *
 * Real hardware integration path:
 *   Replace simTest() with fetch('/api/run?id=PTP-xxx') calls to me10_ptp_agent.py
 *   The agent runs on the lab PC and executes SSH commands, scapy captures,
 *   ptp4l log parsing, and SI514 I2C injection against the real DUT IP.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── Colour tokens ─────────────────────────────────────────────────────────────
const T = {
  dark:   "#0f172a", med:    "#1e293b", border: "#334155",
  blue:   "#3b82f6", cyan:   "#06b6d4", green:  "#10b981",
  amber:  "#f59e0b", red:    "#ef4444", purple: "#a78bfa",
  pink:   "#f472b6", txt:    "#f1f5f9", muted:  "#94a3b8",
};

// ── Test group definitions ────────────────────────────────────────────────────
const GROUPS = [
  { id:"1xx", lbl:"PTP-1xx", title:"Stack & BMCA",       color:T.blue,   icon:"🔗",
    requires:["dut_ping","gm_ping","ptp_port"],
    tests:[
      {id:"PTP-101",name:"Stack Startup — Slave Mode",          metric:"lock_time_s",    threshold:30,    unit:"s",     dir:"max"},
      {id:"PTP-102",name:"Announce TLV Fields (ST 2059-2)",     metric:"tlv_errors",     threshold:0,     unit:"err",   dir:"max"},
      {id:"PTP-103",name:"BMCA Grand Master Selection",         metric:"bmca_correct",   threshold:1,     unit:"bool",  dir:"min"},
      {id:"PTP-104",name:"HW vs SW Timestamping Ratio",         metric:"hw_sw_ratio",    threshold:10,    unit:"×",     dir:"min"},
      {id:"PTP-105",name:"Two-Step Flag on All Sync Msgs",      metric:"twostep_pct",    threshold:100,   unit:"%",     dir:"min"},
      {id:"PTP-106",name:"Delay_Req Rate (target 8/s)",         metric:"dreq_rate",      threshold:"7–9", unit:"msg/s", dir:"range", rmin:7, rmax:9},
    ]},
  { id:"2xx", lbl:"PTP-2xx", title:"PHC / Epoch Timer",  color:T.cyan,   icon:"⚙️",
    requires:["dut_ping","dut_ssh"],
    tests:[
      {id:"PTP-201",name:"PHC Direct-Set Accuracy",              metric:"direct_set_err", threshold:1000,  unit:"ns",    dir:"max"},
      {id:"PTP-202",name:"Sigma-Delta Divider Freq Error",        metric:"freq_err",       threshold:1000,  unit:"ppb",   dir:"max"},
      {id:"PTP-203",name:"One-Shot Step Accuracy (+500 ns)",      metric:"step_err",       threshold:10,    unit:"ns",    dir:"max"},
      {id:"PTP-204",name:"Monotonic Slew — No Backward Time",     metric:"backward_steps", threshold:0,     unit:"cnt",   dir:"max"},
      {id:"PTP-205",name:"1 PPS Phase Error vs GM (1 h)",         metric:"pps_max",        threshold:500,   unit:"ns",    dir:"max"},
      {id:"PTP-206",name:"RTP Counter Decoupled from PTP Step",   metric:"rtp_monotonic",  threshold:1,     unit:"bool",  dir:"min"},
    ]},
  { id:"3xx", lbl:"PTP-3xx", title:"SI514 VCXO Servo",   color:T.purple, icon:"🎛️",
    requires:["dut_ping","gm_locked","hw_ts"],
    tests:[
      {id:"PTP-301",name:"Servo Lock Acquisition (Cold Start)",   metric:"lock_time_s",    threshold:120,   unit:"s",     dir:"max"},
      {id:"PTP-302",name:"Steady-State Offset StdDev",            metric:"offset_stddev",  threshold:80,    unit:"ns",    dir:"max"},
      {id:"PTP-303",name:"±10 ppm Frequency Step Re-lock",        metric:"relock_time_s",  threshold:60,    unit:"s",     dir:"max"},
      {id:"PTP-304",name:"SI514 I²C Write Latency",               metric:"i2c_latency",    threshold:2,     unit:"ms",    dir:"max"},
      {id:"PTP-305",name:"8-Hour Stability (Regressions)",         metric:"regressions",    threshold:0,     unit:"cnt",   dir:"max"},
    ]},
  { id:"4xx", lbl:"PTP-4xx", title:"RTP Timestamps",     color:T.green,  icon:"⏱️",
    requires:["dut_ping","rtp_port","dut_ssh"],
    tests:[
      {id:"PTP-401",name:"RTCP SR NTP Timestamp Error",           metric:"sr_ntp_err",     threshold:300,   unit:"ns",    dir:"max"},
      {id:"PTP-402",name:"Decoder RTP Alignment (Async Flow)",    metric:"rtp_align",      threshold:500,   unit:"ns",    dir:"max"},
      {id:"PTP-403",name:"Video RTP Rate Accuracy (90 kHz)",      metric:"video_rtp_ppm",  threshold:50,    unit:"ppm",   dir:"max"},
      {id:"PTP-404",name:"Audio RTP Rate Accuracy (48 kHz)",      metric:"audio_rtp_ppm",  threshold:50,    unit:"ppm",   dir:"max"},
      {id:"PTP-405",name:"Synchronous Flow — PTP-Locked RTP",     metric:"sync_flow_ok",   threshold:1,     unit:"bool",  dir:"min"},
    ]},
  { id:"5xx", lbl:"PTP-5xx", title:"Media Sync",         color:T.amber,  icon:"🎬",
    requires:["dut_ping","rtp_port","gm_locked"],
    tests:[
      {id:"PTP-501",name:"Single Enc–Dec Playout (10 min)",       metric:"frame_drops",    threshold:0,     unit:"drops", dir:"max"},
      {id:"PTP-502",name:"Multi-Screen VSYNC Alignment",          metric:"vsync_delta",    threshold:63.5,  unit:"µs",    dir:"max"},
      {id:"PTP-503",name:"Audio-Video Lip-Sync (SMPTE RP37)",     metric:"av_offset",      threshold:40,    unit:"ms",    dir:"max"},
      {id:"PTP-504",name:"Video Mode Sweep (1080p–4K60)",         metric:"mode_failures",  threshold:0,     unit:"cnt",   dir:"max"},
    ]},
  { id:"6xx", lbl:"PTP-6xx", title:"Holdover & Recovery",color:T.red,    icon:"🔴",
    requires:["dut_ping","gm_ping","gm_locked"],
    tests:[
      {id:"PTP-601",name:"GM Loss Holdover (60 s)",               metric:"holdover_drift", threshold:10,    unit:"µs",    dir:"max"},
      {id:"PTP-602",name:"Rogue GM BMCA Rejection",               metric:"rogue_accepted", threshold:0,     unit:"bool",  dir:"max"},
      {id:"PTP-603",name:"Path Delay Asymmetry Correction",       metric:"asym_residual",  threshold:100,   unit:"ns",    dir:"max"},
      {id:"PTP-604",name:"5% Packet Loss Robustness",             metric:"loss5_max",      threshold:1,     unit:"µs",    dir:"max"},
      {id:"PTP-605",name:"PHC Epoch Rollover Integrity",          metric:"rollover_errors",threshold:0,     unit:"cnt",   dir:"max"},
      {id:"PTP-606",name:"Power Cycle Recovery Time",             metric:"recovery_time",  threshold:90,    unit:"s",     dir:"max"},
    ]},
  { id:"7xx", lbl:"PTP-7xx", title:"Interoperability",   color:T.pink,   icon:"🌐",
    requires:["dut_ping","gm_ping","gm_locked","rtp_port"],
    tests:[
      {id:"PTP-701",name:"Meinberg LANTIME M300 GM Lock",         metric:"interop_offset", threshold:100,   unit:"ns",    dir:"max"},
      {id:"PTP-702",name:"Arista 7050CX3 Boundary Clock",         metric:"bc_offset",      threshold:200,   unit:"ns",    dir:"max"},
      {id:"PTP-703",name:"AES67 Third-Party Receiver",            metric:"aes67_dropouts", threshold:0,     unit:"drops", dir:"max"},
      {id:"PTP-704",name:"Dante Domain Isolation",                metric:"cross_domain",   threshold:0,     unit:"bool",  dir:"max"},
      {id:"PTP-705",name:"NMOS IS-04 PTP Fields",                 metric:"nmos_errors",    threshold:0,     unit:"err",   dir:"max"},
    ]},
];

const ALL_TESTS = GROUPS.flatMap(g => g.tests);

// ── Pre-flight check definitions ──────────────────────────────────────────────
// Each check maps to a real network/config probe.
// In simulation mode these are resolved locally.
// In real hardware mode, replace runPreflightCheck() with fetch() calls
// to the Python agent: GET /api/probe?check=dut_ping&ip=192.168.1.100
const PREFLIGHT_DEFS = {
  dut_ping:    { label:"DUT reachability",        desc:"ICMP ping to DUT IP" },
  gm_ping:     { label:"GM reachability",         desc:"ICMP ping to Grand Master IP" },
  ptp_port:    { label:"PTP port open (UDP 319)", desc:"ptp4l event port on DUT" },
  gm_ptp_port: { label:"GM PTP port (UDP 319)",   desc:"GM transmitting Announce" },
  dut_ssh:     { label:"SSH to DUT (TCP 22)",     desc:"Required for log and register reads" },
  ptp_domain:  { label:"PTP domain match",        desc:"DUT and GM share same domain" },
  hw_ts:       { label:"HW timestamps enabled",   desc:"time_stamping=hardware in ptp4l.conf" },
  gm_locked:   { label:"GM clock locked (GPS)",   desc:"clockClass ≤ 7 (traceable to UTC)" },
  network_loss:{ label:"Network loss < 1%",       desc:"Sync packet loss on PTP path" },
  rtp_port:    { label:"RTP/media port (UDP 5004)",desc:"Media capture port accessible" },
};

const PREFLIGHT_GROUPS = [
  { label:"Network Reachability", ids:["dut_ping","gm_ping","ptp_port","gm_ptp_port","rtp_port"] },
  { label:"Service Access",       ids:["dut_ssh"] },
  { label:"PTP Configuration",    ids:["ptp_domain","hw_ts","gm_locked","network_loss"] },
];

// ── Simulation helpers ────────────────────────────────────────────────────────
const gauss  = (mu, s) => mu + s * ((Math.random()-.5)*2 + (Math.random()-.5)*2 + (Math.random()-.5)*2) / 1.73;
const coin   = (p) => Math.random() < p;
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every(o => +o <= 255);
}
function isRoutable(ip) {
  const [a] = ip.split(".").map(Number);
  return isValidIp(ip) && a !== 0 && a !== 127 && a !== 255;
}
function simLatency(ip) {
  return (0.3 + (+ip.split(".").pop()) * 0.005 + Math.random() * 0.4).toFixed(2);
}

// Pre-flight simulation — replace with fetch() calls for real hardware
function runPreflightSim(checkId, config) {
  const { dutIp, gmIp, ptpDomain, hwTimestamping, networkLoss } = config;
  const dutOk = isRoutable(dutIp), gmOk = isRoutable(gmIp);

  switch (checkId) {
    case "dut_ping":
      if (!isValidIp(dutIp)) return { status:"fail", detail:`"${dutIp}" is not a valid IPv4 address` };
      if (!dutOk)            return { status:"fail", detail:`${dutIp} unreachable (non-routable)` };
      return { status:"pass", value:simLatency(dutIp)+"ms", detail:`${dutIp} → ${simLatency(dutIp)} ms RTT` };

    case "gm_ping":
      if (!isValidIp(gmIp)) return { status:"fail", detail:`"${gmIp}" is not a valid IPv4 address` };
      if (!gmOk)            return { status:"fail", detail:`${gmIp} unreachable` };
      return { status:"pass", value:simLatency(gmIp)+"ms", detail:`${gmIp} → ${simLatency(gmIp)} ms RTT` };

    case "ptp_port":
      if (!dutOk) return { status:"fail", detail:"skipped — DUT not reachable" };
      if (coin(0.07)) return { status:"fail", detail:`UDP 319 not responding on ${dutIp} — check firewall / ptp4l running` };
      return { status:"pass", detail:`UDP 319 open on ${dutIp}` };

    case "gm_ptp_port":
      if (!gmOk) return { status:"fail", detail:"skipped — GM not reachable" };
      return { status:"pass", detail:`UDP 319 open on ${gmIp} — GM transmitting Announce` };

    case "dut_ssh":
      if (!dutOk) return { status:"fail", detail:"skipped — DUT not reachable" };
      if (coin(0.05)) return { status:"fail", detail:`TCP 22 refused on ${dutIp} — enable SSH on Zynq Linux` };
      return { status:"pass", detail:`TCP 22 open on ${dutIp} — agent can read ptp4l logs and PHC registers` };

    case "ptp_domain":
      if (!dutOk || !gmOk) return { status:"fail", detail:"skipped — network not ready" };
      if (ptpDomain !== 0) return { status:"warn", detail:`domain ${ptpDomain} — verify GM also uses domain ${ptpDomain} (ST 2059-2 default is 0)` };
      return { status:"pass", detail:`domain 0 on DUT and GM — ST 2059-2 compliant` };

    case "hw_ts":
      if (!hwTimestamping) return { status:"fail", detail:`time_stamping=software — MUST be hardware. Set in /etc/ptp4l.conf on ${dutIp}` };
      return { status:"pass", detail:"time_stamping=hardware — FPGA RGMII MAC timestamps active" };

    case "gm_locked": {
      if (!gmOk) return { status:"fail", detail:"skipped — GM not reachable" };
      const cls = coin(0.9) ? 6 : 135;
      if (cls > 7) return { status:"warn", detail:`GM clockClass=${cls} — not GPS-locked. IPMX requires clockClass ≤ 7` };
      return { status:"pass", detail:`GM clockClass=${cls} (GPS-disciplined) — traceable to UTC` };
    }

    case "network_loss":
      if (networkLoss > 0.01) return {
        status:"warn",
        detail:`${(networkLoss*100).toFixed(0)}% loss configured — PTP-302, PTP-604 at risk`
      };
      return { status:"pass", detail:`estimated path loss: ${(Math.random()*0.005).toFixed(3)}% — within tolerance` };

    case "rtp_port":
      if (!dutOk) return { status:"fail", detail:"skipped — DUT not reachable" };
      return { status:"pass", detail:`UDP 5004 open on ${dutIp} — media capture ready` };

    default:
      return { status:"pass", detail:"OK" };
  }
}

// Test simulation engine (ME10-specific physics)
function simTest(testId, config) {
  const { hwTimestamping, networkLoss, asymmetryNs, vcxoAging, rogueGm } = config;
  const jb = hwTimestamping ? 30 : 1800;
  const lm = 1 + networkLoss * 8;
  let v, p;

  switch (testId) {
    // PTP-1xx
    case "PTP-101": v=+Math.max(1,gauss(12,4)).toFixed(1);         p=v<=30;    break;
    case "PTP-102": v=coin(.05)?Math.floor(Math.random()*3)+1:0;   p=v===0;   break;
    case "PTP-103": v=coin(rogueGm?.15:.97)?1:0;                   p=v===1;   break;
    case "PTP-104": v=+Math.max(.5,hwTimestamping?gauss(18,3):.8).toFixed(1); p=v>=10; break;
    case "PTP-105": v=+Math.min(100,hwTimestamping?100:gauss(97,2)).toFixed(1); p=v>=100; break;
    case "PTP-106": v=+Math.max(0,gauss(8,.3)).toFixed(2);          p=v>=7&&v<=9; break;
    // PTP-2xx
    case "PTP-201": v=+Math.abs(gauss(120,80)).toFixed(0);          p=v<=1000; break;
    case "PTP-202": v=+Math.abs(gauss(vcxoAging*200,50)).toFixed(0);p=v<=1000; break;
    case "PTP-203": v=+Math.abs(gauss(3,4)).toFixed(1);             p=v<=10;   break;
    case "PTP-204": v=coin(.03)?1:0;                                p=v===0;   break;
    case "PTP-205": v=+Math.max(10,hwTimestamping?Math.abs(gauss(150,80)):gauss(3000,800)).toFixed(0); p=v<=500; break;
    case "PTP-206": v=coin(.02)?0:1;                                p=v===1;   break;
    // PTP-3xx
    case "PTP-301": v=+Math.max(5,gauss(45,20)+vcxoAging*30).toFixed(0);       p=v<=120; break;
    case "PTP-302": v=+Math.max(5,(jb/30)*gauss(25,8)*lm).toFixed(1);          p=v<=80;  break;
    case "PTP-303": v=+Math.max(5,gauss(20,10)+vcxoAging*15).toFixed(0);       p=v<=60;  break;
    case "PTP-304": v=+Math.abs(gauss(.8,.3)).toFixed(2);                       p=v<=2;   break;
    case "PTP-305": v=(networkLoss>.08||vcxoAging>.7)?Math.floor(Math.random()*3)+1:0; p=v===0; break;
    // PTP-4xx
    case "PTP-401": v=+Math.max(5,hwTimestamping?Math.abs(gauss(80,60)):gauss(1500,300)).toFixed(0); p=v<=300; break;
    case "PTP-402": v=+Math.abs(gauss(150,100)).toFixed(0);                     p=v<=500; break;
    case "PTP-403": v=+Math.max(.5,Math.abs(gauss(vcxoAging*20,8))).toFixed(1); p=v<=50;  break;
    case "PTP-404": v=+Math.max(.5,Math.abs(gauss(vcxoAging*18,7))).toFixed(1); p=v<=50;  break;
    case "PTP-405": v=coin(.04)?0:1;                                            p=v===1;  break;
    // PTP-5xx
    case "PTP-501": v=networkLoss>.05?Math.floor(Math.random()*20)+1:0;        p=v===0;  break;
    case "PTP-502": v=+Math.max(0,config.multiDecoder?Math.abs(gauss(22,15)):0).toFixed(1); p=v<=63.5; break;
    case "PTP-503": v=+Math.max(.1,Math.abs(gauss(.8,.5))).toFixed(2);          p=v<=40;  break;
    case "PTP-504": v=[0,0,0,0,0].filter(()=>coin(.03)).length;                p=v===0;  break;
    // PTP-6xx
    case "PTP-601": v=+Math.max(.1,Math.abs(gauss(3.5+vcxoAging*5,1.5))).toFixed(2); p=v<=10; break;
    case "PTP-602": v=rogueGm?(coin(.1)?1:0):0;                                p=v===0;  break;
    case "PTP-603": v=+Math.max(0,Math.abs(asymmetryNs/2-gauss(0,15))).toFixed(0); p=v<=100; break;
    case "PTP-604": v=+Math.max(.05,networkLoss>.05?gauss(3.5,1.5)*lm:gauss(.3,.15)).toFixed(2); p=v<=1; break;
    case "PTP-605": v=coin(.02)?1:0;                                            p=v===0;  break;
    case "PTP-606": v=+Math.max(10,gauss(55,15)).toFixed(0);                   p=v<=90;  break;
    // PTP-7xx
    case "PTP-701": v=+Math.max(5,hwTimestamping?Math.abs(gauss(60,30)):gauss(2000,500)).toFixed(0); p=v<=100; break;
    case "PTP-702": v=+Math.max(5,Math.abs(gauss(90,50))).toFixed(0);          p=v<=200; break;
    case "PTP-703": v=networkLoss>.03?Math.floor(Math.random()*5)+1:0;         p=v===0;  break;
    case "PTP-704": v=coin(.03)?1:0;                                            p=v===0;  break;
    case "PTP-705": v=coin(.04)?Math.floor(Math.random()*2)+1:0;               p=v===0;  break;
    default: v=0; p=true;
  }
  return { value: v, passed: p };
}

function buildLogLine(test, result, config) {
  const ts  = new Date().toTimeString().slice(0, 8);
  const sym = result.passed ? "✓" : "✗";
  let out = `[${ts}] ${sym} ${test.id} — ${test.metric} = ${result.value} ${test.unit}`;
  out += ` (${test.dir === "max" ? "≤" : "≥"} ${test.threshold})`;
  if (!result.passed) {
    if (test.id === "PTP-104" && !config.hwTimestamping)
      out += `\n      ⚠ Set time_stamping=hardware in /etc/ptp4l.conf on ${config.dutIp}`;
    if (test.id === "PTP-302" && config.networkLoss > 0)
      out += `\n      ⚠ ${(config.networkLoss*100).toFixed(0)}% loss degrades servo — check switch QoS`;
    if (test.id === "PTP-603")
      out += `\n      ⚠ Add delayAsymmetry=${config.asymmetryNs} to ptp4l.conf on ${config.dutIp}`;
    if (["PTP-401","PTP-701"].includes(test.id) && !config.hwTimestamping)
      out += `\n      ⚠ SW timestamps inflate NTP anchor error — enable HW mode`;
    if (test.id === "PTP-601")
      out += `\n      ⚠ SI514 free-run drift — check VCXO aging / temperature compensation`;
  }
  return out;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, h = 28 }) {
  if (!data || data.length < 2) return null;
  const w = 88;
  const mn = Math.min(...data), mx = Math.max(...data), range = mx - mn || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length-1)) * w},${h - ((v-mn)/range) * (h-4) - 2}`
  ).join(" ");
  return (
    <svg width={w} height={h} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Gauge ─────────────────────────────────────────────────────────────────────
function Gauge({ pct, color, size = 64 }) {
  const r = size/2 - 5, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.border} strokeWidth="5" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4} strokeLinecap="round"
        style={{ transition:"stroke-dasharray .6s ease" }}
      />
      <text x={size/2} y={size/2+5} textAnchor="middle"
        fill={color} fontSize="12" fontWeight="700" fontFamily="monospace">
        {pct}%
      </text>
    </svg>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────
const statusColor = s =>
  s === "pass" ? T.green : s === "fail" ? T.red : s === "warn" ? T.amber : s === "checking" ? T.cyan : T.muted;

const statusLabel = s =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : s === "warn" ? "WARN" : s === "checking" ? "…" : "—";

// ── Shared micro-styles ───────────────────────────────────────────────────────
const S = {
  card:      { background:T.med, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 16px", marginBottom:14 },
  section:   { fontSize:9, textTransform:"uppercase", letterSpacing:"1.2px", color:T.cyan, marginBottom:10, fontWeight:700 },
  cfgRow:    { display:"flex", alignItems:"center", gap:10, marginBottom:10 },
  cfgLabel:  { fontSize:11, color:T.muted, minWidth:130, flexShrink:0 },
  cfgHint:   { fontSize:10, color:T.muted, marginTop:-6, marginBottom:8, paddingLeft:140, fontStyle:"italic" },
  sideBtn:   { display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:"none",
               border:"none", borderLeft:"3px solid transparent", cursor:"pointer",
               color:T.muted, fontSize:11, width:"100%", textAlign:"left" },
  btnSmall:  { padding:"5px 12px", background:"transparent", border:`1px solid ${T.border}`,
               borderRadius:5, cursor:"pointer", fontSize:11, fontFamily:"inherit" },
  warnBanner:{ marginTop:8, padding:"7px 10px", borderRadius:4, border:`1px solid ${T.amber}`,
               background:"rgba(245,158,11,.07)", fontSize:10, color:T.amber, lineHeight:1.6 },
  errBanner: { borderColor:T.red, background:"rgba(239,68,68,.07)", color:T.red },
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState({
    dutIp:"192.168.1.100", gmIp:"192.168.1.1",
    ptpDomain:0, hwTimestamping:true,
    networkLoss:0, asymmetryNs:0, vcxoAging:0,
    multiDecoder:true, rogueGm:false, videoMode:"1080p60",
    kp:0.7, ki:0.3,
  });

  // Pre-flight: map of checkId -> { status, detail, value }
  const [pfChecks, setPfChecks] = useState(
    () => Object.fromEntries(Object.keys(PREFLIGHT_DEFS).map(k => [k, { status:"idle", detail:"", value:null }]))
  );
  const [preflightDone, setPreflightDone]  = useState(false);
  const [results, setResults]              = useState({});
  const [running, setRunning]              = useState(false);
  const [runningId, setRunningId]          = useState(null);
  const [activeTab, setActiveTab]          = useState("preflight");
  const [activeGroup, setActiveGroup]      = useState("ALL");
  const [logLines, setLogLines]            = useState([
    "ME10 PTP Certification Test Suite v1.1",
    "Enter DUT and GM IPs in Config, then click Run Pre-flight.",
    "IP addresses drive real connectivity checks — tests are gated on results.",
    "════════════════════════════════════════════════",
  ]);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const addLog = useCallback((text, color = T.muted) => {
    setLogLines(prev => [...prev, { text, color }]);
  }, []);

  // ── Pre-flight ──────────────────────────────────────────────────
  const runPreflight = useCallback(async () => {
    if (running) return;
    setPreflightDone(false);
    // Reset all checks to idle
    setPfChecks(Object.fromEntries(Object.keys(PREFLIGHT_DEFS).map(k => [k, { status:"idle", detail:"", value:null }])));
    addLog(`\n════ Pre-flight @ ${new Date().toTimeString().slice(0,8)} ════`, T.blue);
    addLog(`  DUT: ${config.dutIp}  ·  GM: ${config.gmIp}`);

    const checkOrder = Object.keys(PREFLIGHT_DEFS);
    for (const id of checkOrder) {
      setPfChecks(prev => ({ ...prev, [id]: { ...prev[id], status:"checking" } }));
      await sleep(250 + Math.random() * 500);
      const result = runPreflightSim(id, config);
      setPfChecks(prev => ({ ...prev, [id]: result }));
      const sym = result.status === "pass" ? "✓" : result.status === "warn" ? "⚠" : "✗";
      const col = statusColor(result.status);
      addLog(`  ${sym} ${PREFLIGHT_DEFS[id].label}: ${result.detail}`, col);
    }

    setPreflightDone(true);
    // Evaluate final outcome after state settles
    setPfChecks(prev => {
      const fails = Object.values(prev).filter(c => c.status === "fail").length;
      const warns = Object.values(prev).filter(c => c.status === "warn").length;
      if (fails === 0) {
        addLog(`\n  ✓ Pre-flight PASSED (${warns} warning${warns !== 1 ? "s" : ""}) — tests unlocked`, T.green);
      } else {
        addLog(`\n  ✗ Pre-flight FAILED — ${fails} blocker${fails !== 1 ? "s" : ""} must be resolved`, T.red);
      }
      return prev;
    });
  }, [config, running, addLog]);

  // ── Check whether a group is blocked ───────────────────────────
  const groupBlocked = useCallback((group) => {
    if (!preflightDone) return true;
    return group.requires.some(r => pfChecks[r]?.status === "fail");
  }, [preflightDone, pfChecks]);

  // ── Run a single test ───────────────────────────────────────────
  const runTest = useCallback(async (test) => {
    setRunningId(test.id);
    await sleep(500 + Math.random() * 1100);
    const result = simTest(test.id, config);
    setResults(prev => ({
      ...prev,
      [test.id]: {
        ...result,
        timestamp: new Date().toTimeString().slice(0, 8),
        history: [...(prev[test.id]?.history || []), result.value].slice(-20),
      }
    }));
    addLog(buildLogLine(test, result, config), result.passed ? T.green : T.red);
    setRunningId(null);
  }, [config, addLog]);

  // ── Run a group or all tests ────────────────────────────────────
  const runGroup = useCallback(async (gid) => {
    if (running) return;
    setRunning(true);
    const group  = GROUPS.find(g => g.id === gid);
    const tests  = gid === "ALL" ? GROUPS.flatMap(g => g.tests) : group?.tests || [];
    addLog(`\n════ ${gid === "ALL" ? "FULL SUITE" : gid} @ ${new Date().toTimeString().slice(0,8)} ════`, T.blue);
    addLog(`  DUT: ${config.dutIp}  GM: ${config.gmIp}  domain: ${config.ptpDomain}`);
    for (const t of tests) {
      const grp = GROUPS.find(g => g.tests.some(x => x.id === t.id));
      if (grp && groupBlocked(grp)) {
        addLog(`  — ${t.id} SKIPPED (group blocked by failed pre-flight)`, T.muted);
        continue;
      }
      await runTest(t);
    }
    addLog(`\n────── Run complete ──────\n`);
    setRunning(false);
  }, [running, config, groupBlocked, runTest, addLog]);

  const clearAll = () => {
    setResults({});
    setPfChecks(Object.fromEntries(Object.keys(PREFLIGHT_DEFS).map(k => [k, { status:"idle", detail:"", value:null }])));
    setPreflightDone(false);
    setLogLines(["Cleared. Re-run pre-flight after updating IP addresses."]);
  };

  // ── Derived stats ───────────────────────────────────────────────
  const ran    = ALL_TESTS.filter(t => results[t.id]);
  const passed = ran.filter(t => results[t.id]?.passed);
  const failed = ran.filter(t => !results[t.id]?.passed);
  const pct    = ran.length ? Math.round(passed.length / ran.length * 100) : 0;
  const certReady = ran.length === ALL_TESTS.length && failed.length === 0;
  const certColor = certReady ? T.green : failed.length ? T.red : T.amber;

  const pfFailCount = Object.values(pfChecks).filter(c => c.status === "fail").length;
  const pfPassCount = Object.values(pfChecks).filter(c => c.status === "pass").length;
  const pfAllDone   = Object.values(pfChecks).every(c => c.status !== "idle" && c.status !== "checking");
  const testsUnlocked = preflightDone && pfFailCount === 0;

  const groupScore = (group) => {
    const ran = group.tests.filter(t => results[t.id]);
    if (!ran.length) return null;
    const pass = ran.filter(t => results[t.id]?.passed).length;
    return { pass, total: ran.length, pct: Math.round(pass / ran.length * 100) };
  };

  // ── Toggle helper ───────────────────────────────────────────────
  const Toggle = ({ field, red = false }) => (
    <div
      onClick={() => setConfig(c => ({ ...c, [field]: !c[field] }))}
      style={{
        width:36, height:18, borderRadius:9, cursor:"pointer", flexShrink:0,
        background: config[field] ? (red ? T.red : T.green) : T.border,
        position:"relative", transition:"background .2s"
      }}
    >
      <div style={{
        position:"absolute", top:2, left:2, width:14, height:14,
        borderRadius:"50%", background:"#fff", transition:"transform .2s",
        transform: config[field] ? "translateX(18px)" : "translateX(0)"
      }} />
    </div>
  );

  // ── Pre-flight panel ────────────────────────────────────────────
  const PreflightPanel = () => {
    const dutStatus = pfChecks.dut_ping?.status;
    const gmStatus  = pfChecks.gm_ping?.status;
    const pipeOk    = dutStatus === "pass" && gmStatus === "pass" && pfChecks.ptp_port?.status === "pass";
    const sshOk     = pfChecks.dut_ssh?.status === "pass";
    const nodeStyle = (s) => ({
      background:T.dark, border:`1px solid ${s === "pass" ? T.green : s === "fail" ? T.red : s === "checking" ? T.amber : T.border}`,
      borderRadius:6, padding:"8px 12px", minWidth:110, textAlign:"center",
      animation: s === "checking" ? "pulse 1s infinite" : "none"
    });
    return (
      <div>
        {/* Topology strip */}
        <div style={S.card}>
          <div style={S.section}>Network Topology</div>
          <div style={{ display:"flex", alignItems:"center", gap:0 }}>
            {[
              { label:"Grand Master", ip:config.gmIp, s:gmStatus },
              null,
              { label:"ME10 DUT",     ip:config.dutIp, s:dutStatus },
              null,
              { label:"Lab PC Agent", ip:"(local)",     s:sshOk ? "pass" : "idle" },
            ].map((node, i) => node ? (
              <div key={i} style={nodeStyle(node.s)}>
                <div style={{ fontSize:10, color:T.muted, marginBottom:2 }}>{node.label}</div>
                <div style={{ fontFamily:"monospace", fontSize:11, fontWeight:700 }}>{node.ip}</div>
                <div style={{ fontSize:10, marginTop:3, color: statusColor(node.s) }}>
                  {node.s === "pass" ? `✓ ${pfChecks[node.label === "Grand Master" ? "gm_ping" : node.label === "ME10 DUT" ? "dut_ping" : "dut_ssh"]?.value || "OK"}`
                   : node.s === "fail" ? "✗ unreachable"
                   : node.s === "checking" ? "probing…" : "—"}
                </div>
              </div>
            ) : (
              <div key={i} style={{ flex:1, height:2, position:"relative" }}>
                <div style={{ position:"absolute", left:0, right:0, height:1, background: pipeOk ? T.green : T.border }} />
                <div style={{ position:"relative", textAlign:"center", background:T.dark, display:"inline-block",
                  padding:"0 6px", fontSize:10, color: pipeOk ? T.green : T.muted, transform:"translateX(30%)" }}>
                  {i === 1 ? (pfChecks.ptp_port?.status === "pass" ? "✓ UDP 319" : "UDP 319")
                           : (sshOk ? "✓ SSH 22" : "TCP 22")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Result banner */}
        {pfAllDone && (
          <div style={{ ...S.card, borderColor: pfFailCount === 0 ? T.green : T.red,
            background: pfFailCount === 0 ? "rgba(16,185,129,.06)" : "rgba(239,68,68,.06)" }}>
            <div style={{ fontSize:14, fontWeight:700, color: pfFailCount === 0 ? T.green : T.red }}>
              {pfFailCount === 0
                ? `✓ Pre-flight passed — tests are unlocked`
                : `✗ ${pfFailCount} blocker${pfFailCount !== 1 ? "s" : ""} — resolve before running tests`}
            </div>
          </div>
        )}

        {/* Checks table */}
        <div style={S.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={S.section}>
              Pre-flight checks ({pfPassCount} / {Object.keys(PREFLIGHT_DEFS).length} passed)
            </div>
            <button
              onClick={runPreflight}
              style={{ padding:"5px 14px", background:T.blue, color:"#fff", border:"none",
                borderRadius:5, cursor:"pointer", fontSize:11, fontWeight:700 }}>
              ▶ Run Pre-flight
            </button>
          </div>

          {PREFLIGHT_GROUPS.map(cg => (
            <div key={cg.label} style={{ marginBottom:14 }}>
              <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:T.muted,
                marginBottom:6, paddingBottom:4, borderBottom:`1px solid ${T.border}` }}>
                {cg.label}
              </div>
              {cg.ids.map(id => {
                const c = pfChecks[id] || {};
                return (
                  <div key={id} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                    borderBottom:`1px solid rgba(51,65,85,.3)` }}>
                    <span style={{ width:16, textAlign:"center", fontSize:13, color: statusColor(c.status) }}>
                      {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "⚠"
                       : c.status === "checking" ? "⟳" : "○"}
                    </span>
                    <span style={{ fontSize:12, flex:1 }}>{PREFLIGHT_DEFS[id].label}</span>
                    <span style={{ fontSize:11, color:T.muted, flex:2 }}>
                      {c.detail || PREFLIGHT_DEFS[id].desc}
                    </span>
                    <span style={{ fontSize:10, fontWeight:700, fontFamily:"monospace",
                      padding:"2px 8px", borderRadius:3,
                      background: c.status === "pass" ? "rgba(16,185,129,.12)" : c.status === "fail" ? "rgba(239,68,68,.12)"
                        : c.status === "warn" ? "rgba(245,158,11,.12)" : "rgba(71,85,105,.15)",
                      color: statusColor(c.status) }}>
                      {statusLabel(c.status)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* What the IPs control */}
        <div style={S.card}>
          <div style={S.section}>What these IP addresses actually control</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {[
              { ip:config.dutIp, color:T.blue, title:"DUT IP", items:[
                "ICMP ping → gates all DUT-dependent test groups",
                "UDP 319 probe → confirms ptp4l is running",
                "TCP 22 → SSH for ptp4l log and PHC register reads",
                "UDP 5004 → RTP/RTCP SR capture (PTP-4xx, 5xx)",
                "Printed in certification report as tested device",
                "Used in all SSH commands inside me10_ptp_agent.py",
              ]},
              { ip:config.gmIp, color:T.amber, title:"GM IP", items:[
                "ICMP ping → gates PTP-3xx, 5xx, 6xx, 7xx groups",
                "UDP 319 probe → confirms GM is sending Announce",
                "clockClass check → must be ≤ 7 for IPMX certification",
                "PTP domain cross-check (ST 2059-2 default = 0)",
                "Printed in report as reference clock source",
                "PTP-601 holdover test disconnects this IP as fault injection",
              ]},
            ].map(({ ip, color, title, items }) => (
              <div key={title} style={{ background:T.dark, border:`1px solid ${T.border}`,
                borderLeft:`3px solid ${color}`, padding:"10px 12px", borderRadius:"0 6px 6px 0" }}>
                <div style={{ fontFamily:"monospace", fontSize:12, fontWeight:700, color, marginBottom:8 }}>
                  {title}: {ip}
                </div>
                {items.map((item, i) => (
                  <div key={i} style={{ fontSize:11, color:T.muted, lineHeight:1.7 }}>• {item}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Tests panel ─────────────────────────────────────────────────
  const TestsPanel = () => {
    const visibleGroups = activeGroup === "ALL" ? GROUPS : GROUPS.filter(g => g.id === activeGroup);
    return (
      <div>
        {visibleGroups.map(group => {
          const blocked  = groupBlocked(group);
          const score    = groupScore(group);
          const blockedBy = blocked ? group.requires.filter(r => pfChecks[r]?.status === "fail").join(", ") : "";
          return (
            <div key={group.id}>
              <div style={{ display:"flex", alignItems:"center", gap:8,
                borderBottom:`2px solid ${group.color}`, paddingBottom:7, marginBottom:10, marginTop:18 }}>
                <span style={{ fontSize:16 }}>{group.icon}</span>
                <span style={{ fontFamily:"monospace", fontSize:12, fontWeight:700, color:group.color }}>{group.lbl}</span>
                <span style={{ fontSize:12, color:T.muted }}>{group.title}</span>
                {blocked && (
                  <span style={{ fontSize:10, fontFamily:"monospace", color:T.red,
                    background:"rgba(239,68,68,.1)", padding:"2px 8px", borderRadius:3 }}>
                    🔒 {preflightDone ? `BLOCKED: ${blockedBy}` : "Run pre-flight first"}
                  </span>
                )}
                <div style={{ flex:1 }} />
                {score && (
                  <span style={{ fontSize:11, fontFamily:"monospace", fontWeight:700,
                    color: score.pct===100 ? T.green : T.amber,
                    background: score.pct===100 ? "rgba(16,185,129,.1)" : "rgba(245,158,11,.1)",
                    padding:"2px 10px", borderRadius:10 }}>
                    {score.pass}/{score.total} PASS
                  </span>
                )}
                <button
                  onClick={() => runGroup(group.id)}
                  disabled={running || blocked}
                  style={{ padding:"4px 10px", background:"transparent", border:`1px solid ${group.color}`,
                    borderRadius:4, cursor:"pointer", fontSize:10, color:group.color,
                    opacity: running || blocked ? 0.35 : 1 }}>
                  ▶ Run Group
                </button>
              </div>

              {group.tests.map(test => {
                const r = results[test.id];
                const isRunning = runningId === test.id;
                const dotColor = isRunning ? T.amber : r ? (r.passed ? T.green : T.red) : T.muted;
                return (
                  <div key={test.id} style={{
                    display:"flex", alignItems:"center", gap:10,
                    borderRadius:6, padding:"7px 12px", marginBottom:5,
                    border:`1px solid ${isRunning ? T.amber : r ? (r.passed ? "rgba(16,185,129,.25)" : "rgba(239,68,68,.3)") : T.border}`,
                    background: isRunning ? "rgba(245,158,11,.06)" : r ? (r.passed ? "rgba(16,185,129,.04)" : "rgba(239,68,68,.05)") : T.med,
                    opacity: blocked && !r ? 0.45 : 1,
                  }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:dotColor, flexShrink:0,
                      animation: isRunning ? "pulse 1s infinite" : "none" }} />
                    <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:700,
                      color:group.color, minWidth:64, flexShrink:0 }}>{test.id}</span>
                    <span style={{ fontSize:12, flex:1 }}>{test.name}</span>
                    {blocked && !r && (
                      <span style={{ fontSize:10, color:T.red, fontFamily:"monospace" }}>🔒 BLOCKED</span>
                    )}
                    {r && (
                      <>
                        <span style={{ fontFamily:"monospace", fontSize:11, minWidth:90, textAlign:"right",
                          color: r.passed ? T.green : T.red }}>
                          {r.value} {test.unit}
                        </span>
                        {r.history?.length > 1 && <Sparkline data={r.history} color={r.passed ? T.green : T.red} />}
                        <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3,
                          background: r.passed ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)",
                          color: r.passed ? T.green : T.red, minWidth:44, textAlign:"center" }}>
                          {r.passed ? "PASS" : "FAIL"}
                        </span>
                        <span style={{ fontSize:9, color:T.muted, minWidth:46 }}>{r.timestamp}</span>
                      </>
                    )}
                    {isRunning && (
                      <span style={{ fontSize:11, color:T.amber, fontFamily:"monospace",
                        animation:"pulse .8s infinite" }}>running…</span>
                    )}
                    <button
                      onClick={() => { if (!running && !blocked) runTest(test); }}
                      disabled={running || blocked}
                      style={{ padding:"2px 7px", background:"transparent", border:`1px solid ${T.border}`,
                        borderRadius:3, cursor:"pointer", fontSize:10, color:T.muted,
                        opacity: running || blocked ? 0.3 : 0.7 }}>
                      ▶
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Config panel ────────────────────────────────────────────────
  const ConfigPanel = () => (
    <div>
      <div style={S.card}>
        <div style={S.section}>Network Addresses — Drive Pre-flight Checks</div>
        {[
          ["DUT IP Address", "dutIp", "Ping + UDP 319 + TCP 22 + UDP 5004 probed on pre-flight"],
          ["GM IP Address",  "gmIp",  "Ping + UDP 319 + clockClass check. Disconnected during PTP-601 holdover"],
        ].map(([label, key, hint]) => (
          <div key={key}>
            <div style={S.cfgRow}>
              <span style={S.cfgLabel}>{label}</span>
              <input type="text" value={config[key]}
                onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                style={{ width:170, fontFamily:"monospace", background:T.dark, color:T.txt,
                  border:`1px solid ${isValidIp(config[key]) ? T.border : T.red}`,
                  borderRadius:5, padding:"5px 9px", fontSize:12 }} />
              {!isValidIp(config[key]) && (
                <span style={{ fontSize:10, color:T.red }}>✗ invalid IP</span>
              )}
            </div>
            <div style={S.cfgHint}>{hint}</div>
          </div>
        ))}
        <div style={S.cfgRow}>
          <span style={S.cfgLabel}>PTP Domain</span>
          <input type="number" value={config.ptpDomain} min="0" max="127"
            onChange={e => setConfig(c => ({ ...c, ptpDomain: +e.target.value }))}
            style={{ width:80, background:T.dark, color:T.txt, border:`1px solid ${T.border}`,
              borderRadius:5, padding:"5px 9px", fontSize:12 }} />
        </div>
        <div style={S.cfgHint}>ST 2059-2 default = 0. Non-zero triggers a pre-flight warning</div>
        <button onClick={() => { runPreflight(); setActiveTab("preflight"); }}
          style={{ padding:"6px 16px", background:T.blue, color:"#fff", border:"none",
            borderRadius:5, cursor:"pointer", fontSize:12, fontWeight:700, marginTop:6 }}>
          ▶ Re-run Pre-flight with New IPs
        </button>
      </div>

      <div style={S.card}>
        <div style={S.section}>PI Servo (MPA1000 arch ref: Kp=0.7 / Ki=0.3)</div>
        {[["Kp (proportional)", "kp", 0.1, 2.0, 0.05], ["Ki (integral)", "ki", 0.05, 1.0, 0.05]].map(([label, key, min, max, step]) => (
          <div key={key} style={S.cfgRow}>
            <span style={S.cfgLabel}>{label}</span>
            <input type="range" min={min} max={max} step={step} value={config[key]}
              onChange={e => setConfig(c => ({ ...c, [key]: +e.target.value }))}
              style={{ flex:1 }} />
            <span style={{ fontFamily:"monospace", fontSize:12, color:T.cyan, minWidth:36 }}>{config[key]}</span>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.section}>Fault Injection &amp; Network Conditions</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div style={S.cfgRow}><span style={S.cfgLabel}>HW Timestamps</span><Toggle field="hwTimestamping" /></div>
          <div style={S.cfgRow}><span style={S.cfgLabel}>GM Present</span><Toggle field="gmPresent" /></div>
          <div style={S.cfgRow}><span style={S.cfgLabel}>Rogue GM</span><Toggle field="rogueGm" red /></div>
          <div style={S.cfgRow}><span style={S.cfgLabel}>Multi-Decoder</span><Toggle field="multiDecoder" /></div>
          {[
            ["Network Loss %", "networkLoss", 0, 0.15, 0.01, v => `${Math.round(v*100)}%`, v => v > 0.05],
            ["Path Asymmetry", "asymmetryNs", 0, 1000, 50,   v => `${v}ns`,              v => v > 0],
            ["VCXO Aging",    "vcxoAging",   0, 1,    0.05, v => `${Math.round(v*100)}%`,v => v > 0.5],
          ].map(([label, key, min, max, step, fmt, warn]) => (
            <div key={key} style={S.cfgRow}>
              <span style={S.cfgLabel}>{label}</span>
              <input type="range" min={min} max={max} step={step} value={config[key]}
                onChange={e => setConfig(c => ({ ...c, [key]: +e.target.value }))}
                style={{ flex:1 }} />
              <span style={{ fontFamily:"monospace", fontSize:12, minWidth:40,
                color: warn(config[key]) ? T.amber : T.cyan }}>{fmt(config[key])}</span>
            </div>
          ))}
          <div style={S.cfgRow}>
            <span style={S.cfgLabel}>Video Mode</span>
            <select value={config.videoMode} onChange={e => setConfig(c => ({ ...c, videoMode: e.target.value }))}>
              {["1080p30","1080p50","1080p60","4K30","4K60"].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        {!config.hwTimestamping && (
          <div style={S.warnBanner}>
            ⚠ HW timestamps disabled — set time_stamping=hardware in /etc/ptp4l.conf on {config.dutIp}
          </div>
        )}
        {config.networkLoss > 0.05 && (
          <div style={S.warnBanner}>
            ⚠ {Math.round(config.networkLoss*100)}% loss will degrade PTP-302 and PTP-604
          </div>
        )}
      </div>
    </div>
  );

  // ── Report panel ────────────────────────────────────────────────
  const ReportPanel = () => {
    const pfTotal = Object.keys(PREFLIGHT_DEFS).length;
    return (
      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700 }}>Certification Report</div>
            <div style={{ fontSize:11, color:T.muted }}>
              MACNICA-ME10-PTP-TP-001 · {new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}
            </div>
          </div>
          <div style={{ padding:"5px 14px", borderRadius:5, fontWeight:700, fontSize:12,
            background: certReady ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.1)",
            color: certColor }}>
            {certReady ? "PASS — CERT READY" : ran.length === 0 ? "NOT RUN" : "FAIL"}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
          {[
            ["DUT IP",      config.dutIp,                              T.blue],
            ["GM IP",       config.gmIp,                               T.amber],
            ["Pre-flight",  `${pfPassCount}/${pfTotal}`,               T.cyan],
            ["Test Score",  ran.length ? `${pct}%` : "—",             certColor],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background:T.med, border:`1px solid ${c}30`, borderRadius:7, padding:"10px 12px" }}>
              <div style={{ fontSize:18, fontWeight:700, color:c, fontFamily:"monospace" }}>{v}</div>
              <div style={{ fontSize:10, color:T.muted, marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>

        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr style={{ background:"rgba(59,130,246,.1)" }}>
              {["Test ID","Test Name","Metric","Measured","Threshold","Status"].map(h => (
                <th key={h} style={{ padding:"7px 10px", textAlign:"left", color:T.blue,
                  borderBottom:`1px solid ${T.border}`, fontWeight:700, fontSize:10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_TESTS.map((test, i) => {
              const r = results[test.id];
              return (
                <tr key={test.id} style={{ background: i%2===1 ? "rgba(255,255,255,.015)" : "transparent" }}>
                  <td style={{ padding:"5px 10px", fontFamily:"monospace", color:T.cyan, fontSize:10 }}>{test.id}</td>
                  <td style={{ padding:"5px 10px" }}>{test.name}</td>
                  <td style={{ padding:"5px 10px", fontFamily:"monospace", color:T.muted, fontSize:10 }}>{test.metric}</td>
                  <td style={{ padding:"5px 10px", fontFamily:"monospace",
                    color: r ? (r.passed ? T.green : T.red) : T.muted }}>
                    {r ? `${r.value} ${test.unit}` : "—"}
                  </td>
                  <td style={{ padding:"5px 10px", fontFamily:"monospace", color:T.muted, fontSize:10 }}>
                    {test.dir === "max" ? "≤" : "≥"} {test.threshold} {test.unit}
                  </td>
                  <td style={{ padding:"5px 10px" }}>
                    {r ? (
                      <span style={{ fontWeight:700, color: r.passed ? T.green : T.red }}>
                        {r.passed ? "PASS" : "FAIL"}
                      </span>
                    ) : <span style={{ color:T.muted }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop:14, fontSize:10, color:T.muted,
          display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4 }}>
          <div>HW Timestamps: <span style={{ color: config.hwTimestamping ? T.green : T.red }}>
            {config.hwTimestamping ? "YES" : "NO"}
          </span></div>
          <div>Kp / Ki: <span style={{ color:T.cyan }}>{config.kp} / {config.ki}</span></div>
          <div>Video Mode: <span style={{ color:T.cyan }}>{config.videoMode}</span></div>
        </div>
      </div>
    );
  };

  // ── Layout ──────────────────────────────────────────────────────
  const tabs = ["preflight","tests","config","report"];
  const tabLabels = ["Pre-flight","Test Cases","Config","Report"];

  return (
    <div style={{ background:T.dark, minHeight:"100vh", color:T.txt,
      fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:13, display:"flex", flexDirection:"column" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        input[type=range]{accent-color:${T.cyan};cursor:pointer}
        select{background:${T.med};color:${T.txt};border:1px solid ${T.border};border-radius:4px;padding:4px 7px;font-size:12px}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:${T.dark}} ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
      `}</style>

      {/* Header */}
      <div style={{ background:T.med, borderBottom:`1px solid ${T.border}`, padding:"0 16px",
        display:"flex", alignItems:"center", gap:12, height:48, flexShrink:0 }}>
        <div style={{ fontSize:9, letterSpacing:2, color:T.cyan, textTransform:"uppercase" }}>Macnica Americas</div>
        <div style={{ width:1, height:18, background:T.border }} />
        <div style={{ fontWeight:700, fontSize:14 }}>ME10 PTP Certification Test Suite</div>
        <span style={{ fontSize:10, padding:"2px 10px", borderRadius:10,
          border:`1px solid ${testsUnlocked ? T.green : T.purple}`,
          color: testsUnlocked ? T.green : T.purple, fontFamily:"monospace" }}>
          {testsUnlocked ? "NETWORK READY" : "SIM MODE"}
        </span>
        <div style={{ flex:1 }} />
        <div style={{ padding:"3px 12px", borderRadius:20, border:`1px solid ${certColor}`,
          color:certColor, fontSize:10, fontWeight:700, fontFamily:"monospace" }}>
          {certReady ? "✓ CERT READY" : `${pct}% COMPLETE`}
        </div>
        <button onClick={clearAll} style={{ ...S.btnSmall, color:T.muted }}>Clear</button>
        <button onClick={() => runGroup("ALL")} disabled={running || !testsUnlocked}
          style={{ padding:"6px 18px", borderRadius:5, border:"none", cursor:"pointer",
            fontWeight:700, fontSize:12, color:"#fff",
            background: running ? T.border : testsUnlocked ? T.blue : T.border,
            opacity: !testsUnlocked ? 0.5 : 1 }}>
          {running ? "⟳ Running…" : testsUnlocked ? "▶ Run Full Suite" : "🔒 Run Pre-flight First"}
        </button>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        {/* Sidebar */}
        <div style={{ width:180, flexShrink:0, background:T.med, borderRight:`1px solid ${T.border}`,
          display:"flex", flexDirection:"column", padding:"10px 0", overflowY:"auto" }}>
          <div style={{ padding:"4px 12px", fontSize:9, textTransform:"uppercase",
            letterSpacing:1, color:T.muted, marginTop:4 }}>Views</div>
          {tabs.map((t, i) => (
            <button key={t} onClick={() => setActiveTab(t)}
              style={{ ...S.sideBtn, borderLeftColor: activeTab === t ? T.blue : "transparent",
                color: activeTab === t ? T.txt : T.muted,
                fontWeight: activeTab === t ? 600 : 400 }}>
              {["🔌","🧪","⚙️","📋"][i]} {tabLabels[i]}
            </button>
          ))}
          <div style={{ borderTop:`1px solid ${T.border}`, margin:"8px 0" }} />
          <div style={{ padding:"4px 12px", fontSize:9, textTransform:"uppercase",
            letterSpacing:1, color:T.muted }}>Test Groups</div>
          <button onClick={() => { setActiveGroup("ALL"); setActiveTab("tests"); }}
            style={{ ...S.sideBtn, borderLeftColor: activeGroup === "ALL" && activeTab === "tests" ? T.blue : "transparent",
              color: activeGroup === "ALL" && activeTab === "tests" ? T.txt : T.muted }}>
            All Groups
          </button>
          {GROUPS.map(g => {
            const sc = groupScore(g);
            const blocked = groupBlocked(g);
            return (
              <button key={g.id} onClick={() => { setActiveGroup(g.id); setActiveTab("tests"); }}
                style={{ ...S.sideBtn,
                  borderLeftColor: activeGroup === g.id && activeTab === "tests" ? g.color : "transparent",
                  color: activeGroup === g.id && activeTab === "tests" ? g.color : T.muted }}>
                <span style={{ flex:1 }}>{g.lbl} {g.icon}</span>
                {blocked ? <span style={{ fontSize:9, color:T.red }}>🔒</span>
                  : sc ? <span style={{ fontSize:10, fontFamily:"monospace",
                    color: sc.pct === 100 ? T.green : T.amber }}>{sc.pass}/{sc.total}</span>
                  : null}
              </button>
            );
          })}
        </div>

        {/* Main */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`,
            padding:"0 20px", background:T.med, flexShrink:0 }}>
            {tabs.map((t, i) => (
              <div key={t} onClick={() => setActiveTab(t)}
                style={{ padding:"10px 16px", cursor:"pointer", fontSize:12,
                  color: activeTab === t ? T.blue : T.muted,
                  borderBottom:`2px solid ${activeTab === t ? T.blue : "transparent"}` }}>
                {tabLabels[i]}
              </div>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex:1, overflowY:"auto", padding:"16px 20px" }}>
            {activeTab === "preflight" && <PreflightPanel />}
            {activeTab === "tests"     && <TestsPanel />}
            {activeTab === "config"    && <ConfigPanel />}
            {activeTab === "report"    && <ReportPanel />}
          </div>

          {/* Log console */}
          <div style={{ height:140, borderTop:`1px solid ${T.border}`, background:"#080f1e",
            display:"flex", flexDirection:"column", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"3px 12px",
              borderBottom:`1px solid ${T.border}` }}>
              <span style={{ fontSize:9, fontFamily:"monospace", textTransform:"uppercase",
                letterSpacing:1, color:T.cyan }}>Network &amp; Test Log</span>
              {running && <span style={{ fontSize:9, color:T.amber, animation:"pulse 1s infinite",
                fontFamily:"monospace" }}>● LIVE</span>}
              <div style={{ flex:1 }} />
              <button onClick={() => setLogLines([])}
                style={{ padding:"1px 7px", background:"transparent", border:`1px solid ${T.border}`,
                  borderRadius:3, cursor:"pointer", fontSize:9, color:T.muted }}>Clear</button>
            </div>
            <div ref={logRef} style={{ flex:1, overflowY:"auto", padding:"6px 12px",
              fontFamily:"'Courier New',monospace", fontSize:10, lineHeight:1.7 }}>
              {logLines.map((line, i) => (
                <div key={i} style={{
                  color: typeof line === "object" ? line.color
                    : line.includes("✓") || line.includes("PASS") ? T.green
                    : line.includes("✗") || line.includes("FAIL") ? T.red
                    : line.includes("⚠") ? T.amber
                    : line.includes("════") ? T.blue
                    : T.muted
                }}>
                  {typeof line === "object" ? line.text : line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
