import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteRecordRaw } from 'vue-router'
import MenuLayout from '@/views/MenuLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/chat',
  },
  {
    path: '/',
    component: MenuLayout,
    children: [
      {
        path: 'chat',
        component: () => import('@/views/ChatView.vue'),
      },
      {
        path: 'cowork',
        component: () => import('@/views/CoworkView.vue'),
      },
      {
        path: 'workflow',
        component: () => import('@/views/WorkflowView.vue'),
      },
      {
        path: 'settings',
        component: () => import('@/views/SettingsView.vue'),
      },
    ],
  },
  {
    path: '/onboarding',
    component: () => import('@/views/OnboardingView.vue'),
  },
  {
    path: '/showcase',
    component: () => import('@/views/ComponentShowcaseView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
