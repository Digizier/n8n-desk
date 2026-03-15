<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding">
      <div class="grid-bg" />
      <p>{{ t('views.coworkComingSoon') }}</p>
    </ion-content>
  </ion-page>
</template>

<style lang="scss" scoped>
.grid-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--n8n-desk--grid-line-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--n8n-desk--grid-line-color) 1px, transparent 1px);
  background-size: 24px 24px;
}
</style>
