import { ref, computed } from 'vue'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const COLLAPSE_THRESHOLD = 150

function readNumber(key: string, fallback: number): number {
  try {
    const val = localStorage.getItem(key)
    if (val !== null) return Number(val)
  } catch { /* noop */ }
  return fallback
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key)
    if (val !== null) return val === 'true'
  } catch { /* noop */ }
  return fallback
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

// Shared state across components (module-level singleton)
const persistedWidth = ref(readNumber('n8n-desk--sidebar-width', DEFAULT_WIDTH))
const isCollapsed = ref(readBool('n8n-desk--sidebar-collapsed', false))
const isResizing = ref(false)
const currentWidth = ref(persistedWidth.value)

export function useSidebarResize() {
  const sidebarWidth = computed(() => {
    if (isCollapsed.value) return 0
    return currentWidth.value
  })

  let startX = 0
  let startWidth = 0

  function onResizeStart(event: MouseEvent) {
    event.preventDefault()
    isResizing.value = true
    startX = event.clientX
    startWidth = currentWidth.value

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeEnd)
  }

  function onResizeMove(event: MouseEvent) {
    const delta = event.clientX - startX
    const newWidth = startWidth + delta

    // Snap to collapse if dragged below threshold
    if (newWidth < COLLAPSE_THRESHOLD) {
      currentWidth.value = MIN_WIDTH
      isCollapsed.value = true
      persist('n8n-desk--sidebar-collapsed', 'true')
      onResizeEnd()
      return
    }

    currentWidth.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth))
  }

  function onResizeEnd() {
    isResizing.value = false
    persistedWidth.value = currentWidth.value
    persist('n8n-desk--sidebar-width', String(currentWidth.value))

    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeEnd)
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value
    persist('n8n-desk--sidebar-collapsed', String(isCollapsed.value))
    if (!isCollapsed.value) {
      currentWidth.value = persistedWidth.value
    }
  }

  return {
    sidebarWidth,
    isCollapsed,
    isResizing,
    onResizeStart,
    toggleCollapse,
    MIN_WIDTH,
    MAX_WIDTH,
  }
}
