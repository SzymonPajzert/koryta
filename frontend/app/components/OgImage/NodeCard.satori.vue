<template>
  <div
    style="
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background-color: #16261b;
      color: #ffffff;
      padding: 64px;
      font-family: 'Roboto';
    "
  >
    <div style="display: flex; align-items: center">
      <div
        style="
          font-size: 40px;
          font-weight: 700;
          color: #a8c79f;
          letter-spacing: -1px;
        "
      >
        koryta.pl
      </div>
    </div>

    <div style="display: flex; flex-direction: column">
      <div
        style="
          font-size: 28px;
          color: #a8c79f;
          text-transform: uppercase;
          letter-spacing: 4px;
          margin-bottom: 12px;
        "
      >
        {{ typeLabel }}
      </div>
      <div
        style="
          font-size: 72px;
          font-weight: 700;
          line-height: 1.1;
          max-width: 1000px;
        "
      >
        {{ title }}
      </div>
    </div>

    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 2px solid #3a5443;
        padding-top: 28px;
      "
    >
      <div style="font-size: 30px; color: #dde8d8">
        {{ connectionsLabel }}
      </div>
      <div style="font-size: 26px; color: #8ba382">
        Niezależny agregator koryciarstwa
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  typeLabel: string;
  connectionsLabel: string;
}>();
</script>
