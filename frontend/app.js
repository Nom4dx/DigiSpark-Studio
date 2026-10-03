import * as Blockly from "blockly/core";
import * as En from "blockly/msg/en";
import { EditorView, basicSetup } from "codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
Blockly.setLocale(En);
const $ = (id) => document.getElementById(id);
let darkTheme, lightTheme;
let catalog,
  workspace,
  editor,
  generated = null,
  manual = false,
  settingCode = false,
  loading = false,
  revision = 0,
  timer,
  lastPayload = null;
const colors = {
  time: "#c39447",
  keyboard: "#558777",
  browser: "#5c86a4",
  led: "#bd795c",
  flow: "#8c79a5",
  gpio: "#7d9670",
};
const fields = {};
function number(name, value, min = 0, max = 600000) {
  return { type: "field_number", name, value, min, max, precision: 1 };
}
function dropdown(name, options) {
  return { type: "field_dropdown", name, options };
}
function text(name, value) {
  return { type: "field_input", name, text: value };
}
function statement(name) {
  return { type: "input_statement", name };
}
function def(type, message, args, color, extra = {}) {
  Blockly.defineBlocksWithJsonArray([
    {
      type,
      message0: message,
      args0: args,
      colour: color,
      previousStatement: null,
      nextStatement: null,
      ...extra,
    },
  ]);
}
const osOptions = [
  ["Windows", "windows"],
  ["Linux", "linux"],
  ["macOS", "mac"],
];
function defineBlocks() {
  def("start", "⚑ On start %1", [statement("BODY")], colors.flow, {
    previousStatement: undefined,
    nextStatement: undefined,
    tooltip: "The sequence runs once after the USB connection.",
  });
  def("wait", "wait %1 ms", [number("MS", 1000, 1)], colors.time);
  def("text", "type %1", [text("TEXT", "Hello, world!")], colors.keyboard);
  const keys = catalog.keys.map((k) => [k, k]),
    mods = catalog.modifiers.map((k) => [k === "GUI" ? "Win / Cmd" : k, k]);
  def(
    "key",
    "press %1 + %2",
    [dropdown("MODS", mods), dropdown("KEY", keys)],
    colors.keyboard,
  );
  def(
    "hold",
    "hold %1 + %2",
    [dropdown("MODS", mods), dropdown("KEY", keys)],
    colors.keyboard,
  );
  def("release", "release all keys", [], colors.keyboard);
  def(
    "shortcut",
    "shortcut %1",
    [
      dropdown("ACTION", [
        ["copy", "copy"],
        ["paste", "paste"],
        ["cut", "cut"],
        ["select all", "select_all"],
        ["undo", "undo"],
        ["save", "save"],
        ["new tab", "new_tab"],
        ["address bar", "address"],
        ["close tab", "close_tab"],
        ["full screen", "fullscreen"],
      ]),
    ],
    colors.keyboard,
  );
  def(
    "url",
    "open URL %1 %2 on %3",
    [
      text("URL", "https://youtu.be/dQw4w9WgXcQ?t=43s"),
      { type: "input_dummy" },
      dropdown("TARGET", [
        ["Project OS", "project"],
        ...osOptions,
        ["try all", "all"],
      ]),
    ],
    colors.browser,
  );
  def(
    "led",
    "LED %1",
    [
      dropdown("VALUE", [
        ["on", "1"],
        ["off", "0"],
      ]),
    ],
    colors.led,
  );
  def(
    "blink",
    "blink %1 times · %2 ms",
    [number("COUNT", 3, 1, 1000), number("MS", 500, 1)],
    colors.led,
  );
  const pins = [
    ["P0", "0"],
    ["P1", "1"],
    ["P2", "2"],
  ];
  def(
    "pin_write",
    "set %1 to %2",
    [
      dropdown("PIN", pins),
      dropdown("VALUE", [
        ["HIGH", "1"],
        ["LOW", "0"],
      ]),
    ],
    colors.gpio,
  );
  def(
    "pwm",
    "PWM %1 duty %2",
    [dropdown("PIN", pins.slice(0, 2)), number("VALUE", 128, 0, 255)],
    colors.gpio,
  );
  def(
    "pin_if",
    "if %1 is %2 · pull-up %3 %4 else %5",
    [
      dropdown("PIN", pins),
      dropdown("VALUE", [
        ["HIGH", "1"],
        ["LOW", "0"],
      ]),
      { type: "field_checkbox", name: "PULLUP", checked: true },
      statement("BODY"),
      statement("ELSE"),
    ],
    colors.gpio,
  );
  def(
    "repeat",
    "repeat %1 times %2",
    [number("COUNT", 3, 1, 1000), statement("BODY")],
    colors.flow,
  );
  def("forever", "forever %1", [statement("BODY")], colors.flow);
  def(
    "os_if",
    "if project OS is %1 %2 else %3",
    [dropdown("TARGET", osOptions), statement("BODY"), statement("ELSE")],
    colors.flow,
  );
  def("comment", "note %1", [text("TEXT", "My idea")], colors.flow);
}
const groups = [
  ["Timing", "time", ["wait"]],
  ["Keyboard", "keyboard", ["text", "key", "hold", "release", "shortcut"]],
  ["Browser", "browser", ["url"]],
  ["LED", "led", ["led", "blink"]],
  ["Logic", "flow", ["repeat", "forever", "os_if", "comment"]],
  ["Pins and inputs", "gpio", ["pin_write", "pwm", "pin_if"]],
];
const specs = {
  wait: ["ms"],
  text: ["text"],
  key: ["key", "mods"],
  hold: ["key", "mods"],
  url: ["url", "target"],
  shortcut: ["action"],
  led: ["value"],
  blink: ["count", "ms"],
  pin_write: ["pin", "value"],
  pwm: ["pin", "value"],
  pin_if: ["pin", "value", "pullup"],
  repeat: ["count"],
  os_if: ["target"],
  comment: ["text"],
};
const numeric = new Set(["ms", "count", "pin", "value"]);
function sequence(block) {
  const nodes = [];
  while (block) {
    if (block.isEnabled()) {
      const n = { op: block.type, id: block.id };
      for (const f of specs[block.type] || []) {
        let v = block.getFieldValue(f.toUpperCase());
        n[f] = numeric.has(f) ? Number(v) : f === "pullup" ? v === "TRUE" : v;
      }
      if (block.getInput("BODY"))
        n.body = sequence(block.getInputTargetBlock("BODY"));
      if (block.getInput("ELSE"))
        n.else = sequence(block.getInputTargetBlock("ELSE"));
      nodes.push(n);
    }
    block = block.getNextBlock();
  }
  return nodes;
}
function readSettings() {
  return {
    os: $("os").value,
    layout: $("layout").value,
    layoutMode: $("layoutMode").value,
    layoutPause: Number($("layoutPause").value),
    ledPin: Number($("ledPin").value),
    startup: Number($("startup").value),
    inputs: Object.fromEntries(
      [...document.querySelectorAll("[data-pin]")].map((e) => [
        e.dataset.pin,
        Number(e.checked),
      ]),
    ),
  };
}
function project() {
  const roots = workspace.getTopBlocks(false).filter((b) => b.type === "start");
  if (roots.length !== 1)
    throw Error(
      "Exactly one On start block is required. Use New to start over.",
    );
  const loose = workspace
    .getTopBlocks(false)
    .filter((b) => b.type !== "start" && b.isEnabled());
  if (loose.length)
    throw Error(
      "Connect all blocks to On start or remove disconnected blocks.",
    );
  return {
    settings: readSettings(),
    nodes: sequence(roots[0].getInputTargetBlock("BODY")),
  };
}
function snapshot() {
  return {
    version: 1,
    name: $("projectName").value,
    settings: readSettings(),
    workspace: Blockly.serialization.workspaces.save(workspace),
    manualCode: manual ? editor.state.doc.toString() : null,
  };
}
function persist() {
  try {
    localStorage.setItem("digispark-studio-v1", JSON.stringify(snapshot()));
    $("saveState").textContent =
      "Saved in browser · " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
  } catch (e) {
    $("saveState").textContent = "Autosave unavailable · download your project";
  }
}
function setCode(code) {
  settingCode = true;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: code },
  });
  settingCode = false;
}
function mode() {
  $("codeMode").textContent = manual ? "Manually edited" : "From blocks";
  $("codeMode").classList.toggle("manual-mode", manual);
  $("manualNotice").hidden = !manual;
  updateActions();
}
async function api(path, data) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw Error(j.error || "Server error");
  return j;
}
function showWarnings(list, error = false) {
  $("warnings").replaceChildren(
    ...list.map((s) => {
      let li = document.createElement("li");
      li.textContent = s;
      if (error) li.className = "error";
      return li;
    }),
  );
  $("warningCount").textContent = list.length;
  $("projectStatus").textContent = error
    ? "Needs attention · open diagnostics"
    : manual
      ? "Manual code · blocks are separate"
      : "Ready to simulate";
  $("projectStatus").dataset.error = String(error);
  if (error) $("diagnostics").open = true;
  updateActions();
}
async function regenerate(force = false) {
  const rev = ++revision;
  try {
    const data = project();
    const payload = JSON.stringify(data);
    if (!force && generated && payload === lastPayload) {
      persist();
      return generated;
    }
    const result = await api("/api/generate", data);
    if (rev !== revision) return;
    generated = result;
    lastPayload = payload;
    if (force) {
      manual = false;
      mode();
    }
    if (!manual) setCode(result.code);
    showWarnings(result.warnings);
    $("blockCount").textContent = result.blocks + " blocks";
    $("duration").textContent =
      "Preview · " + (result.duration / 1000).toFixed(1) + " s";
    resetSim();
    persist();
    return result;
  } catch (e) {
    if (rev !== revision) return;
    generated = null;
    resetSim();
    showWarnings([e.message], true);
    persist();
  }
}
function queue() {
  if (loading) return;
  updateKeyboardConfig();
  clearTimeout(timer);
  timer = setTimeout(() => regenerate(), 250);
}
function newBlock(n) {
  const b = workspace.newBlock(n.op);
  for (const f of specs[n.op] || []) {
    if (n[f] !== undefined)
      b.setFieldValue(
        f === "pullup" ? (n[f] ? "TRUE" : "FALSE") : String(n[f]),
        f.toUpperCase(),
      );
  }
  b.initSvg();
  b.render();
  for (const name of ["body", "else"]) {
    let prev = null;
    for (const child of n[name] || []) {
      let cb = newBlock(child);
      (prev
        ? prev.nextConnection
        : b.getInput(name.toUpperCase()).connection
      ).connect(cb.previousConnection);
      prev = cb;
    }
  }
  return b;
}
function loadNodes(nodes, name) {
  loading = true;
  workspace.clear();
  const root = workspace.newBlock("start");
  root.initSvg();
  root.render();
  root.setDeletable(false);
  root.moveBy(40, 35);
  let prev = null;
  for (const n of nodes) {
    const b = newBlock(n);
    (prev ? prev.nextConnection : root.getInput("BODY").connection).connect(
      b.previousConnection,
    );
    prev = b;
  }
  manual = false;
  mode();
  $("projectName").value = name;
  loading = false;
  workspace.scroll(0, 0);
  if (matchMedia("(max-width:800px)").matches)
    requestAnimationFrame(() => workspace.zoomToFit());
  regenerate(true);
}
const samples = {
  rickroll: [
    { op: "url", target: "project", url: "https://youtu.be/dQw4w9WgXcQ?t=43s" },
    { op: "forever", body: [{ op: "blink", count: 1, ms: 500 }] },
  ],
  hello: [
    { op: "wait", ms: 2000 },
    { op: "text", text: "Hello, world!" },
    { op: "key", key: "ENTER", mods: "NONE" },
    { op: "blink", count: 3, ms: 250 },
  ],
  blink: [{ op: "forever", body: [{ op: "blink", count: 1, ms: 500 }] }],
  gpio: [
    {
      op: "forever",
      body: [
        {
          op: "pin_if",
          pin: 2,
          value: 0,
          pullup: true,
          body: [{ op: "led", value: 1 }],
          else: [{ op: "led", value: 0 }],
        },
        { op: "wait", ms: 100 },
      ],
    },
  ],
  os: [
    {
      op: "os_if",
      target: "mac",
      body: [
        { op: "comment", text: "Command is selected by the project" },
        { op: "shortcut", action: "copy" },
      ],
      else: [{ op: "shortcut", action: "copy" }],
    },
    { op: "blink", count: 2, ms: 300 },
  ],
};
samples.all = [
  { op: "comment", text: "Full catalog: customize before exporting" },
  { op: "wait", ms: 1000 },
  { op: "text", text: "Hello!" },
  { op: "key", key: "ENTER", mods: "NONE" },
  { op: "hold", key: "A", mods: "SHIFT" },
  { op: "release" },
  { op: "shortcut", action: "copy" },
  { op: "url", url: "https://example.com", target: "project" },
  { op: "led", value: 1 },
  { op: "blink", count: 2, ms: 200 },
  { op: "pin_write", pin: 0, value: 1 },
  { op: "pwm", pin: 0, value: 128 },
  {
    op: "pin_if",
    pin: 2,
    value: 0,
    pullup: true,
    body: [{ op: "led", value: 0 }],
    else: [{ op: "led", value: 1 }],
  },
  { op: "repeat", count: 2, body: [{ op: "wait", ms: 100 }] },
  {
    op: "os_if",
    target: "mac",
    body: [{ op: "shortcut", action: "save" }],
    else: [{ op: "comment", text: "Other system" }],
  },
  { op: "forever", body: [{ op: "blink", count: 1, ms: 500 }] },
];
function restore(p) {
  if (!p || p.version !== 1 || !p.workspace || !p.settings)
    throw Error(
      "Unrecognized project format. Use a Digispark Studio JSON file.",
    );
  const old = workspace
    ? Blockly.serialization.workspaces.save(workspace)
    : null;
  loading = true;
  try {
    $("layoutMode").value = "single";
    $("layoutPause").value = "1500";
    Blockly.serialization.workspaces.load(p.workspace, workspace);
    for (const k of [
      "os",
      "layout",
      "layoutMode",
      "layoutPause",
      "ledPin",
      "startup",
    ])
      if (p.settings[k] !== undefined) $(k).value = p.settings[k];
    document
      .querySelectorAll("[data-pin]")
      .forEach((e) => (e.checked = !!p.settings.inputs?.[e.dataset.pin]));
    $("projectName").value = String(p.name || "Imported project").slice(0, 60);
    manual = typeof p.manualCode === "string";
    if (manual) setCode(p.manualCode);
    mode();
    workspace
      .getTopBlocks()
      .filter((b) => b.type === "start")
      .forEach((b) => b.setDeletable(false));
  } catch (e) {
    if (old) Blockly.serialization.workspaces.load(old, workspace);
    throw e;
  } finally {
    loading = false;
  }
  updateKeyboardConfig();
  regenerate();
}
function download(name, content, type) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function filename() {
  return (
    $("projectName")
      .value.replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^\d/, "_$&") || "StudioSketch"
  );
}
let toastTimer;
function toast(s) {
  $("toast").textContent = s;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
// Deterministic 2D scene: this is a preview, never keyboard automation on the host.
const canvas = $("scene"),
  ctx = canvas.getContext("2d");
let sim = {
    index: 0,
    running: false,
    elapsed: 0,
    eventElapsed: 0,
    pins: [0, 0, 0],
    text: "",
    url: "",
    keys: "",
    target: "",
    layout: "",
    started: false,
  },
  last = 0,
  frame = 0;
function rect(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function label(t, x, y, size = 14, color = null, font = "sans-serif") {
  ctx.fillStyle =
    color ||
    (document.documentElement.dataset.theme === "dark" ? "#b8cab3" : "#738374");
  ctx.font = `${size}px ${font}`;
  ctx.fillText(t, x, y);
}
function draw() {
  const dark = document.documentElement.dataset.theme === "dark";
  const shade = (light, night) => (dark ? night : light);
  ctx.clearRect(0, 0, 780, 370);
  ctx.fillStyle = shade("#f7f9f4", "#17221d");
  ctx.fillRect(0, 0, 780, 370);
  ctx.fillStyle = shade("#e5eadf", "#293c30");
  for (let x = 15; x < 780; x += 20)
    for (let y = 15; y < 370; y += 20) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  label("DIGISPARK / ATtiny85", 32, 31, 11, shade("#768674", "#a9bca0"));
  label("TARGET COMPUTER", 387, 31, 11, shade("#768674", "#a9bca0"));
  // Board and USB connector.
  rect(58, 121, 52, 97, 5, "#c5c7ba");
  for (let i = 0; i < 4; i++) rect(58, 129 + i * 22, 27, 12, 2, "#c8ad6e");
  ctx.shadowColor = "#173d2220";
  ctx.shadowBlur = 18;
  rect(94, 74, 207, 207, 14, "#356049");
  ctx.shadowBlur = 0;
  rect(105, 85, 185, 184, 9, "#3d6c51");
  for (let i = 0; i < 4; i++) {
    rect(142, 129 + i * 20, 11, 7, 1, "#bfc2ab");
    rect(213, 129 + i * 20, 11, 7, 1, "#bfc2ab");
  }
  rect(151, 116, 65, 94, 5, "#27382f");
  label("ATtiny", 163, 154, 13, "#bbc8b5");
  label("85", 172, 177, 16, "#bbc8b5");
  const ledPin = Number($("ledPin").value),
    on = sim.pins[ledPin] > 0;
  ctx.shadowColor = on ? "#efb965" : "transparent";
  ctx.shadowBlur = on ? 20 : 0;
  rect(121, 233, 17, 10, 3, on ? "#f7be61" : "#79866b");
  ctx.shadowBlur = 0;
  label("LED", 145, 242, 10, "#c0d3b2");
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i < 3 && sim.pins[i] ? "#efc776" : "#203c2b";
    ctx.beginPath();
    ctx.arc(277, 104 + i * 28, 5, 0, Math.PI * 2);
    ctx.fill();
    label("P" + i, 247, 108 + i * 28, 10, "#d1debf");
  }
  label("USB", 109, 108, 9, "#c0d3b2");
  label("5V", 111, 261, 9, "#c0d3b2");
  ctx.strokeStyle = sim.running ? "#91b180" : "#c8d2c1";
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(303, 169);
  ctx.lineTo(378, 169);
  ctx.stroke();
  ctx.setLineDash([]);
  if (sim.running) {
    const x = 310 + ((performance.now() / 15) % 60);
    ctx.fillStyle = "#739865";
    ctx.beginPath();
    ctx.arc(x, 169, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  rect(378, 65, 366, 215, 12, shade("#dbe3d5", "#405248"));
  rect(386, 73, 350, 196, 7, shade("#fff", "#22332a"));
  rect(386, 73, 350, 29, 7, shade("#edf1e8", "#314337"));
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ["#cfa58b", "#d8c493", "#acc099"][i];
    ctx.beginPath();
    ctx.arc(401 + i * 13, 87, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  label(sim.target || $("os").selectedOptions[0].text, 650, 91, 10);
  rect(403, 116, 314, 26, 5, shade("#f3f5f0", "#19271f"));
  label(
    (sim.url || "The browser will appear here").slice(0, 46),
    412,
    133,
    11,
    shade("#809177", "#abc39f"),
  );
  const lines =
    (sim.text || "The virtual keyboard is ready.").match(/[^\n]{1,39}|\n/g) ||
    [];
  lines
    .slice(-4)
    .forEach((l, i) =>
      label(l, 410, 165 + i * 18, 12, shade("#496352", "#c2d9b7"), "monospace"),
    );
  label(
    sim.keys ? ("Keys: " + sim.keys).slice(0, 43) : "No keys pressed",
    410,
    246,
    10,
    "#90a08b",
  );
  rect(534, 280, 52, 13, 2, "#cdd7c6");
  rect(499, 291, 123, 6, 3, "#d8e0d2");
  label(on ? "● LED on" : "○ LED off", 94, 312, 12, on ? "#a67531" : "#7c8c75");
  label(
    sim.layout
      ? "Layout: " + (catalog?.layouts[sim.layout] || sim.layout)
      : "P3 / P4 · reserved for USB",
    94,
    333,
    10,
    "#94a18b",
  );
  label("Action preview, not a computer emulator", 386, 325, 10, "#8b9b82");
}
function formatTime(ms) {
  let s = ms / 1000;
  return (
    String(Math.floor(s / 60)).padStart(2, "0") +
    ":" +
    (s % 60).toFixed(1).padStart(4, "0")
  );
}
function applyEvent(e) {
  workspace.highlightBlock(e.id || null);
  $("simLabel").textContent = e.label;
  if (e.kind === "layout") sim.layout = e.layout;
  if (e.kind === "pin") sim.pins[e.pin] = e.value;
  if (e.kind === "text") {
    sim.text = (sim.text + e.text).slice(-500);
    sim.keys = "";
  }
  if (e.kind === "url") {
    sim.url = e.url;
    sim.target = e.target;
    sim.text = "Expected to open · " + e.target;
    sim.keys = "";
  }
  if (e.kind === "key" || e.kind === "hold") sim.keys = e.label;
  if (e.kind === "release") sim.keys = "";
  const li = document.createElement("li");
  li.textContent = formatTime(sim.elapsed) + " · " + e.label;
  $("eventLog").append(li);
  if ($("eventLog").children.length > 100) $("eventLog").firstChild.remove();
  $("eventCount").textContent = sim.index + 1;
}
function resetSim() {
  cancelAnimationFrame(frame);
  sim = {
    index: 0,
    running: false,
    elapsed: 0,
    eventElapsed: 0,
    pins: [0, 0, 0],
    text: "",
    url: "",
    keys: "",
    target: "",
    layout: "",
    started: false,
  };
  $("play").textContent = "▶ Run";
  $("eventLog").replaceChildren();
  $("eventCount").textContent = "0";
  $("simLabel").textContent =
    "Ready. No commands will be sent to your computer.";
  $("clock").textContent = "00:00.0";
  $("progressFill").style.width = "0%";
  workspace?.highlightBlock(null);
  draw();
}
function updateProgress() {
  $("clock").textContent = formatTime(sim.elapsed);
  $("progressFill").style.width =
    (generated?.duration
      ? Math.min(100, (sim.elapsed / generated.duration) * 100)
      : 0) + "%";
}
function finish() {
  sim.running = false;
  $("play").textContent = "↻ Repeat";
  workspace.highlightBlock(null);
  if (generated?.events.at(-1)?.kind !== "end")
    $("simLabel").textContent = "Simulation sequence complete.";
  draw();
}
function tick(now) {
  if (!sim.running) return;
  let dt = Math.min(100, now - last) * Number($("speed").value);
  last = now;
  const events = generated?.events || [];
  let guard = 0;
  while (dt >= 0 && sim.index < events.length && guard++ < 100) {
    const e = events[sim.index];
    if (!sim.started) {
      applyEvent(e);
      sim.started = true;
    }
    let take = Math.min(dt, Math.max(0, e.ms - sim.eventElapsed));
    sim.elapsed += take;
    sim.eventElapsed += take;
    dt -= take;
    if (sim.eventElapsed >= e.ms) {
      if (e.kind === "key") sim.keys = "";
      sim.index++;
      sim.eventElapsed = 0;
      sim.started = false;
    } else break;
    if (dt === 0 && events[sim.index]?.ms > 0) break;
  }
  updateProgress();
  draw();
  if (sim.index >= events.length) {
    finish();
    return;
  }
  frame = requestAnimationFrame(tick);
}
function simulate() {
  if (!generated) return toast("Fix the blocks before simulating.");
  if (manual) toast("Simulating blocks: manual C++ edits are not simulated.");
  if (sim.running) {
    sim.running = false;
    cancelAnimationFrame(frame);
    $("play").textContent = "▶ Resume";
    draw();
    return;
  }
  if (sim.index >= generated.events.length) resetSim();
  sim.running = true;
  $("play").textContent = "Ⅱ Pause";
  last = performance.now();
  frame = requestAnimationFrame(tick);
}
function step() {
  if (!generated) return;
  sim.running = false;
  cancelAnimationFrame(frame);
  $("play").textContent = "▶ Resume";
  if (sim.index >= generated.events.length) resetSim();
  const e = generated.events[sim.index];
  if (!e) return;
  if (!sim.started) applyEvent(e);
  sim.elapsed += Math.max(0, e.ms - sim.eventElapsed);
  sim.index++;
  sim.eventElapsed = 0;
  sim.started = false;
  if (e.kind === "key") sim.keys = "";
  updateProgress();
  draw();
  if (sim.index >= generated.events.length) finish();
}
function guide(sources = false) {
  $("guideContent").innerHTML = sources
    ? `<p>Components are bundled locally: no CDN is needed.</p><ul><li><a href="https://github.com/RaspberryPiFoundation/blockly" target="_blank" rel="noreferrer">Blockly</a> · visual blocks, Apache-2.0.</li><li><a href="https://github.com/codemirror/dev" target="_blank" rel="noreferrer">CodeMirror 6</a> · C++ editor, MIT.</li><li><a href="https://github.com/carlosperate/ardublockly" target="_blank" rel="noreferrer">Ardublockly</a> · reference for the blocks-to-Arduino workflow. No code copied.</li><li><a href="https://github.com/ArminJo/DigistumpArduino" target="_blank" rel="noreferrer">DigistumpArduino</a> · core and DigiKeyboard 1.7.5. The repository marks this core as no longer maintained.</li></ul><p>The code generator and Canvas 2D scene were developed for this application.</p>`
    : `<p>Use Overview to see everything together, or choose Blocks, Simulation, and Code for a full-width view. Mobile devices start in Blocks view.</p><ol><li>Select the operating system and keyboard layout <b>of the target computer</b>.</li><li>Drag modules from the toolbox and connect them to <b>On start</b>. Load an example to get started.</li><li>Press <b>Run</b> or <b>Step</b>. Set P0–P2 under “Simulated inputs”. Infinite loops preview three iterations.</li><li>Edit the C++ freely: the editor preserves your changes while simulation continues to use the blocks. <b>Regenerate</b> replaces manual code with block-generated code.</li><li><b>Check code</b> uses the installed Arduino CLI. <b>Export .ino</b> downloads the current sketch.</li><li>Open the sketch in Arduino IDE: select Digispark and <b>16.5 MHz – For V-USB</b>. Click Upload with the board unplugged, then connect it when prompted.</li></ol><p>The built-in LED normally uses P1; some clones use P0. P3/P4 are reserved for USB. Text supports ASCII: emoji and accented characters are reported before export.</p><p>“Try all 15 layouts” repeats the sequence for each layout, starting with your selection. A final Forever loop runs after the attempts; move nested infinite loops to the end. The layout is not detected automatically. The theme button saves your preference in the browser. Studio generates and compiles code; upload it using Arduino IDE. Simulation does not test USB detection or guarantee URL opening or autoplay.</p><p>Editor shortcuts: Ctrl/Cmd+F to search, Ctrl/Cmd+Z to undo, Tab to indent. Projects are saved in the browser; download the JSON to keep a backup.</p>`;
  $("guide").showModal();
}
function updateKeyboardConfig() {
  const sweep = $("layoutMode").value === "sweep";
  $("layoutPauseLabel").hidden = !sweep;
  document.querySelector(".config-card").classList.toggle("sweep", sweep);
  $("layoutHint").textContent = sweep
    ? "Repeats the sequence with 15 layouts, starting with your selection. A final Forever loop runs after the attempts. Working layouts are not detected."
    : "Choose the active layout on the target computer. The board cannot detect it automatically.";
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("digispark-theme", theme);
  } catch {}
  const dark = theme === "dark";
  $("themeToggle").textContent = dark ? "☀ Light theme" : "☾ Dark theme";
  $("themeToggle").setAttribute("aria-pressed", String(dark));
  if (workspace && darkTheme) workspace.setTheme(dark ? darkTheme : lightTheme);
  draw();
}

function updateActions() {
  const valid = !!generated;
  $("play").disabled = !valid;
  $("step").disabled = !valid;
  $("export").disabled = !valid && !manual;
  $("compile").disabled =
    (!valid && !manual) || $("compile").dataset.busy === "true";
  $("regenerate").disabled = !manual;
}
function setView(view, fit = false) {
  document.body.dataset.view = view;
  document.querySelectorAll(".view-tabs [role=tab]").forEach((b) => {
    const active = b.dataset.view === view;
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
  });
  requestAnimationFrame(() => {
    if ($("blockly").offsetWidth) {
      Blockly.svgResize(workspace);
      if (fit) workspace.zoomToFit();
    }
    editor?.requestMeasure();
    draw();
  });
}
function initViews() {
  const mobile = matchMedia("(max-width:800px)");
  document
    .querySelectorAll(".view-tabs [role=tab]")
    .forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelector(".view-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...document.querySelectorAll(".view-tabs [role=tab]")].filter(
      (t) => t.offsetWidth,
    );
    let i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    i =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[i].focus();
    setView(tabs[i].dataset.view);
  });
  const showModules = (visible) => {
    workspace.getToolbox().setVisible(visible);
    $("toggleModules").setAttribute("aria-expanded", String(visible));
    requestAnimationFrame(() => Blockly.svgResize(workspace));
  };
  mobile.addEventListener("change", (e) => {
    showModules(!e.matches);
    setView(e.matches ? "blocks" : "all", e.matches);
  });
  showModules(!mobile.matches);
  $("toggleModules").onclick = () =>
    showModules($("toggleModules").getAttribute("aria-expanded") !== "true");
  setView(mobile.matches ? "blocks" : "all");
  document.addEventListener("pointerdown", (e) => {
    const d = $("advancedSettings");
    if (d.open && !d.contains(e.target)) d.open = false;
  });
}

async function init() {
  catalog = await (await fetch("/api/catalog")).json();
  Object.entries(catalog.layouts).forEach(([v, t]) =>
    $("layout").add(new Option(t, v)),
  );
  const unavailable = document.createElement("optgroup");
  unavailable.label = "Unsupported by core 1.7.5";
  Object.entries(catalog.unavailableLayouts || {}).forEach(([v, t]) => {
    const o = new Option(t + " · unavailable", v);
    o.disabled = true;
    unavailable.append(o);
  });
  $("layout").append(unavailable);
  $("layout").value = "ITALIAN";
  defineBlocks();
  lightTheme = Blockly.Theme.defineTheme("studio", {
    base: Blockly.Themes.Classic,
    fontStyle: { family: "system-ui", weight: "500", size: 11 },
    componentStyles: {
      workspaceBackgroundColour: "#fcfdf9",
      toolboxBackgroundColour: "#f6f8f2",
      toolboxForegroundColour: "#48634e",
      flyoutBackgroundColour: "#edf1e7",
      flyoutForegroundColour: "#365340",
      flyoutOpacity: 0.97,
      insertionMarkerColour: "#547959",
      insertionMarkerOpacity: 0.3,
      cursorColour: "#547959",
    },
  });
  workspace = Blockly.inject("blockly", {
    toolbox: {
      kind: "categoryToolbox",
      contents: groups.map(([name, col, types]) => ({
        kind: "category",
        name,
        colour: colors[col],
        contents: types.map((type) => ({ kind: "block", type })),
      })),
    },
    theme: lightTheme,
    renderer: "zelos",
    grid: { spacing: 24, length: 2, colour: "#dfe6d7", snap: true },
    zoom: {
      controls: true,
      wheel: true,
      startScale: 0.85,
      maxScale: 1.5,
      minScale: 0.4,
      scaleSpeed: 1.1,
    },
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: true },
    media: "/static/blockly-media/",
    sounds: false,
  });
  darkTheme = Blockly.Theme.defineTheme("studioDark", {
    base: lightTheme,
    componentStyles: {
      workspaceBackgroundColour: "#17221d",
      toolboxBackgroundColour: "#202d25",
      toolboxForegroundColour: "#d2e1d2",
      flyoutBackgroundColour: "#29392e",
      flyoutForegroundColour: "#e0e9d9",
      flyoutOpacity: 1,
      insertionMarkerColour: "#aecb94",
      insertionMarkerOpacity: 0.4,
      scrollbarColour: "#506a55",
      cursorColour: "#aecb94",
    },
  });
  applyTheme(document.documentElement.dataset.theme || "dark");
  editor = new EditorView({
    state: EditorState.create({
      doc: "// Connect blocks to generate your sketch.",
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        cpp(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !settingCode) {
            manual = true;
            mode();
            persist();
          }
        }),
      ],
    }),
    parent: $("editor"),
  });
  workspace.addChangeListener((e) => {
    if (!e.isUiEvent) queue();
  });
  new ResizeObserver(() => {
    if ($("blockly").offsetWidth) Blockly.svgResize(workspace);
  }).observe($("blockly"));
  for (const id of [
    "os",
    "layout",
    "layoutMode",
    "layoutPause",
    "ledPin",
    "startup",
  ])
    $(id).addEventListener("change", queue);
  document
    .querySelectorAll("[data-pin]")
    .forEach((e) => e.addEventListener("change", queue));
  $("projectName").addEventListener("input", persist);
  initViews();
  $("copyCode").onclick = async () => {
    try {
      await navigator.clipboard.writeText(editor.state.doc.toString());
      toast("Code copied to clipboard.");
    } catch {
      toast(
        "Clipboard unavailable: select the code in the editor and copy it.",
      );
    }
  };
  $("undo").onclick = () => workspace.undo(false);
  $("redo").onclick = () => workspace.undo(true);
  $("fit").onclick = () => workspace.zoomToFit();
  $("play").onclick = simulate;
  $("step").onclick = step;
  $("reset").onclick = resetSim;
  $("regenerate").onclick = () => {
    if (
      !manual ||
      confirm("Replace manual edits with code generated from blocks?")
    )
      regenerate(true);
  };
  $("newProject").onclick = () => {
    if (
      confirm(
        "Create a new project? Download a JSON copy to keep your current work.",
      )
    )
      loadNodes([], "New project");
  };
  $("examples").onchange = (e) => {
    if (!e.target.value) return;
    let key = e.target.value;
    if (confirm("Load this example and replace the current project?"))
      loadNodes(
        samples[key],
        {
          rickroll: "My Rickroll",
          hello: "Hello world",
          blink: "Blinking light",
          gpio: "Button and LED",
          os: "OS-aware shortcuts",
          all: "All modules",
        }[key],
      );
    e.target.value = "";
  };
  $("save").onclick = () => {
    try {
      download(
        filename() + ".digispark.json",
        JSON.stringify(snapshot(), null, 2),
        "application/json",
      );
      toast("Project saved: blocks, settings, and manual code.");
    } catch (e) {
      toast(e.message);
    }
  };
  $("export").onclick = async () => {
    clearTimeout(timer);
    await regenerate();
    if (!manual && !generated) return toast("Fix the errors before exporting.");
    download(filename() + ".ino", editor.state.doc.toString(), "text/plain");
    toast("Sketch exported. Open it in Arduino IDE to upload it.");
  };
  $("import").onclick = () => $("fileInput").click();
  $("fileInput").onchange = async (e) => {
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 512000) throw Error("File too large.");
      restore(JSON.parse(await f.text()));
      toast("Imported project.");
    } catch (err) {
      toast(err.message);
    }
    e.target.value = "";
  };
  $("compile").onclick = async () => {
    const b = $("compile");
    b.dataset.busy = "true";
    b.disabled = true;
    b.textContent = "Compiling…";
    try {
      clearTimeout(timer);
      await regenerate();
      if (!manual && !generated)
        throw Error("Fix the blocks before compiling.");
      const r = await api("/api/compile", {
        code: editor.state.doc.toString(),
      });
      $("diagnostics").open = true;
      $("compileOutput").hidden = false;
      $("compileOutput").textContent = r.output;
      toast(
        r.ok
          ? "Compilation succeeded. No firmware was uploaded."
          : "The compiler found errors: check the report.",
      );
    } catch (e) {
      $("diagnostics").open = true;
      $("compileOutput").hidden = false;
      $("compileOutput").textContent = e.message;
      toast(e.message);
    } finally {
      b.dataset.busy = "false";
      b.textContent = "✓ Check code";
      updateActions();
    }
  };
  $("themeToggle").onclick = () =>
    applyTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    );
  $("help").onclick = () => guide();
  $("sources").onclick = () => guide(true);
  $("closeGuide").onclick = () => $("guide").close();
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem("digispark-studio-v1"));
    if (stored) restore(stored);
    else loadNodes(samples.rickroll, "My Rickroll");
  } catch {
    loadNodes(samples.rickroll, "My Rickroll");
    toast("Could not read the saved project: loaded an example.");
  }
  fetch("/api/status")
    .then((r) => r.json())
    .then((s) => {
      $("compilerStatus").textContent = s.compiler
        ? "● Compiler ready"
        : "○ Compiler setup required";
      $("compilerStatus").title = s.reason;
    })
    .catch(() => {
      $("compilerStatus").textContent = "○ Compiler status unavailable";
    });
  // Integration hooks for the browser test suite.
  updateKeyboardConfig();
  window.studio = {
    get workspace() {
      return workspace;
    },
    get editor() {
      return editor;
    },
    get generated() {
      return generated;
    },
    get manual() {
      return manual;
    },
    samples,
    loadNodes,
    regenerate,
    project,
    restore,
    snapshot,
  };
  draw();
}
init().catch((e) => {
  toast("Startup failed: " + e.message);
  console.error(e);
});
