<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding">
      <p>{{ t('views.chatComingSoon') }}</p>
    </ion-content>
  </ion-page>
</template>
