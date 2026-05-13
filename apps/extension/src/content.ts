import type { PageElement, PageSnapshot } from "./types";

type CaptureMessage = { type: "AGENT_CAPTURE_SNAPSHOT" };
type ExecuteMessage = {
  type: "AGENT_EXECUTE";
  name: string;
  args: Record<string, unknown>;
};

function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (!html.getBoundingClientRect) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
  const r = html.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return true;
}

function buildSnapshot(): PageSnapshot {
  const selector =
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

  const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const elements: PageElement[] = [];

  nodes.forEach((el, index) => {
    const html = el as HTMLElement;
    const ref = html.dataset.agentRef ?? `r_${index + 1}`;
    html.dataset.agentRef = ref;

    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const type = (el as HTMLInputElement).type;
    const href = (el as HTMLAnchorElement).href;
    const role = el.getAttribute("role") || undefined;

    elements.push({
      ref,
      tag,
      text: text || undefined,
      type: type || undefined,
      href: href || undefined,
      role,
    });
  });

  return {
    url: location.href,
    title: document.title,
    elements,
  };
}

async function execute(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "click_element": {
      const ref = String(args.ref ?? "");
      const el = document.querySelector(`[data-agent-ref="${CSS.escape(ref)}"]`) as HTMLElement | null;
      if (!el) throw new Error(`No element for ref ${ref}`);
      el.click();
      return { ok: true };
    }
    case "type_text": {
      const ref = String(args.ref ?? "");
      const text = String(args.text ?? "");
      const submit = Boolean(args.submit);
      const el = document.querySelector(`[data-agent-ref="${CSS.escape(ref)}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!el) throw new Error(`No element for ref ${ref}`);
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      }
      return { ok: true };
    }
    case "scroll_page": {
      const direction = String(args.direction ?? "down");
      const delta = Math.floor(window.innerHeight * 0.85);
      if (direction === "down") window.scrollBy({ top: delta, behavior: "auto" });
      else if (direction === "up") window.scrollBy({ top: -delta, behavior: "auto" });
      else if (direction === "top") window.scrollTo({ top: 0, behavior: "auto" });
      else if (direction === "bottom")
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
      return { ok: true, direction };
    }
    default:
      throw new Error(`Unsupported action in content script: ${name}`);
  }
}

chrome.runtime.onMessage.addListener((message: CaptureMessage | ExecuteMessage, _sender, sendResponse) => {
  if (message.type === "AGENT_CAPTURE_SNAPSHOT") {
    sendResponse({ ok: true, snapshot: buildSnapshot() });
    return;
  }

  if (message.type === "AGENT_EXECUTE") {
    void execute(message.name, message.args)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  return false;
});
