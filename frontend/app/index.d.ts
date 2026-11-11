declare module "#app" {
  interface PageMeta {
    fullWidth?: boolean;
    maxWidth?: number;
    /** How wide a `fullWidth` page's content column is, for what the layout
     * lines up with it: the signed-in strip under the app bar. */
    columnWidth?: number;
    affineLink?: string;
    hideSearch?: boolean;
  }
}

export {};
