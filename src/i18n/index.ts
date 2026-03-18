import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import type { MessageSchema } from './types'

export const i18n = createI18n<[MessageSchema], 'en'>({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
})

export function setAppLocale(locale: string): void {
  (i18n.global.locale as unknown as { value: string }).value = locale
}
