import { createVirtualBrowserAutopilot } from "./autopilot.js";

let state = {
  schema: "rapp-zoo-ui-state/2.0",
  estate: null,
  neighborhoods: [],
  selected_neighborhood: null,
  transcripts: {},
  health: {},
  global_object: null,
  monorepo_companion: null,
  local_summons: [],
  drill_result: null,
  library: [],
  prototype: null,
  children: [],
  report: { config: null, last: null },
};
let activeTab = "neighborhoods";
let autopilot;
let pendingActions = 0;
let chatBusy = false;

const $ = (selector) => document.querySelector(selector);

function notice(message, error = false) {
  const element = $("#notice");
  element.textContent = message;
  element.classList.toggle("error", error);
}

async function action(working, operation, success = "Done.") {
  pendingActions += 1;
  document.documentElement.dataset.zooBusy = "true";
  notice(working);
  try {
    const result = await operation();
    notice(typeof success === "function" ? success(result) : success);
    return result;
  } catch (error) {
    notice(String(error?.message || error), true);
    throw error;
  } finally {
    pendingActions -= 1;
    if (pendingActions === 0) {
      document.documentElement.dataset.zooBusy = "false";
      window.dispatchEvent(new CustomEvent("zoo-action-settled"));
    }
  }
}

function tail(value, count = 8) {
  return String(value || "").slice(-count);
}

function clip(value, max = 4096) {
  return typeof value === "string" && value.length > max
    ? `${value.slice(0, max)}…`
    : value;
}

function semanticAppState(source) {
  const semantic = structuredClone(source);
  semantic.transcript_meta = {};
  semantic.transcripts = Object.fromEntries(
    Object.entries(source.transcripts || {}).map(([rappid, messages]) => {
      semantic.transcript_meta[rappid] = {
        message_count: messages.length,
        omitted: Math.max(0, messages.length - 20),
      };
      return [
        rappid,
        messages.slice(-20).map((message) => ({
          ...message,
          text: clip(message.text),
        })),
      ];
    }),
  );
  if (semantic.global_object?.dimensions) {
    for (const dimension of Object.values(semantic.global_object.dimensions)) {
      if (typeof dimension.value === "string") {
        dimension.value = clip(dimension.value, 16 * 1024);
      } else if (
        dimension.value !== null
        && JSON.stringify(dimension.value).length > 16 * 1024
      ) {
        dimension.value = {
          omitted_from_semantic_snapshot: true,
          reason: "value exceeds 16 KiB; inspect through the visible dimension card",
        };
      }
    }
  }
  if (semantic.report?.last) {
    const report = semantic.report.last;
    semantic.report.last = {
      schema: report.schema,
      estate_id: report.estate_id,
      generated_utc: report.generated_utc,
      period_start_utc: report.period_start_utc,
      period_end_utc: report.period_end_utc,
      summary: report.summary,
      handoff_point: clip(report.handoff_point),
      primary_actions: report.primary_actions.slice(0, 20).map((entry) => clip(entry)),
      detailed_records_omitted: report.summary.operation_count,
    };
  }
  return semantic;
}

function element(tag, {
  className = "",
  text = "",
  control = null,
  type = null,
} = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (control) node.dataset.zooControl = control;
  if (type) node.type = type;
  return node;
}

function activateTab(name) {
  activeTab = name;
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.classList.toggle("active", button.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll("[data-panel]")) {
    const active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }
  autopilot?.markChanged();
}

function renderNeighborhoods() {
  const container = $("#neighborhood-list");
  container.replaceChildren();
  for (const neighborhood of state.neighborhoods) {
    const card = element("div", { className: "card resident" });
    const body = document.createElement("div");
    const select = element("button", {
      className: "select",
      control: neighborhood.kind === "resident"
        ? `neighborhood.select.${tail(neighborhood.rappid)}`
        : null,
      type: "button",
    });
    select.disabled = neighborhood.kind !== "resident";
    const name = element("strong", { text: neighborhood.name });
    const meta = element("span", {
      className: "mono subtle",
      text: neighborhood.rappid,
    });
    select.append(name, meta);
    if (neighborhood.kind === "resident") {
      select.addEventListener("click", () => action(
        "Selecting local resident...",
        async () => {
          state = await window.zoo.getState(neighborhood.rappid);
          render();
        },
        "Resident selected.",
      ));
    }
    body.append(select);
    const actions = element("div", { className: "row-actions" });
    actions.append(element("span", {
      className: "badge",
      text: neighborhood.kind,
    }));
    if (neighborhood.kind === "resident") {
      const detach = element("button", {
        text: "Detach",
        control: `neighborhood.detach.${tail(neighborhood.rappid)}`,
        type: "button",
      });
      detach.addEventListener("click", () => action(
        "Detaching resident...",
        () => window.zoo.detach(neighborhood.rappid),
        "Resident detached.",
      ));
      actions.append(detach);
    }
    card.append(body, actions);
    container.append(card);
  }

  const selected = state.neighborhoods.find(
    (entry) => entry.rappid === state.selected_neighborhood,
  );
  $("#chat-title").textContent = selected?.name || "Choose a resident";
  $("#health-button").disabled = !selected;
  $("#chat-input").disabled = !selected;
  $('[data-zoo-control="chat.send"]').disabled = !selected;
  const transcript = $("#transcript");
  transcript.replaceChildren();
  const messages = selected ? state.transcripts[selected.rappid] || [] : [];
  if (!messages.length) {
    transcript.append(element("div", {
      className: "empty-state",
      text: selected
        ? "No turns yet. The exact RAPP/1 wire is ready."
        : "Select a resident to open its local chat.",
    }));
  } else {
    for (const message of messages) {
      transcript.append(element("div", {
        className: `message ${message.role}`,
        text: message.text,
      }));
    }
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function renderMonorepoCompanion() {
  const companion = $("#monorepo-object");
  if (!state.monorepo_companion) {
    companion.className = "card empty-state";
    companion.textContent = "The full RAPP organism is not loaded into the cage.";
  } else {
    companion.className = "card";
    companion.replaceChildren(
      element("h3", { text: "RAPP monorepo companion" }),
      element("p", {
        text: `${state.monorepo_companion.repository_count} repository dimensions · ${
          state.monorepo_companion.file_count
        } files · selected dimensions only`,
      }),
      element("p", {
        className: "mono subtle",
        text: state.monorepo_companion.companion_id,
      }),
    );
  }
}

function renderGlobal() {
  renderMonorepoCompanion();
  $("#global-status").textContent = state.global_object
    ? `${state.global_object.loaded_dimensions.length} dimensions loaded`
    : "No global object";
  $("#global-save").disabled = !state.global_object;
  const container = $("#global-object");
  if (!state.global_object) {
    container.className = "card empty-state";
    container.textContent = "No global object loaded.";
    return;
  }
  container.className = "card";
  const title = element("h3", { text: state.global_object.name });
  const source = element("p", {
    className: "mono subtle",
    text: state.global_object.object_id,
  });
  const grid = element("div", { className: "dimension-grid" });
  for (const [name, dimension] of Object.entries(
    state.global_object.dimensions || {},
  )) {
    const card = element("div", { className: "dimension" });
    card.append(
      element("strong", { text: name }),
      element("p", {
        className: "subtle",
        text: `${dimension.media_type} · ${dimension.bytes} bytes`,
      }),
      element("p", { className: "mono", text: dimension.sha256 }),
    );
    if (dimension.value !== null && dimension.value !== undefined) {
      const preview = element("pre", {
        text: typeof dimension.value === "string"
          ? dimension.value
          : JSON.stringify(dimension.value, null, 2),
      });
      card.append(preview);
    }
    grid.append(card);
  }
  container.replaceChildren(title, source, grid);

}

function renderDrill() {
  const container = $("#drill-result");
  if (!state.drill_result) {
    container.className = "card empty-state";
    container.textContent = "No lookup run yet.";
    return;
  }
  container.className = "card";
  container.replaceChildren(
    element("h3", {
      text: `${state.drill_result.matches.length} local match${
        state.drill_result.matches.length === 1 ? "" : "es"
      }`,
    }),
    element("p", {
      className: "subtle",
      text: "Source: locally saved summons only. No network path exists here.",
    }),
    element("pre", { text: JSON.stringify(state.drill_result, null, 2) }),
  );
}

function renderLibrary() {
  const container = $("#library-list");
  container.replaceChildren();
  if (!state.library.length) {
    container.append(element("div", {
      className: "card empty-state",
      text: "No approved summons yet. Import a public line or approve a verified local template.",
    }));
    return;
  }
  for (const entry of state.library) {
    const card = element("div", { className: "card library-entry" });
    const body = document.createElement("div");
    body.append(
      element("strong", { text: entry.name }),
      element("span", {
        className: "mono subtle",
        text: `${entry.alias} · ${entry.version} · ${entry.license.spdx}`,
      }),
    );
    const dial = element("button", {
      text: entry.local_receipt ? "Open local" : "Dial & save",
      control: `library.dial.${entry.alias}`,
      type: "button",
    });
    dial.addEventListener("click", () => action(
      entry.local_receipt ? "Opening local summon..." : "Dialing approved summon...",
      () => window.zoo.dial(entry.alias),
      (result) => result.source === "local"
        ? "Opened verified local summon."
        : "Summon downloaded, verified, and saved locally.",
    ));
    card.append(body, dial);
    container.append(card);
  }
  $("#prototype-export").disabled = !state.prototype;
  const prototype = $("#prototype-status");
  if (!state.prototype) {
    prototype.className = "card empty-state";
    prototype.textContent = "No factory-neutral prototype prepared.";
  } else {
    prototype.className = "card";
    prototype.replaceChildren(
      element("h3", { text: "Mutable prototype workspace ready" }),
      element("p", {
        text: state.prototype.goal,
      }),
      element("p", {
        className: "mono subtle",
        text: `${state.prototype.handoff_id} · RAPP/1 default · non-production`,
      }),
    );
  }
}

function renderChildren() {
  const container = $("#child-list");
  container.replaceChildren();
  if (!state.children.length) {
    container.append(element("div", {
      className: "card empty-state",
      text: "No detached child estates.",
    }));
    return;
  }
  for (const child of state.children) {
    const card = element("div", { className: "card child" });
    const body = document.createElement("div");
    body.append(
      element("strong", { text: child.name }),
      element("span", {
        className: "mono subtle",
        text: `generation ${child.generation} · ${tail(child.rappid, 12)}`,
      }),
    );
    const actions = element("div", { className: "row-actions" });
    actions.append(element("span", {
      className: "badge",
      text: child.capability_live ? "live" : child.status,
    }));
    const stop = element("button", {
      text: "Stop",
      control: `child.stop.${child.slug}`,
      type: "button",
    });
    stop.disabled = !child.capability_live;
    stop.addEventListener("click", () => action(
      "Stopping child through its capability...",
      () => window.zoo.stopChild(child.estate_id),
      "Child stop accepted.",
    ));
    actions.append(stop);
    card.append(body, actions);
    container.append(card);
  }
}

function renderReport() {
  const config = state.report?.config;
  if (config) {
    $("#schedule-enabled").checked = config.enabled;
    $("#schedule-time").value = config.local_time;
    $("#schedule-printer").value = config.printer_name || "";
  }
  $("#report-print").disabled = !state.report?.last;
  const status = $("#report-status");
  if (!state.report?.last) {
    status.className = "card empty-state";
    status.textContent = "No report generated in this session.";
  } else {
    status.className = "card";
    status.replaceChildren(
      element("h3", { text: "Morning handoff ready" }),
      element("p", {
        text: `${state.report.last.summary.operation_count} operations · ${
          state.report.last.summary.blocked
        } blocked · generated ${state.report.last.generated_utc}`,
      }),
      element("p", {
        className: "subtle",
        text: state.report.last.handoff_point,
      }),
    );
  }
}

function render() {
  if (state.estate) {
    document.title = state.estate.app_name;
    $("#estate-name").textContent = state.estate.app_name;
    $("#estate-rappid").textContent = state.estate.rappid;
    $("#estate-status").textContent = "Private local estate ready";
    $("#neighborhood-count").textContent = `${state.neighborhoods.length} neighborhood${
      state.neighborhoods.length === 1 ? "" : "s"
    }`;
  }
  renderNeighborhoods();
  renderGlobal();
  renderDrill();
  renderLibrary();
  renderChildren();
  renderReport();
  activateTab(activeTab);
  autopilot?.markChanged();
}


// ── Party view: the active rappid party and the PC ──────────────────────────
async function renderParty() {
  const partyList = document.getElementById("party-list");
  const pcList = document.getElementById("pc-list");
  if (!partyList || !pcList) return;
  let partyView;
  try {
    partyView = await window.zoo.partyState();
  } catch (error) {
    partyList.replaceChildren(element("p", { className: "empty", text: String(error?.message || error) }));
    return;
  }
  document.getElementById("party-count").textContent = `${partyView.active.length}/${partyView.max}`;
  const row = (rec, inParty) => {
    const card = element("article", { className: "card" });
    card.appendChild(element("h3", { text: rec.display_name || rec.name || rec.species }));
    card.appendChild(element("p", { className: "mono", text: `${rec.species} · ${rec.rarity || "?"} · ${rec.genome_id || ""}` }));
    card.appendChild(element("p", { className: "mono", text: rec.rappid }));
    const actions = element("div", { className: "actions" });
    const tailId = rec.rappid.split(":").pop().slice(0, 12);
    const cry = element("button", { text: "▶ cry", type: "button", control: `party.cry.${tailId}` });
    cry.addEventListener("click", () => { window.zoo.partyCry(rec.rappid); });
    actions.appendChild(cry);
    const move = element("button", {
      text: inParty ? "send to roost" : "add to party",
      type: "button",
      className: inParty ? "" : "primary",
      control: inParty ? `party.roost.${tailId}` : `party.add.${tailId}`,
    });
    move.addEventListener("click", async () => {
      try {
        if (inParty) await window.zoo.partyPC(rec.rappid);
        else await window.zoo.partyAdd(rec.rappid);
      } catch (error) {
        window.alert(String(error?.message || error));
      }
      renderParty();
    });
    actions.appendChild(move);
    card.appendChild(actions);
    return card;
  };
  partyList.replaceChildren(
    ...(partyView.active.length
      ? partyView.active.map((rec) => row(rec, true))
      : [element("p", { className: "empty", text: "No rappids in the party. Add one from the roost." })]),
  );
  pcList.replaceChildren(
    ...(partyView.pc.length
      ? partyView.pc.map((rec) => row(rec, false))
      : [element("p", { className: "empty", text: "The roost is empty — hatch rappids with the species engine (see SPEC.md)." })]),
  );
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab);
    if (button.dataset.tab === "party") renderParty();
  });
}

$("#attach-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Attaching local resident...",
    () => window.zoo.attach({
      name: $("#attach-name").value,
      rappid: $("#attach-rappid").value,
      baseUrl: $("#attach-url").value,
    }),
    "Resident attached.",
  );
});

$("#health-button").addEventListener("click", () => action(
  "Checking typed local health...",
  () => window.zoo.health(state.selected_neighborhood),
  "Neighborhood reports exact status ok.",
));

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (chatBusy) return;
  const input = $("#chat-input");
  const prompt = input.value;
  if (!prompt.trim()) return;
  input.value = "";
  chatBusy = true;
  input.disabled = true;
  $('[data-zoo-control="chat.send"]').disabled = true;
  try {
    await action(
      "Sending exact RAPP/1 turn...",
      () => window.zoo.chat(state.selected_neighborhood, prompt),
      "Turn completed.",
    );
  } finally {
    chatBusy = false;
    renderNeighborhoods();
  }
});

$("#global-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const requested = $("#global-dimensions").value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  await action(
    "Streaming and verifying global dimensions...",
    () => window.zoo.loadGlobal({
      manifestUrl: $("#global-url").value,
      manifestSha256: $("#global-hash").value,
      dimensions: requested.length ? requested : null,
    }),
    "Global object verified and loaded.",
  );
});

$("#global-save").addEventListener("click", () => action(
  "Re-reading and saving every dimension locally...",
  () => window.zoo.saveGlobal(),
  "Local summon receipt created. It is now drillable.",
));

$("#monorepo-load").addEventListener("click", () => action(
  "Loading the pinned monorepo body map into the local cage...",
  () => window.zoo.loadMonorepo(),
  "Monorepo companion loaded as selected, inert dimensions.",
));

$("#drill-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Looking up saved local summons...",
    () => window.zoo.drill({
      dimension: $("#drill-dimension").value,
      sha256: $("#drill-hash").value || null,
    }),
    (result) => `${result.matches.length} local match${result.matches.length === 1 ? "" : "es"}.`,
  );
});

$("#approve-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Verifying local receipt and MIT license evidence...",
    () => window.zoo.approveSummon({
      alias: $("#approve-alias").value,
      rappid: $("#approve-rappid").value,
      name: $("#approve-name").value,
      version: $("#approve-version").value,
      objectId: $("#approve-object").value,
      manifestUrl: $("#approve-manifest-url").value,
      manifestSha256: $("#approve-manifest-hash").value,
      licenseUrl: $("#approve-license-url").value,
      licenseSha256: $("#approve-license-hash").value,
    }),
    "Summon approved for the public telephone-line model.",
  );
});

$("#catalog-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Fetching and verifying the immutable summon line...",
    () => window.zoo.importCatalog({
      url: $("#catalog-url").value,
      sha256: $("#catalog-hash").value,
    }),
    "Approved public catalog imported.",
  );
});

$("#prototype-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const lines = (selector) => $(selector).value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  await action(
    "Copying immutable summon inputs into a mutable prototype workspace...",
    () => window.zoo.preparePrototype({
      alias: $("#prototype-alias").value,
      goal: $("#prototype-goal").value,
      assumptions: lines("#prototype-assumptions"),
      acceptanceCriteria: lines("#prototype-criteria"),
    }),
    "Factory-neutral non-production prototype prepared.",
  );
});

$("#prototype-export").addEventListener("click", () => action(
  "Exporting cross-device prototype data...",
  () => window.zoo.exportPrototype(),
  "Portable prototype transfer created. Federation readiness remains separate.",
));

$("#report-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Generating print-ready morning handoff...",
    () => window.zoo.generateReport({
      handoffPoint: $("#report-handoff").value,
      primaryActions: $("#report-actions").value
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
    }),
    "Morning handoff generated.",
  );
});

$("#report-print").addEventListener("click", () => action(
  "Opening the system print convenience...",
  () => window.zoo.printReport({ silent: false }),
  "Print request completed.",
));

$("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Saving daily print schedule...",
    () => window.zoo.saveReportConfig({
      enabled: $("#schedule-enabled").checked,
      localTime: $("#schedule-time").value,
      printerName: $("#schedule-printer").value || null,
    }),
    "Daily handoff schedule saved.",
  );
});

$("#child-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await action(
    "Hatching isolated child estate...",
    () => window.zoo.hatchChild($("#child-name").value),
    "Child estate launched as another Dock creature.",
  );
});

autopilot = createVirtualBrowserAutopilot({
  getAppState: () => semanticAppState(state),
});
window.zoo.onAutopilotCommand((command) => autopilot.handle(command));
window.zoo.onState((next) => {
  state = next;
  render();
});

state = await window.zoo.getState();
render();
notice("Local estate ready. No product account or cloud runtime required.");
