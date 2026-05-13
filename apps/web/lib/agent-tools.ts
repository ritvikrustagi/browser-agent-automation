import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Open a URL in the active tab.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute https URL" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an element using its ref from the page snapshot.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input or textarea identified by ref.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean", description: "If true, dispatch Enter after typing" },
        },
        required: ["ref", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description: "Scroll the page vertically.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_ms",
      description: "Wait for UI/network to settle.",
      parameters: {
        type: "object",
        properties: { ms: { type: "integer", minimum: 0, maximum: 30000 } },
        required: ["ms"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description:
        "Capture a screenshot of the visible portion of the active tab. Use this when the DOM snapshot is not enough — e.g., to inspect visual layout, images, charts, or content rendered in a canvas. The image will be attached to your next page update.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why you need the screenshot (logged for debugging)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_human_approval",
      description:
        "Pause and ask the user to approve a sensitive or destructive next step. The UI will show the message.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          proposed_action: { type: "string", description: "Short summary of what you want to do next" },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "done",
      description: "Finish the task when the user's goal is satisfied or impossible.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          success: { type: "boolean" },
        },
        required: ["summary", "success"],
      },
    },
  },
];

export const SYSTEM_PROMPT = `You are a careful browser automation agent. You receive:
- The user's original goal
- A structured list of interactive elements with stable refs (data-agent-ref)
- Optionally a screenshot of the current viewport when you call the screenshot tool

Rules:
- Prefer the smallest sequence of actions needed.
- Only use refs that appear in the latest snapshot.
- Call screenshot when the text snapshot is ambiguous (e.g., visual choice, image content, canvas, or to confirm which input is focused).
- For chat/DM apps the message field is usually a contenteditable role=textbox; type into it then either click the Send button or set submit=true to press Enter.
- If you are unsure or the action could spend money, delete data, or publish content, call request_human_approval first.
- When finished, call done with a concise summary.
- After navigation, expect the next snapshot to change; do not assume old refs still exist.`;
