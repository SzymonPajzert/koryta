declare module "#app" {
  interface PageMeta {
    fullWidth?: boolean;
    /** How wide the page's content may be, in px: the default layout's
     * container, or the white sheet of `layout: "gray"`. 1200 in both. */
    maxWidth?: number;
    affineLink?: string;
    hideSearch?: boolean;
  }
}

export {};
