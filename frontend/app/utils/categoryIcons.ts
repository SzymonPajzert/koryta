import {
  mdiBankOutline,
  mdiBus,
  mdiFlashOutline,
  mdiHospitalBuilding,
  mdiRadiator,
  mdiRecycle,
  mdiShieldOutline,
  mdiSoccer,
  mdiStethoscope,
  mdiTagOutline,
  mdiTrain,
  mdiWaterPump,
} from "@mdi/js";

/** A category's own icon, keyed by the values in `shared/companyCategories`. A
 * category added there and not here keeps the generic tag. Skarb Państwa, an
 * owner rather than a sector, takes the portico the „Instytucja publiczna”
 * chip draws (`ChipPublicCompany`), narrowed by its label (Szymon, 2026-10-28). */
const CATEGORY_ICONS: Record<string, string> = {
  szpitale: mdiHospitalBuilding,
  przychodnie: mdiStethoscope,
  wodociagi: mdiWaterPump,
  cieplownictwo: mdiRadiator,
  energetyka: mdiFlashOutline,
  odpady: mdiRecycle,
  koleje: mdiTrain,
  "komunikacja-miejska": mdiBus,
  sport: mdiSoccer,
  obronnosc: mdiShieldOutline,
  "skarb-panstwa": mdiBankOutline,
};

/** A category's icon, or the generic tag for one this list does not know yet:
 * on the category's chip in the /eksploruj/tabela filter bar, and on the
 * companies of the sector in the rows below it, so the two read as one. */
export function categoryIcon(value: string | null | undefined): string {
  return CATEGORY_ICONS[value ?? ""] ?? mdiTagOutline;
}
