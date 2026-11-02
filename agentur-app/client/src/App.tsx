import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StartPage } from './pages/StartPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { CustomerFormPage } from './pages/CustomerFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectFormPage } from './pages/ProjectFormPage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StartPage />} />
        <Route path="kunden" element={<CustomersPage />} />
        <Route path="kunden/neu" element={<CustomerFormPage />} />
        <Route path="kunden/:id" element={<CustomerDetailPage />} />
        <Route path="kunden/:id/bearbeiten" element={<CustomerFormPage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
        <Route
          path="dashboard"
          element={
            <PlaceholderPage
              title="Dashboard"
              stage={6}
              text="Live-Scoreboard mit laufenden Projekten, heutigen Aufgaben, den nächsten 14 Tagen und Kennzahlen."
            />
          }
        />
        <Route
          path="akquise"
          element={
            <PlaceholderPage
              title="Akquise"
              stage={7}
              text="Pipeline für Interessenten von Erstkontakt bis Abschluss. Interessenten kannst du schon jetzt als Kunden mit Status „Interessent“ anlegen."
            />
          }
        />
        <Route path="projekte" element={<ProjectsPage />} />
        <Route path="projekte/neu" element={<ProjectFormPage />} />
        <Route path="projekte/:id" element={<ProjectDetailPage />} />
        <Route path="projekte/:id/bearbeiten" element={<ProjectFormPage />} />
        <Route path="aufgaben" element={<TasksPage />} />
        <Route path="kalender" element={<CalendarPage />} />
        <Route
          path="zeiten"
          element={<PlaceholderPage title="Zeiterfassung" stage={7} text="Start/Stopp-Timer je Projekt mit Auswertung pro Kunde." />}
        />
        <Route
          path="berichte"
          element={<PlaceholderPage title="Berichte" stage={7} text="Monatsberichte als PDF und Exporte als CSV." />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
