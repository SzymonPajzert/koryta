<template>
  <!-- <v-carousel>
    <v-carousel-item
      src="https://cdn.vuetifyjs.com/images/cards/docks.jpg"
      cover
    ></v-carousel-item>

    <v-carousel-item
      src="https://cdn.vuetifyjs.com/images/cards/hotel.jpg"
      cover
    ></v-carousel-item>

    <v-carousel-item
      src="https://cdn.vuetifyjs.com/images/cards/sunshine.jpg"
      cover
    ></v-carousel-item>
  </v-carousel> -->
  <v-card class="ma-5 pa-4" width="100%">
    <v-card-title align="center" class="pa-0">
       Najbliższe wyniki będą opublikowane za <div v-if="!isTimeUp">
        <v-row justify="center" align="center">
          <v-col
            v-for="unit in ['dni', 'godzin', 'minut', 'sekund']"
            :key="unit"
            cols="6"
            sm="3"
            class="text-center"
          >
            <div class="d-flex flex-column align-center">
              <div
                class="display-3 font-weight-black text-h2 text-md-h1 text-primary"
                style="line-height: 1"
              >
                {{ timeRemaining[unit] }}
              </div>
              <div class="text-h6 font-weight-medium text-grey-darken-1 mt-2">
                {{ unit }}
              </div>
            </div>
          </v-col>
        </v-row>
      </div>
    </v-card-title>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@vueuse/core';

const props = defineProps({
  targetDate: {
    type: String,
    required: false,
    default: '2025-08-11T23:59:59',
  },
});

const timeDifference = computed(() => target.value - now.value.getTime());

const isTimeUp = computed(() => timeDifference.value <= 0);

const timeRemaining = computed<Record<string, string>>(() => {
  if (isTimeUp.value) {
    return { dni: "0", godzin: "0", minut: "0", sekund: "0" };
  }

  const totalSeconds = Math.floor(timeDifference.value / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);

  // Pad with leading zeros for a consistent look
  return {
    dni: String(days).padStart(2, '0'),
    godzin: String(hours).padStart(2, '0'),
    minut: String(minutes).padStart(2, '0'),
    sekund: String(seconds).padStart(2, '0'),
  };
});

const now = useNow({ interval: 1000 });
const target = computed(() => new Date(props.targetDate).getTime());
</script>
