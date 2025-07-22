import { useDisplay } from "vuetify";

export function useDrawer() {
  const { mobile } = useDisplay({ mobileBreakpoint: 1000 });

  const location = computed(() => mobile.value ? 'bottom' : 'right')
  const width = computed(() => mobile.value ? 150 : 300)

  return { width, location }
}
