<template>
  <v-container
    fluid
    class="hero-section d-flex align-center justify-center flex-column text-center py-16 position-relative"
  >
    <v-row justify="center" align="center" class="w-100 h-100">
      <v-col cols="12" md="6">
        <a
          href="https://zrzutka.pl/rd7ssx/award/g3z29z/przypinka-z-podziekowaniami"
          target="_blank"
          class="d-inline-block mb-8"
        >
          <v-img width="200" src="@/assets/logo.png" class="mx-auto" />
        </a>
        <div class="d-flex ga-4 align-center justify-start flex-wrap">
          <v-btn
            class="text-none"
            color="primary"
            flat
            rounded="lg"
            text="Wesprzyj projekt"
            to="/pomoc"
          />

          <span>or</span>

          <v-btn
            append-icon="mdi-chevron-right"
            border
            class="text-none"
            flat
            rounded="lg"
            slim
            text="Zobacz jak to działa"
          />
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <h1 class="text-h3 text-md-h2 font-weight-bold mb-6 lh-title">
          <span class="text-high-emphasis">koryta.pl to </span>
          <a
            href="#najwiekszy"
            class="text-decoration-none text-primary hero-link"
            >największy,</a
          >
          <a
            href="#ogolnopolski"
            class="text-decoration-none text-secondary hero-link"
            >ogólnopolski</a
          >
          i
          <a
            href="#bezpartyjny"
            class="text-decoration-none text-info hero-link"
            >bezpartyjny</a
          >
          <a
            href="#agregator"
            class="text-decoration-none text-warning hero-link"
            >agregator koryciarstwa</a
          >
        </h1>
      </v-col>

      <v-btn
        icon="mdi-chevron-down"
        variant="text"
        size="x-large"
        class="mt-12 animate-bounce"
        aria-label="Przewiń niżej"
        @click="scrollToContent"
      />
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
const scrollToContent = () => {
  const el = document.getElementById("najwiekszy");
  if (el) {
    el.scrollIntoView({ behavior: "smooth" });
  }
};
</script>

<style scoped>
.hero-section {
  min-height: 85vh; /* Takes up most of the viewport */
}

.hero-link {
  transition: opacity 0.2s ease-in-out;
  display: inline-block;
}

.hero-link:hover {
  opacity: 0.8;
  text-decoration: underline !important;
}

.lh-title {
  line-height: 1.4 !important;
}

.animate-bounce {
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%,
  20%,
  50%,
  80%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-10px);
  }
  60% {
    transform: translateY(-5px);
  }
}
</style>
