import { useEffect, useState } from 'react'

type ViewportMetrics = {
  height: number
  offsetTop: number
}

/**
 * Высота видимой области с учётом виртуальной клавиатуры (Visual Viewport API).
 * offsetTop — сдвиг при скролле viewport на iOS.
 */
export function useVisualViewportHeight(): ViewportMetrics | null {
  const [metrics, setMetrics] = useState<ViewportMetrics | null>(null)

  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport
      setMetrics({
        height: vv?.height ?? window.innerHeight,
        offsetTop: vv?.offsetTop ?? 0,
      })
    }

    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return metrics
}
