/** Whether the „Zgłoś” dialog is open.
 *
 * Shared state rather than a `ref` inside the launcher, so a card on `/pomoc`
 * or the call to action on the home page opens the dialog that is already
 * mounted instead of mounting a second copy of it. `feedback/Launcher.vue`
 * hangs off `layouts/default.vue`, which the `gray` layout wraps, so it exists
 * on every route either of those callers live on.
 *
 * `useState` and not `ref`, because a module-level ref on the server is shared
 * between requests: one reader opening the dialog would open it for whoever
 * rendered next.
 */
export const useFeedbackDialog = () =>
  useState<boolean>("feedback-dialog", () => false);
