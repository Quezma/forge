import { RunDetail } from './RunDetail'
import { RunsList } from './RunsList'
import { Link, usePath } from './router'

export function App() {
  const path = usePath()
  const m = /^\/runs\/([^/]+)\/?$/.exec(path)
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">QA Engineer</Link>
      </header>
      <main>{m ? <RunDetail id={decodeURIComponent(m[1])} /> : <RunsList />}</main>
    </>
  )
}
