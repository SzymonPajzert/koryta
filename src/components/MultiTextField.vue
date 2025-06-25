<template>
  <v-col cols="12">
    <v-row v-for="(item, index) in model" :key="`item-${index}`" dense align="center">
      <!-- TODO probably just use model { required: true } -->
      <component
        v-if="model"
        :is="props.fieldType"
        v-model="model[index]"
        :label="`${props.title} ${index + 1}`"
        :hint="props.hint"
        autocomplete="off"
        :rows="props.fieldType === 'textarea' ? 2 : undefined"
        :prepend-inner-icon="props.prependIcon"
        :entity="props.entity"
      >
        <template v-slot:prepend>
          <v-tooltip v-if="index === model.length - 1" location="bottom">
            <template v-slot:activator="{ props: tooltipProps }">
              <v-icon v-bind="tooltipProps" icon="mdi-plus-circle-outline" @click="addItem"></v-icon>
            </template>
            {{ props.addItemTooltip || `Dodaj kolejny ${props.title.toLowerCase()}` }}
          </v-tooltip>
          <v-tooltip v-else location="bottom">
            <template v-slot:activator="{ props: tooltipProps }">
              <v-icon v-bind="tooltipProps" icon="mdi-minus-circle-outline" color="red" @click="removeItem(index)"></v-icon>
            </template>
            {{ props.removeItemTooltip || `Usuń ${props.title.toLowerCase()}` }}
          </v-tooltip>
        </template>
      </component>
    </v-row>
  </v-col>
</template>

<script lang="ts" setup generic="T">
import { VTextarea, VTextField } from 'vuetify/components';
import { Link, type Textable, type Destination } from '@/composables/entity';

const props = withDefaults(defineProps<{
  title: string;
  hint?: string;
  addItemTooltip?: string;
  removeItemTooltip?: string;
  prependIcon?: string; // New prop for the inner prepend icon
  fieldType?: any;
  emptyValue: () => T;
  entity?: Destination
}>(), {
  hint: 'Wprowadź wartość',
  fieldType: VTextField,
});

const model = defineModel<T[]>();

if (!model.value || model.value.length === 0) {
  model.value = [props.emptyValue()];
}

const addItem = () => {
  if (!model.value) {
    model.value = [];
  };
  model.value.push(props.emptyValue());
};
const removeItem = (index: number) => {
  if (model.value && model.value.length > 1) {
    model.value.splice(index, 1);
  } else if (model.value && model.value.length === 1) {
    // Optionally clear the text if it's the last item instead of removing it
    // Or prevent removal if at least one item is required
    model.value[0] = props.emptyValue();
  }
};
</script>
