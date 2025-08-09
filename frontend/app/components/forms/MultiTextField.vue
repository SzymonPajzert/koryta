<template>
  <div
    v-for="(key, index) in keys"
    :key="`item-${index}`"
    align="center"
    dense
    class="d-flex align-center mb-4 w-100"
  >
    <component
      :is="props.fieldComponent"
      v-model="model[key]"
      :label="`${props.title} ${index + 1}`"
      :hint="props.hint"
      autocomplete="off"
      :fieldType="props.fieldType"
      :rows="props.fieldType === 'textarea' ? 2 : undefined"
      :prepend-inner-icon="props.prependIcon"
      :entity="props.entity"
      hide-details
    />
    <div class="d-flex flex-column">
      <v-btn
        icon
        slim
        size="small"
        density="comfortable"
        variant="text"
        color="grey"
        @click="addItem()"
      >
        <v-icon>mdi-plus-circle</v-icon>
      </v-btn>
      <v-btn
        icon
        slim
        size="small"
        density="comfortable"
        variant="text"
        color="grey"
        @click="removeItem(index)"
        :disabled="keys.length <= 1"
      >
        <v-icon>mdi-minus-circle</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts" setup generic="F extends Type">
import type { Destination } from "~~/shared/model";
import { useDBUtils } from "@/composables/model";
import type {
  Type,
  CompatibleComponent,
  ComponentModel,
} from "@/composables/multiTextHelper";

const { newKey } = useDBUtils();

const props = withDefaults(
  defineProps<{
    title: string;
    hint?: string;
    addItemTooltip?: string;
    removeItemTooltip?: string;
    prependIcon?: string; // New prop for the inner prepend icon
    fieldType: F;
    fieldComponent?: CompatibleComponent[F];
    emptyValue: () => ComponentModel[F];
    entity?: Destination;
  }>(),
  {
    hint: "Wprowadź wartość",
  },
);

const model = defineModel<Record<string, ComponentModel[F]>>({
  required: true,
});
const keys = ref(Object.keys(model.value ?? {}));

const addItem = () => {
  const key = newKey();
  model.value[key] = props.emptyValue();
  keys.value.push(key);
};

if (!model.value || Object.keys(model.value).length === 0) {
  console.debug(model.value);
  addItem();
}

const removeItem = (index: number) => {
  if (keys.value.length > 1) {
    delete model.value[keys.value[index]];
    keys.value.splice(index, 1);
  }
};
</script>
