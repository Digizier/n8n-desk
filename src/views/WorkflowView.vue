<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding">
      <div class="dot-bg" />
      <p>{{ t('views.workflowComingSoon') }}</p>
    </ion-content>
  </ion-page>
</template>

<style lang="scss" scoped>
.dot-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, var(--n8n-desk--grid-dot-color) 1px, transparent 1px);
  background-size: 24px 24px;
}
</style>
