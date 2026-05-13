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
