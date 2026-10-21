import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "../api/client";
const Context = createContext();
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const res = await api("/auth/me");
      setUser(res.data);
      setError(null);
    } catch (e) {
      if (e.status === 401) {
        setUser(null);
        setError(null);
      } else setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const expired = () => setUser(null);
    window.addEventListener("focus", refresh);
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("session-expired", expired);
    };
  }, [refresh]);
  async function signIn(body) {
    const res = await api("/auth/login", { method: "POST", body });
    setUser(res.data);
  }
  async function signOut() {
    await api("/auth/logout", { method: "POST", body: {} });
    setUser(null);
  }
  return (
    <Context.Provider
      value={{ user, setUser, loading, error, refresh, signIn, signOut }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
