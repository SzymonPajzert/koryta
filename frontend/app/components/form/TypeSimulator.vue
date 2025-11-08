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

// --- Logic ---

/**
 * The main simulation loop.
 * It calls itself recursively with setTimeout to create the typing effect.
 */
function runSimulation() {
  // Stop if no lines are provided
  if (!lines || lines.length === 0) return;

  const currentLine = lines[lineIndex.value].text;
  currentLink.value = lines[lineIndex.value].link;

  let delay = typingSpeed;

  if (isDeleting.value) {
    // --- Deleting ---
    currentText.value = currentLine.substring(0, charIndex.value - 1);
    charIndex.value--;
    delay = deletingSpeed;

    // Check if line is fully deleted
    if (charIndex.value === 0) {
      isDeleting.value = false;
      // Move to the next line, loop back to start if at the end
      lineIndex.value = (lineIndex.value + 1) % lines.length;
      delay = typingSpeed;
    }
  } else {
    // --- Typing ---
    currentText.value = currentLine.substring(0, charIndex.value + 1);
    charIndex.value++;

    // Check if line is fully typed
    if (charIndex.value === currentLine.length) {
      isDeleting.value = true;
      // Set delay to the long pause duration
      delay = pauseDuration;
    }
  }

  // Schedule the next "tick"
  timeoutId = setTimeout(runSimulation, delay);
}

// --- Lifecycle Hooks ---

onMounted(() => {
  // Start the simulation when the component is mounted
  runSimulation();
});

onUnmounted(() => {
  // Clean up the timeout when the component is destroyed
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
});

// --- Expose ---

/**
 * Expose the currentText ref so the parent component can access it.
 * This is the "exposed prop" you mentioned.
 */
defineExpose({
  currentText,
  currentLink,
});
</script>
