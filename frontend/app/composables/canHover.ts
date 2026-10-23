import { onMounted, ref } from "vue";

/** Whether the reader's pointer can hover. A phone's cannot, and a tap sends
 * an emulated hover and then a click: on a tooltip that opens on both, the
 * hover opened it and the click, being a toggle, shut it again half a second
 * later - every (i) on the site did that. Where nothing hovers, the tap is the
 * only way in, so pass this to `open-on-hover` (hover off takes Vuetify's
 * open-on-focus with it). Read after mounting, so the server's render and the
 * first one in the browser agree. */
export function useCanHover() {
  const canHover = ref(true);
  onMounted(() => {
    canHover.value = window.matchMedia("(hover: hover)").matches;
  });
  return canHover;
}
