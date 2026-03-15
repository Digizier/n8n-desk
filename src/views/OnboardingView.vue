<script setup lang="ts">
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent } from '@ionic/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('onboarding.connectToN8n') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p>{{ t('views.onboardingComingSoon') }}</p>
    </ion-content>
  </ion-page>
</template>
