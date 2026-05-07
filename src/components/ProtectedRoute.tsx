// Auth gate disabled — app is open. AuthContext still loads session if present.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
