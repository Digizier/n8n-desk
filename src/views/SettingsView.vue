<script setup lang="ts">
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSelect, IonSelectOption, IonButtons, IonBackButton } from '@ionic/vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import type { ThemeMode, SupportedLocale } from '@/types/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const { applyTheme } = useTheme()

function onThemeChange(event: CustomEvent) {
  const value = event.detail.value as ThemeMode
  settingsStore.setTheme(value)
  applyTheme(value)
}

function onLocaleChange(event: CustomEvent) {
  const value = event.detail.value as SupportedLocale
  settingsStore.setLocale(value)
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/chat" />
        </ion-buttons>
        <ion-title>{{ t('settings.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-label>{{ t('settings.theme') }}</ion-label>
          <ion-select
            :value="settingsStore.theme"
            interface="popover"
            @ion-change="onThemeChange"
          >
            <ion-select-option value="system">{{ t('settings.themeSystem') }}</ion-select-option>
            <ion-select-option value="light">{{ t('settings.themeLight') }}</ion-select-option>
            <ion-select-option value="dark">{{ t('settings.themeDark') }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-label>{{ t('settings.language') }}</ion-label>
          <ion-select
            :value="settingsStore.locale"
            interface="popover"
            @ion-change="onLocaleChange"
          >
            <ion-select-option value="en">English</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>
