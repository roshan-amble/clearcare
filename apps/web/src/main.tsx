import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DataProvider } from "./data";
import { Shell } from "./Shell";
import { Ask } from "./pages/Ask";
import { Conditions } from "./pages/Conditions";
import { Diet } from "./pages/Diet";
import { Documents } from "./pages/Documents";
import { Medications } from "./pages/Medications";
import { Profile } from "./pages/Profile";
import { Schedule } from "./pages/Schedule";
import { Settings } from "./pages/Settings";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Ask />} />
            <Route path="chat/:threadId" element={<Ask />} />
            <Route path="profile" element={<Profile />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="medications" element={<Medications />} />
            <Route path="conditions" element={<Conditions />} />
            <Route path="diet" element={<Diet />} />
            <Route path="documents" element={<Documents />} />
            <Route path="settings" element={<Settings />} />
            <Route path="ask/:threadId" element={<Ask />} />
            <Route path="ask" element={<Navigate to="/" replace />} />
            <Route path="check-ins" element={<Navigate to="/schedule" replace />} />
            <Route path="import" element={<Navigate to="/documents" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DataProvider>
  </StrictMode>,
);
