import {
  BubbleUrgency,
  PanelSubtype,
  Widget,
  WidgetAnchor,
  WidgetType,
} from '@shared/types'
import { WIDGET_DEFAULTS } from '@shared/constants'

export interface WidgetRegistration {
  type: WidgetType
  id?: string
  anchor?: WidgetAnchor
  priority?: number
  dismissable?: boolean
  ttl?: number | null
  props?: Record<string, unknown>
}

export function getDefaultsForType(type: WidgetType): Partial<Widget> {
  switch (type) {
    case 'control-bar':
      return {
        anchor: 'top-left',
        priority: 100,
        dismissable: false,
        ttl: null,
      }
    case 'panel':
      return {
        anchor: 'top-right',
        priority: 50,
        dismissable: true,
        ttl: null,
      }
    case 'bubble':
      return {
        anchor: 'near-control-bar',
        priority: 70,
        dismissable: true,
        ttl: WIDGET_DEFAULTS.bubbleTtlMs,
      }
    case 'toast':
      return {
        anchor: 'top-right',
        priority: 90,
        dismissable: false,
        ttl: WIDGET_DEFAULTS.toastTtlMs,
      }
  }
}

// Props helpers for type safety in tool executor
export interface BubbleProps {
  message: string
  urgency: BubbleUrgency
  expandable: boolean
}

export interface PanelProps {
  title: string
  content: string
  panelType: PanelSubtype
  fontSize?: number
}

export interface ToastProps {
  message: string
}
