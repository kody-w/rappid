const VIRTUAL_BROWSER_SCHEMA = "rapp-zoo-virtual-browser/2.0";

function visible(element) {
  const style = getComputedStyle(element);
  const rectangle = element.getBoundingClientRect();
  return !element.hidden
    && style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity) > 0
    && rectangle.width > 0
    && rectangle.height > 0;
}

function labelOf(element) {
  if (element.getAttribute("aria-label")) return element.getAttribute("aria-label");
  if (element.labels?.length) {
    return [...element.labels].map((label) => label.textContent.trim()).join(" ");
  }
  return (
    element.textContent?.trim()
    || element.getAttribute("placeholder")
    || element.getAttribute("title")
    || element.dataset.zooControl
  ).slice(0, 240);
}

function roleOf(element) {
  return element.getAttribute("role")
    || ({
      BUTTON: "button",
      INPUT: element.type === "checkbox" ? "checkbox" : "textbox",
      TEXTAREA: "textbox",
      SELECT: "combobox",
      A: "link",
    }[element.tagName] || "control");
}

export function createVirtualBrowserAutopilot({ getAppState }) {
  let revision = 0;
  const markChanged = () => { revision += 1; };
  const observer = new MutationObserver(markChanged);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  for (const event of ["resize", "focus", "blur", "online", "offline"]) {
    window.addEventListener(event, markChanged);
  }
  document.addEventListener("visibilitychange", markChanged);

  function controls() {
    const ids = new Set();
    return [...document.querySelectorAll("[data-zoo-control]")].map((element) => {
      const controlId = element.dataset.zooControl;
      if (!controlId || ids.has(controlId)) {
        throw new Error(`Semantic control IDs must be present and unique: ${controlId}`);
      }
      ids.add(controlId);
      const control = {
        control_id: controlId,
        role: roleOf(element),
        label: labelOf(element),
        visible: visible(element),
        disabled: Boolean(element.disabled),
      };
      if (
        element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement
      ) {
        const value = element.type === "password" ? null : element.value;
        control.value = typeof value === "string" && value.length > 4096
          ? `${value.slice(0, 4096)}…`
          : value;
        control.value_truncated = typeof value === "string" && value.length > 4096;
      }
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        control.checked = element.checked;
      }
      return control;
    });
  }

  function snapshot() {
    return {
      schema: VIRTUAL_BROWSER_SCHEMA,
      revision,
      browser: {
        url: location.href,
        origin: location.origin,
        title: document.title,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        online: navigator.onLine,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          device_pixel_ratio: window.devicePixelRatio,
        },
        user_agent: navigator.userAgent,
      },
      app_state: structuredClone(getAppState()),
      controls: controls(),
    };
  }

  async function settle() {
    const deadline = performance.now() + 10_000;
    while (
      document.documentElement.dataset.zooBusy === "true"
      && performance.now() < deadline
    ) {
      await new Promise((resolve) => {
        window.addEventListener("zoo-action-settled", resolve, { once: true });
        setTimeout(resolve, 100);
      });
    }
    if (document.documentElement.dataset.zooBusy === "true") {
      throw new Error("Visible control action did not settle within 10 seconds.");
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function handle(command) {
    if (command.command === "snapshot") return snapshot();
    if (command.revision !== revision) {
      const error = new Error(`Expected screen revision ${revision}, received ${command.revision}.`);
      error.code = "STALE_REVISION";
      throw error;
    }
    const controlId = command.args.control_id;
    const element = document.querySelector(
      `[data-zoo-control="${CSS.escape(controlId)}"]`,
    );
    if (!element || !visible(element) || element.disabled) {
      throw new Error(`Semantic control ${controlId} is unavailable.`);
    }
    if (command.command === "input") {
      if (!(
        element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement
      )) {
        throw new Error(`Semantic control ${controlId} does not accept text.`);
      }
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        if (!["true", "false"].includes(command.args.value)) {
          throw new Error("Checkbox input value must be true or false.");
        }
        element.checked = command.args.value === "true";
      } else {
        element.value = command.args.value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (command.command === "invoke") {
      element.click();
    } else {
      throw new Error(`Renderer cannot execute ${command.command}.`);
    }
    await settle();
    return snapshot();
  }

  return { handle, markChanged, snapshot };
}
