/** Type of the key identifying currently set value */
type IndexT = string;

/** Allows editing one of many values.
 *
 * Handles state of the edit and value submission to the chosen DB.
 */
export function useEditIndexedField<ValueT, StructT>(
  extract: (value: StructT) => ValueT,
  ...setPaths: ((index: IndexT, value: ValueT) => [string, unknown])[]
) {
  const key = ref<IndexT | undefined>(undefined);
  const value = ref<ValueT | undefined>(undefined);
  const db = useFirestore();

  function start(keyEdit: string, valueEdit: StructT) {
    key.value = keyEdit;
    value.value = extract(valueEdit);
  }
  function stop() {
    key.value = undefined;
    value.value = "";
  }
  function submit() {
    console.debug(key.value);
    console.debug(value.value);
    if (!key.value || !value.value) {
      console.warn("No key or value")
      return;
    }

    setPaths.forEach((setter) => {
      const [path, v] = setter(key.value!, value.value!);
      console.debug(path, v);
      set(dbRef(db, path), v)
    });

    stop();
  }

  return {
    key,
    value,
    start,
    stop,
    submit,
  };
}
