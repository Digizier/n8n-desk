<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent } from '@ionic/vue'

// Import the n8n-demo web component so it self-registers as a custom element
import '@n8n_io/n8n-demo-component/n8n-demo.bundled.js'

export interface WorkflowJson {
  nodes?: Array<{ name?: string; type?: string }>
  connections?: Record<string, unknown>
  [key: string]: unknown
}

interface Props {
  workflow: WorkflowJson
  workflowBefore?: WorkflowJson
  mode?: 'demo' | 'diff'
  compact?: boolean
  interactive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'demo',
  compact: false,
  interactive: false,
})

const emit = defineEmits<{
  click: []
}>()

// --- Global concurrent iframe limit ---
const MAX_CONCURRENT = 3
const activeCount = ref(0)
// Use a module-level set to track active instances
const activeInstances = new Set<symbol>()
const instanceKey = Symbol('workflow-embed')

// --- Lazy loading via IntersectionObserver ---
const containerRef = ref<HTMLElement | null>(null)
const isVisible = ref(false)
let observer: IntersectionObserver | null = null

const canRender = computed(() => isVisible.value && activeInstances.size < MAX_CONCURRENT)
const isRendered = ref(false)

// --- Theme sync ---
const currentTheme = ref<'light' | 'dark'>(
  (document.body.getAttribute('data-theme') as 'light' | 'dark') || 'light'
)
let themeObserver: MutationObserver | null = null

// --- Computed ---
const workflowString = computed(() => JSON.stringify(props.workflow))
const workflowBeforeString = computed(() =>
  props.workflowBefore ? JSON.stringify(props.workflowBefore) : undefined
)

const workflowName = computed(() => {
  const firstNode = props.workflow.nodes?.[0]
  return firstNode?.name ?? 'Workflow'
})

const nodeCount = computed(() => props.workflow.nodes?.length ?? 0)

// --- Lifecycle ---
function startThemeObserver() {
  themeObserver = new MutationObserver(() => {
    const theme = document.body.getAttribute('data-theme') as 'light' | 'dark' | null
    if (theme) currentTheme.value = theme
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] })
}

function startIntersectionObserver() {
  if (!containerRef.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      isVisible.value = entry.isIntersecting
    },
    { threshold: 0.1 }
  )
  observer.observe(containerRef.value)
}

watch(canRender, (can) => {
  if (can && !isRendered.value) {
    activeInstances.add(instanceKey)
    activeCount.value = activeInstances.size
    isRendered.value = true
  }
})

// Also check on visibility change when already under limit
watch(isVisible, (vis) => {
  if (vis && !isRendered.value && activeInstances.size < MAX_CONCURRENT) {
    activeInstances.add(instanceKey)
    activeCount.value = activeInstances.size
    isRendered.value = true
  }
  if (!vis && isRendered.value) {
    activeInstances.delete(instanceKey)
    activeCount.value = activeInstances.size
    isRendered.value = false
  }
})

// Inject styles into n8n-demo shadow DOM to fill container
function injectShadowStyles() {
  const el = containerRef.value?.querySelector('n8n-demo')
  if (!el?.shadowRoot) return
  // Avoid duplicate injection
  if (el.shadowRoot.querySelector('[data-n8n-desk-fill]')) return
  const style = document.createElement('style')
  style.setAttribute('data-n8n-desk-fill', '')
  style.textContent = `
    :host { display: block; height: 100%; }
    .embedded_workflow { height: 100%; display: flex; flex-direction: column; }
    .canvas-container { flex: 1; min-height: 0; }
    .embedded_workflow_iframe { width: 100% !important; height: 100% !important; min-height: 0 !important; border: none !important; border-radius: 0 !important; }
  `
  el.shadowRoot.appendChild(style)
}

watch(isRendered, (rendered) => {
  if (rendered) {
    // Shadow root may not be ready immediately — wait a tick
    requestAnimationFrame(() => {
      injectShadowStyles()
      // Retry once more in case Lit hasn't rendered yet
      setTimeout(injectShadowStyles, 200)
    })
  }
})

function handleClick() {
  if (props.compact) {
    emit('click')
  }
}

onMounted(() => {
  startThemeObserver()
  startIntersectionObserver()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  themeObserver?.disconnect()
  if (activeInstances.has(instanceKey)) {
    activeInstances.delete(instanceKey)
    activeCount.value = activeInstances.size
  }
})
</script>

<template>
  <div
    ref="containerRef"
    :class="[$style.container, compact && $style.compact]"
    @click="handleClick"
  >
    <!-- Placeholder when not rendered -->
    <ion-card v-if="!isRendered" :class="$style.placeholder">
      <ion-card-header>
        <ion-card-title :class="$style.placeholderTitle">{{ workflowName }}</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <span :class="$style.nodeCount">{{ nodeCount }} node{{ nodeCount !== 1 ? 's' : '' }}</span>
      </ion-card-content>
    </ion-card>

    <!-- Rendered n8n-demo -->
    <n8n-demo
      v-else
      :workflow="workflowString"
      :workflowbefore="mode === 'diff' ? workflowBeforeString : undefined"
      :mode="mode"
      :theme="currentTheme"
      frame="false"
      tidyup="true"
      :disableinteractivity="!interactive ? 'true' : 'false'"
      clicktointeract="false"
      collapseformobile="false"
    />
  </div>
</template>

<style lang="scss" module>
.container {
  width: 100%;
  height: 100%;
  min-height: 200px;

  &.compact {
    height: 100%;
    overflow: hidden;

    n8n-demo {
      height: 100%;
      width: 100%;
    }
  }

  n8n-demo {
    display: block;
    width: 100%;
  }
}

.placeholder {
  margin: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
}

.placeholderTitle {
  font-size: 14px;
  font-weight: 600;
}

.nodeCount {
  font-size: 12px;
  color: var(--color--text--tint-1);
}
</style>
