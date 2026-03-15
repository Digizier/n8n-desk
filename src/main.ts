import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { useTheme } from './composables/useTheme'
import { i18n } from './i18n'

import './theme/global.scss'

const app = createApp(App)
  .use(IonicVue)
  .use(createPinia())
  .use(router)
  .use(i18n)

router.isReady().then(async () => {
  const settingsStore = useSettingsStore()
  await settingsStore.hydrate()
  const { init } = useTheme()
  init(settingsStore.theme)

  // Mark Electron for CSS safe area handling (macOS traffic lights)
  if (window.n8nDesk) {
    document.body.classList.add('electron-app')
  }

  app.mount('#app')
})
