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

function isEditable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
  return false;
}

function buildSnapshot(): PageSnapshot {
  const selector = [
    "a[href]",
    "button",
    'input:not([type="hidden"])',
    "textarea",
    "select",
    "[contenteditable=''], [contenteditable='true']",
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const elements: PageElement[] = [];

  nodes.forEach((el, index) => {
    const html = el as HTMLElement;
    const ref = html.dataset.agentRef ?? `r_${index + 1}`;
    html.dataset.agentRef = ref;

    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute("aria-label") || "";
    const placeholder = (el as HTMLInputElement).placeholder || "";
    const rawText =
      aria ||
      placeholder ||
      (el.textContent || (el as HTMLInputElement).value || "").toString();
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, 240);
    const type = (el as HTMLInputElement).type;
    const href = (el as HTMLAnchorElement).href;
    const role = el.getAttribute("role") || (isEditable(el) && tag === "div" ? "textbox" : undefined);

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

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

async function typeIntoContentEditable(el: HTMLElement, text: string) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }
}

function pressEnter(el: HTMLElement) {
  const opts: KeyboardEventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit;
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keypress", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
}

async function execute(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "click_element": {
      const ref = String(args.ref ?? "");
      const el = document.querySelector(`[data-agent-ref="${CSS.escape(ref)}"]`) as HTMLElement | null;
      if (!el) throw new Error(`No element for ref ${ref}`);
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true };
    }
    case "type_text": {
      const ref = String(args.ref ?? "");
      const text = String(args.text ?? "");
      const submit = Boolean(args.submit);
      const el = document.querySelector(`[data-agent-ref="${CSS.escape(ref)}"]`) as HTMLElement | null;
      if (!el) throw new Error(`No element for ref ${ref}`);

      el.scrollIntoView({ block: "center", inline: "center" });

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        setNativeValue(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (submit) pressEnter(el);
        return { ok: true, mode: "native-input" };
      }

      if ((el as HTMLElement).isContentEditable || el.getAttribute("role") === "textbox") {
        await typeIntoContentEditable(el, text);
        if (submit) pressEnter(el);
        return { ok: true, mode: "contenteditable" };
      }

      throw new Error(`Element ref=${ref} is not editable`);
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
