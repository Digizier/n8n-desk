export type ThemeMode = 'light' | 'dark' | 'system'
export type AppMode = 'chat' | 'cowork' | 'workflow'
export type SupportedLocale = 'en'

export interface AppSettings {
  theme: ThemeMode
  defaultInstanceId: string | null
  lastMode: AppMode
  locale: SupportedLocale
}
