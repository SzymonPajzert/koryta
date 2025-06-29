<template>
  <v-col cols="12">
    <v-row v-for="( key , index) in keys" :key="`item-${index}`" dense align="center">
      <component
        :is="props.fieldComponent"
        v-model="model[key]"
        :label="`${props.title} ${index + 1}`"
        :hint="props.hint"
        autocomplete="off"
        :rows="props.fieldType === 'textarea' ? 2 : undefined"
        :prepend-inner-icon="props.prependIcon"
        :entity="props.entity"
      >
        <template v-slot:prepend>
          <v-tooltip v-if="index === keys.length - 1" location="bottom">
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

<script lang="ts" setup generic="F extends Type">
  import { type Destination } from '@/composables/model';
  import { useSuggestDB } from '@/composables/suggestDB';
  import { type Type, type CompatibleComponent, type ComponentModel, emptyNestedConnection, emptyTextable } from '@/composables/multiTextHelper'

  const props = withDefaults(defineProps<{
    title: string;
    hint?: string;
    addItemTooltip?: string;
    removeItemTooltip?: string;
    prependIcon?: string; // New prop for the inner prepend icon
    fieldType: F;
    fieldComponent?: CompatibleComponent[F];
    emptyValue: () => ComponentModel[F];
    entity: Destination
  }>(), {
    hint: 'Wprowadź wartość',
  });

  const model = defineModel<Record<string, ComponentModel[F]>>({required: true});
  const keys = ref(Object.keys(model.value ?? {}));

  const { newKey } = useSuggestDB();

  const addItem = () => {
    const key = newKey()
    model.value[key] = props.emptyValue()
    keys.value.push(key);
  };

  if (!model.value || Object.keys(model.value).length === 0) {
    console.log(model.value)
    addItem()
  }

  const removeItem = (index: number) => {
    if (keys.value.length > 1) {
      delete model.value[keys.value[index]];
      keys.value.splice(index, 1);
    }
  };
</script>
