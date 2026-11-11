import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './features/shell/Layout';
import { Loading } from './shared/components/states';

/**
 * Every page is code-split.
 *
 * Importing all of them statically would make one 1.3 MB chunk, so opening the dashboard would
 * download the charting library for the two pages that draw graphs and the report code for pages
 * most viewers never open. Each route fetches its own chunk on first visit.
 *
 * Login is lazy too but sits outside the Layout: it is the one route an unauthenticated visitor
 * reaches, and it should not carry the rest with it.
 */
const Overview = lazy(() => import('./features/dashboard/Overview'));
const Problems = lazy(() => import('./features/problems/Problems'));
const Sites = lazy(() => import('./features/network/Sites'));
const Hosts = lazy(() => import('./features/hosts/Hosts'));
const Devices = lazy(() => import('./features/hosts/Devices'));
const HostDetail = lazy(() => import('./features/graphs/HostDetail'));
const LatestData = lazy(() => import('./features/hosts/LatestData'));
const Maps = lazy(() => import('./features/network/Maps'));
const Network = lazy(() => import('./features/network/Network'));
const Links = lazy(() => import('./features/network/Links'));
const Services = lazy(() => import('./features/sla/Services'));
const Sla = lazy(() => import('./features/sla/Sla'));
const Availability = lazy(() => import('./features/sla/Availability'));
const Capacity = lazy(() => import('./features/reports/Capacity'));
const AlertNoise = lazy(() => import('./features/reports/AlertNoise'));
const Inventory = lazy(() => import('./features/reports/Inventory'));
const TopTriggers = lazy(() => import('./features/reports/TopTriggers'));
const Assistant = lazy(() => import('./features/assistant/Assistant'));
const Login = lazy(() => import('./features/auth/Login'));
const NotFound = lazy(() => import('./features/shell/NotFound'));

/** The route table on its own, so a test can mount it in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<Loading label="Loading…" />}>
            <Login />
          </Suspense>
        }
      />
      {/* The Suspense boundary lives inside Layout, around <Outlet />, so the
          sidebar and topbar stay painted while a page chunk loads. */}
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/hosts" element={<Hosts />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/graphs" element={<HostDetail />} />
        <Route path="/latest" element={<LatestData />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/network" element={<Network />} />
        <Route path="/links" element={<Links />} />
        <Route path="/services" element={<Services />} />
        <Route path="/sla" element={<Sla />} />
        <Route path="/reports/availability" element={<Availability />} />
        <Route path="/reports/capacity" element={<Capacity />} />
        <Route path="/reports/noise" element={<AlertNoise />} />
        <Route path="/reports/top-triggers" element={<TopTriggers />} />
        <Route path="/reports/inventory" element={<Inventory />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
