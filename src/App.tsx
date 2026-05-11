import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import NewAnalysis from "./pages/NewAnalysis";
import TaskDetail from "./pages/TaskDetail";
import AuthPage from "./pages/Auth";
import BulkUpload from "./pages/BulkUpload";
import Trends from "./pages/Trends";
import PreLiveList from "./pages/PreLiveList";
import PreLiveNew from "./pages/PreLiveNew";
import PreLiveAsset from "./pages/PreLiveAsset";
import PreLiveDiff from "./pages/PreLiveDiff";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150}>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/new" element={<ProtectedRoute><NewAnalysis /></ProtectedRoute>} />
            <Route path="/bulk" element={<ProtectedRoute><BulkUpload /></ProtectedRoute>} />
            <Route path="/trends" element={<ProtectedRoute><Trends /></ProtectedRoute>} />
            <Route path="/prelive" element={<ProtectedRoute><PreLiveList /></ProtectedRoute>} />
            <Route path="/prelive/new" element={<ProtectedRoute><PreLiveNew /></ProtectedRoute>} />
            <Route path="/prelive/asset/:id" element={<ProtectedRoute><PreLiveAsset /></ProtectedRoute>} />
            <Route path="/prelive/asset/:id/diff" element={<ProtectedRoute><PreLiveDiff /></ProtectedRoute>} />
            <Route path="/task/:id" element={<ProtectedRoute><TaskDetail /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
