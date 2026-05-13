export type PageElement = {
  ref: string;
  tag: string;
  text?: string;
  type?: string;
  href?: string;
  role?: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  elements: PageElement[];
};

export function formatSnapshotForModel(snapshot: PageSnapshot): string {
  const lines = snapshot.elements.map((el) => {
    const bits = [`ref=${el.ref}`, `tag=${el.tag}`];
    if (el.role) bits.push(`role=${el.role}`);
    if (el.type) bits.push(`type=${el.type}`);
    if (el.href) bits.push(`href=${el.href}`);
    if (el.text) bits.push(`text=${truncate(el.text, 200)}`);
    return `- ${bits.join(" | ")}`;
  });
  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    "Interactive elements:",
    ...lines,
  ].join("\n");
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
