import { useFeminatyw } from "@/composables/feminatyw";

export function useHome() {
    // Logic for Patronite date check
    const disablePatronite = ref(new Date() < new Date("2025-11-14"));

    // Fetching people data
    const { entities: people } = useEntity("person");

    // Feminatyw usage
    const { koryciarz } = useFeminatyw();

    return {
        disablePatronite,
        people,
        koryciarz
    };
}
