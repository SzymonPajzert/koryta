/* Allows editing one of many values.
 *
 * Handles state of the edit and value submission to the chosen DB.
 */
export function useEditIntexedField<ValueT, StructT, IndexT = number>(extract: (value: StructT) => ValueT) {
  const index = ref<IndexT | undefined>(undefined);
  const value = ref<ValueT | undefined>(undefined);

  function start(
    indexEdit: number,
    valueEdit: StructT,
  ) {
    index.value = indexEdit;
    value.value = extract(valueEdit);
  }
  function stop() {
    index.value = undefined;
    value.value = "";
  }
  function submit() {
    console.debug(index.value);
    console.debug(value.value);

    // TODO implement submission

    stop();
  }

  return {
    index,
    value,
    start,
    stop,
    submit,
  };
}
