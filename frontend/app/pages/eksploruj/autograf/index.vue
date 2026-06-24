<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

router.replace({
  path: "/eksploruj/autograf/spolki-partie",
  query: route.query,
});
</script>
