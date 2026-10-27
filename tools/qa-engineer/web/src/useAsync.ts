import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
}

/** Runs fn whenever key changes; results from superseded calls are ignored. */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true })
  useEffect(() => {
    let stale = false
    setState({ data: undefined, error: undefined, loading: true })
    fn().then(
      (data) => !stale && setState({ data, error: undefined, loading: false }),
      (error: unknown) =>
        !stale && setState({ data: undefined, error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    )
    return () => {
      stale = true
    }
    // fn is intentionally keyed by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}
