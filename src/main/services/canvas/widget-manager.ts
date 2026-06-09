import { Widget, WidgetType } from '@shared/types'
import { WIDGET_DEFAULTS } from '@shared/constants'
import { getDefaultsForType, WidgetRegistration } from './widget-types'
import { BrowserWindow } from 'electron'

let widgetIdCounter = 0

function generateWidgetId(type: WidgetType): string {
  widgetIdCounter++
  return `${type}-${Date.now()}-${widgetIdCounter}`
}

export class WidgetManager {
  private widgets = new Map<string, Widget>()
  private timers = new Map<string, NodeJS.Timeout>()
  private canvasWindow: BrowserWindow | null = null

  setCanvasWindow(win: BrowserWindow | null): void {
    this.canvasWindow = win
  }

  register(registration: WidgetRegistration): Widget {
    const defaults = getDefaultsForType(registration.type)
    const id = registration.id ?? generateWidgetId(registration.type)

    // Enforce max bubbles
    if (registration.type === 'bubble') {
      const bubbles = this.listByType('bubble')
      while (bubbles.length >= WIDGET_DEFAULTS.maxBubbles) {
        const oldest = bubbles.shift()!
        this.dismiss(oldest.id)
      }
    }

    const widget: Widget = {
      id,
      type: registration.type,
      anchor: registration.anchor ?? defaults.anchor ?? 'top-left',
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      priority: registration.priority ?? defaults.priority ?? 50,
      dismissable: registration.dismissable ?? defaults.dismissable ?? true,
      ttl: registration.ttl !== undefined ? registration.ttl : (defaults.ttl ?? null),
      props: registration.props ?? {},
      createdAt: Date.now(),
    }

    this.widgets.set(id, widget)

    // Set up auto-dismiss timer if TTL is set
    if (widget.ttl !== null && widget.ttl > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id)
      }, widget.ttl)
      this.timers.set(id, timer)
    }

    this.broadcastState()
    return widget
  }

  update(id: string, props: Record<string, unknown>): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    widget.props = { ...widget.props, ...props }
    this.broadcastState()
  }

  setPosition(id: string, x: number, y: number): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    widget.position = { x, y }
    this.broadcastState()
  }

  setTtl(id: string, ttl: number | null): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    const existing = this.timers.get(id)
    if (existing) {
      clearTimeout(existing)
      this.timers.delete(id)
    }

    widget.ttl = ttl
    if (ttl !== null && ttl > 0) {
      const timer = setTimeout(() => this.dismiss(id), ttl)
      this.timers.set(id, timer)
    }
    this.broadcastState()
  }

  dismiss(id: string): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    // Clear auto-dismiss timer
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }

    this.widgets.delete(id)
    this.broadcastState()
  }

  dismissByType(type: WidgetType): void {
    for (const [id, widget] of this.widgets) {
      if (widget.type === type) {
        this.dismiss(id)
      }
    }
  }

  get(id: string): Widget | undefined {
    return this.widgets.get(id)
  }

  listActive(): Widget[] {
    return Array.from(this.widgets.values())
      .sort((a, b) => b.priority - a.priority)
  }

  listByType(type: WidgetType): Widget[] {
    return Array.from(this.widgets.values())
      .filter((w) => w.type === type)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  hasType(type: WidgetType): boolean {
    for (const widget of this.widgets.values()) {
      if (widget.type === type) return true
    }
    return false
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.widgets.clear()
    this.broadcastState()
  }

  private broadcastState(): void {
    if (!this.canvasWindow || this.canvasWindow.isDestroyed()) return
    this.canvasWindow.webContents.send('canvas:widget-state', this.listActive())
  }
}
