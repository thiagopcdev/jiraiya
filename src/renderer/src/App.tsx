import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStatus } from './api/hooks'
import { Spinner } from './components/ui'
import Shell from './components/Shell'
import Onboarding from './screens/Onboarding/Onboarding'
import Dashboard from './screens/Dashboard/Dashboard'
import Create from './screens/Create/Create'
import Split from './screens/Split/Split'
import Timeline from './screens/Timeline/Timeline'
import Mentions from './screens/Mentions/Mentions'
import Summaries from './screens/Summaries/Summaries'
import Team from './screens/Team/Team'
import Alerts from './screens/Alerts/Alerts'
import Settings from './screens/Settings/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 }
  }
})

function AuthGate({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { data, isLoading } = useAuthStatus()
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-zinc-500" />
      </div>
    )
  }
  if (!data?.connected) return <Navigate to="/onboarding" replace />
  return children
}

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route
            element={
              <AuthGate>
                <Shell />
              </AuthGate>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/criar" element={<Create />} />
            <Route path="/dividir" element={<Split />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/mencoes" element={<Mentions />} />
            <Route path="/resumos" element={<Summaries />} />
            <Route path="/time" element={<Team />} />
            <Route path="/alertas" element={<Alerts />} />
            <Route path="/config" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}
