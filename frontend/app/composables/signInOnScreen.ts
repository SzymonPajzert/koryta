import type { ComputedRef } from "vue";

/** The sign-in dialogs on screen, each under a key of its own. Held in a
 * module, which on the server every request would share: nothing is put in
 * it there (`countSignInOnScreen`). */
const onScreen = shallowReactive(new Set<symbol>());

/**
 * Whether a sign-in dialog (DialogLogin) is on screen: open, or showing the
 * note it closes with („Konto założone…”, or what the newsletter answer
 * did). The app bar keeps one on every page, and a page can have its own, as
 * /oswiadczenia's banner does.
 *
 * A page with a line of its own for the foot of the window, where that note
 * goes, holds the line while one is. Vuetify puts an overlay opened later on
 * top of those already open, so a snackbar opened during a sign-in would sit
 * over the dialog, and over its note, which it would hide.
 */
export function useSignInOnScreen(): ComputedRef<boolean> {
  return computed(() => onScreen.size > 0);
}

/** Counts a sign-in dialog on screen for as long as `shown` says so, and no
 * longer once the dialog is gone. For DialogLogin. */
export function countSignInOnScreen(shown: () => boolean) {
  if (import.meta.server) return;
  const key = Symbol("sign-in dialog");
  watch(
    shown,
    (now) => {
      if (now) onScreen.add(key);
      else onScreen.delete(key);
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    onScreen.delete(key);
  });
}
