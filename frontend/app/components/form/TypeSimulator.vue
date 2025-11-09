<!-- TypeSimulator simulates typing some values and creates an overlay to link to their URLs.

This is a bit of coupling, but it's simpler than the alternative imo.

The type simulator could be a composable and the overlay with the links its own component.
We would still need to pass the current link, exposing the state with a bit more complexity. -->
<template>
  <router-link :to="currentLink ?? '/'">
    <div class="blocker-overlay" />
  </router-link>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface Line {
  text: string;
  link: string;
}

interface Config {
  lines: Line[];
  typingSpeed?: number;
  deletingSpeed?: number;
  // how long to wait after it's done
  pauseDuration?: number;
}

const {
  lines,
  typingSpeed = 120,
  deletingSpeed = 80,
  pauseDuration = 1500,
} = defineProps<Config>();

// --- State ---
const currentText = ref(""); // This is the ref we will expose
const currentLink = ref("");
const lineIndex = ref(0);
const charIndex = ref(0);
const isDeleting = ref(false);
let timeoutId = null;

function runSimulation() {
  if (!lines || lines.length === 0) throw new Error("No lines provided");

  const currentLine = lines[lineIndex.value].text;
  currentLink.value = lines[lineIndex.value].link;

  let delay = typingSpeed;

  if (isDeleting.value) {
    currentText.value = currentLine.substring(0, charIndex.value - 1);
    charIndex.value--;
    delay = deletingSpeed;

    if (charIndex.value === 0) {
      isDeleting.value = false;
      // Move to the next line, loop back to start if at the end
      lineIndex.value = (lineIndex.value + 1) % lines.length;
      delay = typingSpeed;
    }
  } else {
    currentText.value = currentLine.substring(0, charIndex.value + 1);
    charIndex.value++;

    if (charIndex.value === currentLine.length) {
      isDeleting.value = true;
      // Set delay to the long pause duration if the line is fully typed.
      delay = pauseDuration;
    }
  }

  // Schedule the next "tick"
  timeoutId = setTimeout(runSimulation, delay);
}

onMounted(() => {
  runSimulation();
});

onUnmounted(() => {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
});

/**
 * Expose the currentText ref so the parent component can access it.
 */
defineExpose({
  currentText,
  currentLink,
});
</script>

<style scoped>
.display-wrapper {
  position: relative;
}

.blocker-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  /* Sit on top of everything else inside the wrapper */
  z-index: 10;
  /* Make it transparent */
  background-color: transparent;
}

.blocker-overlay:hover {
  cursor: pointer;
}
</style>
