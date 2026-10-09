import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/Auth";
import Shell, { Allowed } from "../components/Shell";
import { Loading, ErrorBanner } from "../components/UI";
import AuthPage from "../pages/AuthPage";
import Home from "../pages/Home";
import Profile from "../pages/Profile";
import Accounts from "../pages/Accounts";
import Roles from "../pages/Roles";
import Promotions from "../pages/Promotions";
import Revenue from "../pages/Revenue";
export default function Application() {
  const { user, loading, error, refresh } = useAuth();
  if (loading) return <Loading />;
  if (error)
    return (
      <div className="startup-error">
        <h1>Let’s reconnect.</h1>
        <ErrorBanner error={error} retry={refresh} />
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route element={user ? <Shell /> : <Navigate to="/login" replace />}>
        <Route index element={<Home />} />
        <Route path="profile" element={<Profile />} />
        <Route
          path="accounts"
          element={
            <Allowed permission="users.manage">
              <Accounts />
            </Allowed>
          }
        />
        <Route
          path="roles"
          element={
            <Allowed permission="roles.manage">
              <Roles />
            </Allowed>
          }
        />
        <Route
          path="staff"
          element={
            <Allowed permission="staff.manage">
              <Accounts staff />
            </Allowed>
          }
        />
        <Route
          path="promotions"
          element={
            <Allowed permission="promotions.manage">
              <Promotions />
            </Allowed>
          }
        />
        <Route
          path="revenue"
          element={
            <Allowed permission="revenue.read">
              <Revenue />
            </Allowed>
          }
        />
        <Route
          path="*"
          element={
            <div className="empty">
              <h1>Page not found</h1>
              <p>This address is not part of your workspace.</p>
              <Link to="/" className="button primary">
                Back to Home
              </Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
